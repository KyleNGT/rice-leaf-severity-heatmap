import { useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { cropAlignedImage, flipImage, getCropOverflowFraction } from '../utils/cropToStencil';
import {
  ALIGN_ASPECT,
  ALIGN_FRAME_WIDTH_FRACTION,
  ALIGN_FRAME_HEIGHT_FRACTION,
  ALIGN_MIN_ZOOM,
  ALIGN_MAX_ZOOM,
  ALIGN_ROTATION_STEP_DEG,
  ALIGN_FINE_ROTATION_RANGE_DEG,
  ALIGN_MAX_OVERFLOW_FRACTION,
  ALIGN_BLUR_WARN_SOURCE_WIDTH,
} from '../constants/constants';

const NO_FLIP = { horizontal: false, vertical: false };

let cropFileSeq = 0;

/**
 * ============================================================
 * ImageAlignmentModal — Mandatory Crop Before Analysis
 * ============================================================
 * The single gate every photo — camera or gallery — passes through before
 * `newDraftImage`/`runAnalysis` ever sees it. Rendered by App.jsx as a
 * SIBLING of <SampleSheet>, never nested inside it: `.sheet` carries a CSS
 * transform, which would make it the containing block for this modal's
 * `position: fixed` root and drag it around with the sheet's translate.
 *
 * Rotation is coarse (`baseRotation`, a quick 90° cycle) + fine
 * (`fineRotation`, a continuous ±ALIGN_FINE_ROTATION_RANGE_DEG slider) —
 * see the constants.js comment for why. `restrictPosition={false}` + the
 * explicit overflow-fraction gate (getCropOverflowFraction) is used INSTEAD
 * of relying on react-easy-crop's built-in position clamping — that internal
 * logic is the part of the library most likely to shift between versions,
 * whereas the gate here is a plain inverse-transform check we can verify
 * ourselves, exact at any angle.
 *
 * Flip has no equivalent react-easy-crop prop, so it's baked into a
 * regenerated "working" File/URL (flipImage, cropToStencil.js) BEFORE it
 * ever reaches <Cropper> — see that function's header for why a live CSS
 * mirror would invert drag-to-pan. `workingUrl`/`workingFile` track that
 * derived copy; `imageUrl`/`file` (props) always stay the untouched
 * original, which the working-image effect reuses directly whenever no flip
 * is active — so the common (unflipped) case allocates nothing extra.
 *
 * The framing target is one static rectangle — same shape for every photo,
 * no per-photo region choice. It's rendered by styling react-easy-crop's own
 * crop-box element (`classes.cropAreaClassName`, see `.align-frame` in
 * App.css) rather than drawing a separate overlay: the library already dims
 * everything outside that element via its own default CSS, and sizing it
 * with an explicit `cropSize` (measured off the stage via ResizeObserver,
 * below) is what leaves visible margin on all four sides instead of the box
 * filling its container edge-to-edge.
 *
 * No re-align action exists once a photo is committed to the draft — the
 * original File isn't retained past a successful crop (ten originals pinned
 * for a whole draft would blow the memory budget MAX_IMAGES_PER_SAMPLE's own
 * comment already worries about). Fixing a bad alignment means removing the
 * photo from the strip and retaking it.
 */
export default function ImageAlignmentModal({
  file,
  imageUrl,
  photoIndex,
  totalCount,
  onConfirm,
  onSkip,
  onCancel,
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [baseRotation, setBaseRotation] = useState(0);
  const [fineRotation, setFineRotation] = useState(0);
  const [flip, setFlip] = useState(NO_FLIP);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [mediaSize, setMediaSize] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [workingUrl, setWorkingUrl] = useState(imageUrl);
  const [workingFile, setWorkingFile] = useState(file);
  const [cropSize, setCropSize] = useState(null);
  const stageRef = useRef(null);

  const rotation = baseRotation + fineRotation;

  // A fresh photo resets every per-photo control.
  // Declared BEFORE the working-image effect below so its reset of `flip`
  // (and the render it schedules) lands in the same batched re-render that
  // effect reacts to — no frame where the new photo shows the old flip.
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setBaseRotation(0);
    setFineRotation(0);
    setFlip(NO_FLIP);
    setCroppedAreaPixels(null);
    setMediaSize(null);
    setError('');
  }, [imageUrl]);

  // The visible framing rectangle is a fixed fraction of the stage's own
  // measured size (ALIGN_FRAME_WIDTH/HEIGHT_FRACTION), not the whole stage —
  // that's what leaves dimmed margin on every side rather than the box
  // touching the stage's edges. Only the ON-SCREEN pixel size varies by
  // device; the exported crop stays ALIGN_OUTPUT_WIDTH × ALIGN_OUTPUT_HEIGHT
  // regardless, since cropAlignedImage resamples from croppedAreaPixels
  // (natural source-image coordinates), never from this layout measurement.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      setCropSize({
        width: rect.width * ALIGN_FRAME_WIDTH_FRACTION,
        height: rect.height * ALIGN_FRAME_HEIGHT_FRACTION,
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Regenerates the working (possibly flipped) image whenever flip changes
  // or a new photo loads. The unflipped case is the common one and reuses
  // the prop URL directly — no extra canvas work, no extra object URL to
  // manage. Only an active flip allocates a working copy, and only one such
  // copy is ever alive at a time (this effect's own cleanup revokes the
  // previous one before/on unmount).
  useEffect(() => {
    if (!flip.horizontal && !flip.vertical) {
      setWorkingFile(file);
      setWorkingUrl(imageUrl);
      return undefined;
    }

    let cancelled = false;
    let createdUrl = null;

    setBusy(true);
    flipImage(file, flip)
      .then((flipped) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(flipped);
        setWorkingFile(flipped);
        setWorkingUrl(createdUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Flip failed:', err);
        setError('Could not flip this photo. Try again.');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [file, imageUrl, flip]);

  const overflowFraction =
    croppedAreaPixels && mediaSize
      ? getCropOverflowFraction(croppedAreaPixels, rotation, mediaSize)
      : 1;
  const coverageOk = overflowFraction <= ALIGN_MAX_OVERFLOW_FRACTION;
  const looksBlurry = !!croppedAreaPixels && croppedAreaPixels.width < ALIGN_BLUR_WARN_SOURCE_WIDTH;
  const isLastInBatch = photoIndex >= totalCount;

  const handleRotate90 = () => {
    setBaseRotation((prev) => (prev + ALIGN_ROTATION_STEP_DEG) % 360);
    // Recenters the straighten slider relative to the new quarter-turn,
    // matching how iOS Photos resets its own straighten dial after a quick
    // rotate rather than letting the two compound unpredictably.
    setFineRotation(0);
  };

  const toggleFlipHorizontal = () =>
    setFlip((prev) => ({ ...prev, horizontal: !prev.horizontal }));
  const toggleFlipVertical = () => setFlip((prev) => ({ ...prev, vertical: !prev.vertical }));

  const handleConfirm = async () => {
    if (!coverageOk || !croppedAreaPixels || busy) return;
    setBusy(true);
    setError('');
    try {
      cropFileSeq += 1;
      const cropped = await cropAlignedImage({
        file: workingFile,
        croppedAreaPixels,
        rotation,
        mediaSize,
        fileName: `aligned-${Date.now()}-${cropFileSeq}.jpg`,
      });
      onConfirm(cropped);
    } catch (err) {
      console.error('Alignment crop failed:', err);
      setError('Could not process this photo. Try again or skip it.');
      setBusy(false);
    }
  };

  return (
    <div className="align-overlay">
      <div className="align-header">
        <button type="button" className="align-close" onClick={onCancel} aria-label="Close">
          ✕
        </button>
        <span className="align-title">Align Photo</span>
        {totalCount > 1 && (
          <span className="align-progress">
            Photo {photoIndex} of {totalCount}
          </span>
        )}
      </div>

      <div className="align-stage" ref={stageRef}>
        <Cropper
          image={workingUrl}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={ALIGN_ASPECT}
          cropSize={cropSize ?? undefined}
          minZoom={ALIGN_MIN_ZOOM}
          maxZoom={ALIGN_MAX_ZOOM}
          restrictPosition={false}
          showGrid={false}
          objectFit="contain"
          classes={{ cropAreaClassName: 'align-frame' }}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_area, pixels) => setCroppedAreaPixels(pixels)}
          onMediaLoaded={setMediaSize}
        />
      </div>

      <p className="align-hint">
        Keep the camera at a consistent distance and center the leaf within the box.
      </p>

      <div className="align-controls">
        <span className="align-control-label">Zoom</span>
        <input
          type="range"
          className="align-zoom"
          min={ALIGN_MIN_ZOOM}
          max={ALIGN_MAX_ZOOM}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          disabled={busy}
          aria-label="Zoom"
        />
      </div>

      <div className="align-controls">
        <span className="align-control-label">Straighten</span>
        <input
          type="range"
          className="align-zoom"
          min={-ALIGN_FINE_ROTATION_RANGE_DEG}
          max={ALIGN_FINE_ROTATION_RANGE_DEG}
          step={0.5}
          value={fineRotation}
          onChange={(e) => setFineRotation(parseFloat(e.target.value))}
          disabled={busy}
          aria-label="Straighten (fine rotation)"
        />
      </div>

      <div className="align-transform-row">
        <button type="button" className="align-rotate-btn" onClick={handleRotate90} disabled={busy}>
          <span aria-hidden="true">⟳</span> Rotate 90°
        </button>
        <button
          type="button"
          className={`align-flip-btn ${flip.horizontal ? 'is-selected' : ''}`}
          onClick={toggleFlipHorizontal}
          disabled={busy}
        >
          <span aria-hidden="true">⇋</span> Flip H
        </button>
        <button
          type="button"
          className={`align-flip-btn ${flip.vertical ? 'is-selected' : ''}`}
          onClick={toggleFlipVertical}
          disabled={busy}
        >
          <span aria-hidden="true">⇵</span> Flip V
        </button>
      </div>

      {(!coverageOk || looksBlurry || error) && (
        <p className="align-warning">
          {error ||
            (!coverageOk
              ? 'The frame extends past the edge of your photo. Zoom out or pan to fit it inside.'
              : 'Zoomed in very far — this photo may look blurry.')}
        </p>
      )}

      <div className="align-actions">
        {totalCount > 1 && (
          <button type="button" className="align-btn-skip" onClick={onSkip} disabled={busy}>
            Skip this photo
          </button>
        )}
        <button
          type="button"
          className="align-btn-confirm"
          onClick={handleConfirm}
          disabled={!coverageOk || busy}
        >
          {busy ? 'Processing…' : isLastInBatch ? 'Use Photo' : 'Use Photo & Next'}
        </button>
      </div>
    </div>
  );
}
