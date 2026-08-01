import { sesToColor } from './sesScale';

/** Precomputed SES(0–9) → [r,g,b] at this many steps, so painting a grid is
 * a lookup instead of a string-building + parseInt round trip per cell —
 * matters here because the user can now switch layers and re-trigger this
 * repeatedly, where the old version allocated a fresh `rgb(...)` string and
 * did a fillRect() per cell (~50k calls worst case) on every switch. */
const LUT_STEPS = 256;
const SES_COLOR_LUT = (() => {
  const lut = new Uint8ClampedArray(LUT_STEPS * 3);
  for (let i = 0; i < LUT_STEPS; i++) {
    const ses = (i / (LUT_STEPS - 1)) * 9;
    const [r, g, b] = sesToColor(ses)
      .slice(4, -1)
      .split(',')
      .map((n) => parseInt(n, 10));
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
})();

function lutColorFor(sesValue) {
  const i = Math.max(0, Math.min(LUT_STEPS - 1, Math.round((sesValue / 9) * (LUT_STEPS - 1))));
  return [SES_COLOR_LUT[i * 3], SES_COLOR_LUT[i * 3 + 1], SES_COLOR_LUT[i * 3 + 2]];
}

/**
 * ============================================================
 * SES Grid Rasterizer — shared by HeatmapOverlay and the PDF export
 * ============================================================
 * Paints one continuous-SES grid (General or a single disease) as a canvas
 * image, clipped to the field boundary polygon using Canvas clip(). Pure —
 * no React, no Leaflet — so both the live map overlay and the offscreen PDF
 * figure renderer paint from one code path.
 *
 * @param {{grid: Float32Array|number[], cols: number, rows: number,
 *   bbox: number[], boundary: object}} args
 * @returns {HTMLCanvasElement|null} exactly `cols × rows` px — one pixel per
 *   grid cell. Callers that need print resolution upscale this themselves
 *   (see renderFieldFigure.js) rather than this module guessing a size.
 */
export function renderSesGridToCanvas({ grid, cols, rows, bbox, boundary }) {
  if (!grid || !cols || !rows || !bbox || !boundary) return null;

  // Paint into an offscreen canvas via ImageData (fast, one allocation),
  // THEN clip+draw that onto the visible canvas — clip() has to happen on
  // the canvas actually being painted, and putImageData() ignores clip
  // paths entirely, so the two steps can't be combined into one canvas.
  const paintCanvas = document.createElement('canvas');
  paintCanvas.width = cols;
  paintCanvas.height = rows;
  const paintCtx = paintCanvas.getContext('2d');
  const imageData = paintCtx.createImageData(cols, rows);
  const pixels = imageData.data;

  const gridData = grid instanceof Float32Array ? grid : new Float32Array(grid);
  for (let i = 0; i < gridData.length; i++) {
    const value = gridData[i];
    const o = i * 4;
    if (value < 0) {
      pixels[o + 3] = 0; // Outside boundary — fully transparent
      continue;
    }
    const [r, g, b] = lutColorFor(value);
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = 255;
  }
  paintCtx.putImageData(imageData, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');

  const [minLng, minLat, maxLng, maxLat] = bbox;

  // Draw clipping path from the boundary polygon
  const coords = boundary.geometry.coordinates[0];
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < coords.length; i++) {
    const px = ((coords[i][0] - minLng) / (maxLng - minLng)) * cols;
    const py = ((maxLat - coords[i][1]) / (maxLat - minLat)) * rows;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(paintCanvas, 0, 0);
  ctx.restore();

  return canvas;
}

/**
 * Same as `renderSesGridToCanvas`, encoded to a PNG data URL — what
 * `L.imageOverlay` needs.
 * @returns {string|null}
 */
export function renderSesGridToDataUrl(args) {
  const canvas = renderSesGridToCanvas(args);
  return canvas ? canvas.toDataURL('image/png') : null;
}
