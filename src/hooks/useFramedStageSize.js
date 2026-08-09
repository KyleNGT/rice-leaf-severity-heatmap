import { useEffect, useRef, useState } from 'react';
import { ALIGN_ASPECT, ALIGN_STAGE_INSET_FRACTION } from '../constants/constants';

/**
 * ============================================================
 * useFramedStageSize — Shared Framing-Rectangle Geometry
 * ============================================================
 * Extracted verbatim from the ResizeObserver effect that used to live
 * inline in ImageAlignmentModal.jsx. Fits the largest ALIGN_ASPECT
 * rectangle that stays within ALIGN_STAGE_INSET_FRACTION of the stage
 * element's own measured size on EITHER axis — that's what leaves dimmed
 * margin on every side rather than the box touching the stage's edges,
 * while guaranteeing the on-screen box is always the same shape regardless
 * of the stage's own aspect (a tall stage used to produce a visibly
 * non-square box that still exported as a square, silently distorting the
 * image — see ALIGN_STAGE_INSET_FRACTION in constants.js).
 *
 * Both ImageAlignmentModal (the mandatory crop step) and CameraCaptureModal
 * (the live viewfinder that feeds it) call this ONE hook rather than each
 * computing their own box — otherwise the live blade-width guide and the
 * aligner's guide could silently mean two different rectangles, which
 * would defeat the entire point of showing the guide live.
 *
 * Returns `stageRef` (attach to the measured container) and `frameSize`
 * (`{ width, height }` in CSS px, or `null` before the first measurement).
 */
export function useFramedStageSize() {
  const stageRef = useRef(null);
  const [frameSize, setFrameSize] = useState(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const maxWidth = rect.width * ALIGN_STAGE_INSET_FRACTION;
      const maxHeight = rect.height * ALIGN_STAGE_INSET_FRACTION;
      let width = maxWidth;
      let height = width / ALIGN_ASPECT;
      if (height > maxHeight) {
        height = maxHeight;
        width = height * ALIGN_ASPECT;
      }
      const nextWidth = Math.round(width);
      const nextHeight = Math.round(height);
      // Skip the update (and the re-render it triggers) when the rounded
      // size hasn't actually changed — sub-pixel ResizeObserver noise would
      // otherwise reach consumers even though nothing the user can see moved.
      setFrameSize((prev) =>
        prev && prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      );
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return { stageRef, frameSize };
}
