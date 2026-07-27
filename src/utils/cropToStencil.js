/**
 * ============================================================
 * cropToStencil — Alignment Crop Encoder
 * ============================================================
 * react-easy-crop reports WHERE to cut (`croppedAreaPixels`, in the rotated
 * bounding box's coordinate space, via onCropComplete) and the source's
 * natural size (`mediaSize`, via onMediaLoaded) — it does not produce the
 * cropped image itself. This module does, via plain Canvas2D (mirrors the
 * approach in makeThumbnail.js: load + canvas + drawImage, no dependency).
 *
 * Output is ALWAYS exactly ALIGN_OUTPUT_WIDTH × ALIGN_OUTPUT_HEIGHT, for
 * every photo regardless of region, zoom, or rotation — that fixed geometry
 * is what stops the plant-level pixel pooling in aggregateSample.js from
 * varying with framing distance (see that module's pooling note).
 *
 * Also exports flipImage() — horizontal/vertical mirroring, applied to a
 * working copy BEFORE it ever reaches react-easy-crop (the library has no
 * flip support of its own) — and getCropOverflowFraction(), the confirm-gate
 * check ImageAlignmentModal.jsx uses to disable "Use Photo" when the crop
 * rect hangs off the source image. Both are exact at any rotation angle, not
 * just multiples of 90° — rotation in the UI is unrestricted.
 *
 * Pure module — no React. Requires a DOM (Image/canvas), unlike
 * aggregateSample.js, which is also runnable under bare `node`.
 */
import {
  ALIGN_OUTPUT_WIDTH,
  ALIGN_OUTPUT_HEIGHT,
  ALIGN_JPEG_QUALITY,
} from '../constants/constants.js';

function loadBitmap(file) {
  // imageOrientation: 'from-image' bakes EXIF rotation into the bitmap,
  // matching what an <img> displays and what react-easy-crop measured when
  // it produced croppedAreaPixels/mediaSize.
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/**
 * Rotated bounding box of a `w × h` rect turned by `rotation` degrees — the
 * frame both react-easy-crop's croppedAreaPixels and the functions below are
 * expressed in.
 */
function rotatedBoundingBox(w, h, rotation) {
  const rad = (rotation * Math.PI) / 180;
  return {
    width: Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)),
    height: Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)),
  };
}

/**
 * Rotate point `p` by `degrees` around the origin.
 */
