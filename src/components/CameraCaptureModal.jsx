import { useEffect, useRef, useState } from 'react';
import { useFramedStageSize } from '../hooks/useFramedStageSize';
import AlertTriangleIcon from './AlertTriangleIcon';
import { ALIGN_GUIDE_WIDTH_FRACTION, ALIGN_JPEG_QUALITY, ALIGN_FRAMING_HINT } from '../constants/constants';

/**
 * ============================================================
 * CameraCaptureModal — Live In-App Camera Viewfinder
 * ============================================================
 * Only reachable when cameraSupport.js's `supportsLiveCamera()` was true at
 * click time (secure context + `navigator.mediaDevices.getUserMedia`
 * present) — SamplePanel falls back to the existing
 * `<input capture="environment">` system-camera handoff otherwise, and
 * again here if the stream itself fails (denied permission, no camera,
 * camera already in use elsewhere) via `onFallbackToSystemCamera`.
 *
 * This modal FEEDS ImageAlignmentModal — it does not replace it. The
 * shutter produces one plain `File`, exactly like the system camera or a
 * gallery pick would, and hands it to the same `handleImagesSelected`
 * (App.jsx) that already caps against MAX_IMAGES_PER_SAMPLE, fires the GPS
 * fix, and enqueues it for the mandatory alignment crop. Nothing about
 * cropToStencil.js, the overflow gate, or the 1024×1024 output guarantee
 * changes because of this component — "every photo passes through
 * alignment" still holds.
 *
 * The framing rectangle and dashed blade-width guide are the SAME rectangle
 * ImageAlignmentModal draws — both call useFramedStageSize() (shared
 * geometry) and both style the guide with the shared
 * `.align-frame::before`/`.cam-frame::before` CSS rule (App.css) driven by
 * the same `--align-guide-width-fraction` var. Showing that guide live,
 * while the shot is being composed, is the entire point of this
 * component — see CLAUDE.md's Plant-Level Pooling / Sample Acquisition
 * Methods sections for why blade-width consistency matters to
 * aggregateSample.js's pixel-count pooling. It remains PURELY VISUAL:
 * nothing here measures or enforces whether the leaf actually fits it.
 *
 * Capture is a plain <canvas> + drawImage, not `ImageCapture.takePhoto()`
 * (no Safari support). It captures the STAGE'S VISIBLE WINDOW of the video,
 * not the raw sensor frame — the video is displayed with `object-fit:
 * cover`, so a naive `videoWidth × videoHeight` capture would hand the
 * aligner pixels the farmer never saw framed. See handleShutter below.
 *
 * Rendered by App.jsx as a direct child of `.app`, same reasoning as
 * ImageAlignmentModal/MaskInspectorModal: `.sheet` carries a CSS transform
 * that would become the containing block for this modal's `position:
 * fixed` root.
 */
export default function CameraCaptureModal({ onCapture, onCancel, onFallbackToSystemCamera }) {
  const { stageRef, frameSize } = useFramedStageSize();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streamError, setStreamError] = useState('');

  // Acquire the rear camera once on mount; stop every track on unmount so
  // the camera doesn't stay hot (battery drain on the mid-range Android
  // this app targets) and the browser's camera-in-use indicator clears.
  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1920 },
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Camera access failed:', err);
        setStreamError(
          err.name === 'NotAllowedError'
            ? 'Camera access was denied.'
            : err.name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : 'Could not start the camera.'
        );
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const handleShutter = () => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || !stage || busy) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    setBusy(true);

    // Map the stage's visible window back into video pixels — the same
    // math `object-fit: cover` uses to decide what's on screen, run in
    // reverse, so the captured File matches exactly what the farmer framed
    // (not the full, uncropped sensor frame).
    const stageRect = stage.getBoundingClientRect();
    const scale = Math.max(stageRect.width / vw, stageRect.height / vh);
    const visW = stageRect.width / scale;
    const visH = stageRect.height / scale;
    const sx = (vw - visW) / 2;
    const sy = (vh - visH) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(visW);
    canvas.height = Math.round(visH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, sx, sy, visW, visH, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        setBusy(false);
        if (!blob) {
          setStreamError('Could not capture this photo. Try again.');
          return;
        }
        onCapture(new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      ALIGN_JPEG_QUALITY
    );
  };

  return (
    <div className="cam-overlay">
      <div className="cam-header">
        <button type="button" className="cam-close" onClick={onCancel} aria-label="Close">
          ✕
        </button>
        <span className="cam-title">Take Leaf Photo</span>
      </div>

      <div
        className="cam-stage"
        ref={stageRef}
        style={{ '--align-guide-width-fraction': ALIGN_GUIDE_WIDTH_FRACTION }}
      >
        {!streamError && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => setReady(true)}
          />
        )}
        {!streamError && frameSize && (
          <div
            className="cam-frame"
            style={{ width: frameSize.width, height: frameSize.height }}
            aria-hidden="true"
          />
        )}
        {streamError && (
          <div className="cam-error">
            <AlertTriangleIcon />
            <p className="cam-error-text">{streamError}</p>
            <button type="button" className="cam-fallback-btn" onClick={onFallbackToSystemCamera}>
              Use system camera instead
            </button>
          </div>
        )}
      </div>

      <p className="cam-hint">{ALIGN_FRAMING_HINT}</p>

      <div className="cam-actions">
        <button
          type="button"
          className="cam-shutter"
          onClick={handleShutter}
          disabled={!ready || busy || !!streamError}
          aria-label="Take photo"
        />
      </div>
    </div>
  );
}
