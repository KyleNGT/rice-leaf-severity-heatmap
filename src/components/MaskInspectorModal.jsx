import { useEffect, useRef } from 'react';

/**
 * ============================================================
 * MaskInspectorModal — Phase 1 / Phase 2 model output viewer
 * ============================================================
 * Shows the aligned photo next to the two intermediate segmentation
 * outputs PDLA is computed from: Phase 1's binary leaf mask (the
 * denominator) and Phase 2's per-class disease mask (the numerator).
 * Raw masks, not overlays — flat colors on black, exactly what each
 * model emitted.
 *
 * Rendered by App.jsx as a SIBLING of <SampleSheet>, never nested inside
 * it — same reason as ImageAlignmentModal: `.sheet` carries a CSS
 * transform, which becomes the containing block for a nested
 * `position: fixed` root and drags it around with the sheet instead of
 * the viewport. The existing .upload-lightbox inside SamplePanel has this
 * bug; this component deliberately does not repeat it.
 *
 * Pure presentation — formats nothing. `title`/`subtitle` arrive
 * already-formatted from the caller (SamplePanel or SampleHistorySidebar),
 * which each already have their own severity/diagnosis formatting for
 * their own tiles.
 *
 * The `masks` prop is the backend's `masks` block verbatim
 * (backend/inference.py's _build_mask_previews): { leaf, disease, size_wh,
 * source_size_wh, class_order, palette, class_names, leaf_color }. The
 * legend below is a pure map over `class_order`/`palette`/`class_names` —
 * no class list is hardcoded here, so a re-trained model with different
 * classes renders correctly with zero changes to this file.
 */
export default function MaskInspectorModal({ title, subtitle, originalSrc, masks, onClose }) {
  const closeRef = useRef(null);
  const openerRef = useRef(document.activeElement);

  useEffect(() => {
    closeRef.current?.focus();
    const opener = openerRef.current;
    return () => {
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!masks) return null;

  const classOrder = masks.class_order ?? [];
  const palette = masks.palette ?? {};
  const classNames = masks.class_names ?? {};

  return (
    <div className="mask-overlay" onClick={onClose}>
      <div
        className="mask-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mask-inspector-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mask-header">
          <button
            type="button"
            ref={closeRef}
            className="mask-close"
            onClick={onClose}
            aria-label="Close model output viewer"
          >
            ✕
          </button>
          <span className="mask-title-group">
            <span id="mask-inspector-title" className="mask-title">
              {title}
            </span>
            {subtitle && <span className="mask-subtitle">{subtitle}</span>}
          </span>
        </div>

        <div className="mask-grid">
          <figure className="mask-pane mask-pane--original">
            <figcaption>Aligned photo</figcaption>
            <img src={originalSrc} alt="Aligned rice leaf photo" />
          </figure>

          <figure className="mask-pane mask-pane--leaf">
            <figcaption>Phase 1 — leaf mask</figcaption>
            <img className="mask-pane-img" src={masks.leaf} alt="Phase 1 binary leaf segmentation mask" />
          </figure>

          <figure className="mask-pane mask-pane--disease">
            <figcaption>Phase 2 — disease mask</figcaption>
            <img
              className="mask-pane-img"
              src={masks.disease}
              alt="Phase 2 disease class segmentation mask"
            />
          </figure>
        </div>

        <p className="mask-caption">
          Preview is downscaled. Very small lesions may not appear here even though they are
          counted — the percentage is measured at full resolution.
        </p>

        <div className="mask-legend">
          <div className="mask-legend-group">
            <span className="mask-legend-label">Phase 1</span>
            <span className="mask-legend-item">
              <span className="mask-swatch" style={{ background: masks.leaf_color ?? '#ffffff' }} />
              Leaf
            </span>
            <span className="mask-legend-item">
              <span className="mask-swatch" style={{ background: '#000000' }} />
              Not leaf
            </span>
          </div>
          <div className="mask-legend-group">
            <span className="mask-legend-label">Phase 2</span>
            {classOrder.map((label) => (
              <span className="mask-legend-item" key={label}>
                <span className="mask-swatch" style={{ background: palette[label] ?? '#000000' }} />
                {classNames[label] ?? label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