function rotatePoint(p, degrees) {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/**
 * Does the crop rect fall fully inside the source image, at ANY rotation
 * angle — not just multiples of 90°?
 *
 * cropAlignedImage draws image-local point `L` (origin at the image's own
 * center) to bbox-space position `Rotate(rotation)·L + (bW/2, bH/2)`. This is
 * the algebraic inverse of exactly that: take each corner of the crop rect
 * (in bbox-space), undo the translate-to-center and the rotation, and check
 * whether the result lands inside `[0,mediaW] × [0,mediaH]`. It's not an
 * approximation — it's the same transform cropAlignedImage uses, run
 * backwards — so it's equally exact whether `rotation` is 0, 90, or 37.5.
 *
 * Returns a boolean-as-0/1 rather than a fractional overlap area: the only
 * thing callers do with this is threshold it against
 * ALIGN_MAX_OVERFLOW_FRACTION, so a precise partial-overlap area (which
 * would need actual polygon clipping) isn't worth building.
 *
 * @param {{x:number,y:number,width:number,height:number}} croppedAreaPixels
 * @param {number} rotation — degrees; any value.
 * @param {{naturalWidth:number,naturalHeight:number}} mediaSize — react-easy-crop's
 *   onMediaLoaded payload. Its `width`/`height` fields are the on-screen
 *   RENDERED size (CSS px); `croppedAreaPixels` is in natural image pixels,
 *   so this must read `naturalWidth`/`naturalHeight`, not `width`/`height`.
 * @returns {number} `0` if fully contained, `1` otherwise.
 */
export function getCropOverflowFraction(croppedAreaPixels, rotation, mediaSize) {
  const { naturalWidth: mediaW, naturalHeight: mediaH } = mediaSize;
  const { width: bW, height: bH } = rotatedBoundingBox(mediaW, mediaH, rotation);
  const { x, y, width: w, height: h } = croppedAreaPixels;

  // A half-pixel of slack absorbs floating-point rounding in the trig above
  // without meaningfully loosening the check.
  const EPSILON = 0.5;

  const corners = [
    { x, y },
    { x: x + w, y },
    { x, y: y + h },
    { x: x + w, y: y + h },
  ];

  const allContained = corners.every((corner) => {
    const centered = { x: corner.x - bW / 2, y: corner.y - bH / 2 };
    const local = rotatePoint(centered, -rotation);
    const imagePixel = { x: local.x + mediaW / 2, y: local.y + mediaH / 2 };
    return (
      imagePixel.x >= -EPSILON &&
      imagePixel.x <= mediaW + EPSILON &&
      imagePixel.y >= -EPSILON &&
      imagePixel.y <= mediaH + EPSILON
    );
  });

  return allContained ? 0 : 1;
}

/**
 * @param {object} args
 * @param {File} args.file — the ORIGINAL photo (not a previously cropped one).
 * @param {{x:number,y:number,width:number,height:number}} args.croppedAreaPixels
 *   — from react-easy-crop's onCropComplete.
 * @param {number} [args.rotation] — degrees; any value (coarse 90° steps and
 *   fine continuous rotation are combined into one number before this is
 *   called — see ImageAlignmentModal.jsx). The rotate math below was never
 *   actually restricted to 90° multiples; only getCropOverflowFraction's old
 *   containment check was, and that's now exact at any angle too.
 * @param {{naturalWidth:number,naturalHeight:number}} args.mediaSize — from
 *   onMediaLoaded. Used only for a defensive EXIF-orientation cross-check
 *   (against `naturalWidth`/`naturalHeight`, not the on-screen-rendered
 *   `width`/`height`); the rotated bounding box itself is sized from the
 *   freshly-decoded bitmap's own dimensions, since that's the data actually
 *   being drawn.
 * @param {string} args.fileName
 * @returns {Promise<File>} — image/jpeg, exactly ALIGN_OUTPUT_WIDTH × ALIGN_OUTPUT_HEIGHT.
 */
export async function cropAlignedImage({ file, croppedAreaPixels, rotation = 0, mediaSize, fileName }) {
  const bitmap = await loadBitmap(file);

  try {
    // Defensive check: if the decoded bitmap and the size react-easy-crop
    // measured disagree in a way that looks transposed, the two disagree
    // about EXIF orientation. Log rather than silently guess — a silent
    // wrong transpose produces a crop that looks plausible but isn't.
    if (
      mediaSize &&
      bitmap.width !== mediaSize.naturalWidth &&
      bitmap.width === mediaSize.naturalHeight &&
      bitmap.height === mediaSize.naturalWidth
    ) {
      console.error(
        'cropToStencil: bitmap/mediaSize orientation mismatch — crop may be misplaced.',
        { bitmap: { w: bitmap.width, h: bitmap.height }, mediaSize }
      );
    }

    const { width: bW, height: bH } = rotatedBoundingBox(bitmap.width, bitmap.height, rotation);
    const rad = (rotation * Math.PI) / 180;

    // One canvas, one transform stack — not the "rotate onto an oversized
    // safe-area canvas, then extract" recipe, which for a 4032×3024 photo
    // would allocate ~49MB of RGBA before the crop even happens. Composing
    // scale → translate-to-crop-origin → translate-to-bbox-center → rotate
    // into a single stack targeting the final ALIGN_OUTPUT_WIDTH×HEIGHT
    // canvas allocates one ~7.7MB buffer instead — the only two humans this
    // matters to are a mid-range Android holding up to 10 of these per plant.
    // OffscreenCanvas, when available, is chosen up front — not obtained by
    // transferring an HTMLCanvasElement after drawing to it, which throws
    // once a 2D context already exists on that element.
    const canvas = makeCanvas(ALIGN_OUTPUT_WIDTH, ALIGN_OUTPUT_HEIGHT);
    // alpha:false — any pixel the transform doesn't cover would otherwise be
    // transparent (which JPEG encodes as black anyway) and costs an extra
    // compositing pass; the overflow gate upstream should make this moot.
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.scale(ALIGN_OUTPUT_WIDTH / croppedAreaPixels.width, ALIGN_OUTPUT_HEIGHT / croppedAreaPixels.height);
    ctx.translate(-croppedAreaPixels.x, -croppedAreaPixels.y);
    ctx.translate(bW / 2, bH / 2);
    ctx.rotate(rad);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);

    const blob = await encodeCanvas(canvas, 'image/jpeg', ALIGN_JPEG_QUALITY);

    // Encourage the canvas's backing store to release before returning —
    // iOS Safari doesn't reliably do this on GC alone.
    canvas.width = 0;
    canvas.height = 0;

    if (!blob) throw new Error('Could not encode the cropped photo.');
    return new File([blob], fileName, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

/**
 * Physically mirror a photo before it ever reaches react-easy-crop — the
 * library has no `flip` prop, and wrapping its rendered output in a CSS
 * `scaleX(-1)`/`scaleY(-1)` would invert drag-to-pan (the library computes
 * pan deltas from real, unmirrored pointer coordinates in its own local
 * space; visually mirroring that space afterward makes dragging right move
 * the image left). Baking the flip into an actual bitmap first means the
 * library — and everything downstream, including cropAlignedImage — never
 * needs to know a flip happened at all.
 *
 * Encoded as PNG, not JPEG: this is an intermediate working image that will
 * be JPEG-encoded again by cropAlignedImage once the crop is confirmed —
 * PNG here avoids stacking two lossy generations on top of each other.
 *
 * @param {File} file — the ORIGINAL photo.
 * @param {{horizontal?: boolean, vertical?: boolean}} flip
 * @returns {Promise<File>} — image/png, same pixel dimensions as `file`
 *   (mirroring doesn't change width/height, so mediaSize stays meaningful).
 */
export async function flipImage(file, { horizontal = false, vertical = false } = {}) {
  if (!horizontal && !vertical) return file;

  const bitmap = await loadBitmap(file);
  try {
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.translate(horizontal ? bitmap.width : 0, vertical ? bitmap.height : 0);
    ctx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
    ctx.drawImage(bitmap, 0, 0);

    const blob = await encodeCanvas(canvas, 'image/png');
    canvas.width = 0;
    canvas.height = 0;

    if (!blob) throw new Error('Could not encode the flipped photo.');
    return new File([blob], file.name, { type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

/**
 * OffscreenCanvas where available, so both the drawing above and the encode
 * below happen off an HTMLCanvasElement entirely — not a fallback bolted on
 * after the fact, which would require transferring a canvas that already has
 * a context (unsupported; throws).
 */
function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * convertToBlob keeps encoding off the main thread on an OffscreenCanvas.
 * Shared by both the final JPEG crop output and the intermediate PNG flip
 * working image — `quality` is ignored by PNG (lossless), same as
 * `HTMLCanvasElement.toBlob`'s own behavior.
 */
async function encodeCanvas(canvas, type, quality) {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
