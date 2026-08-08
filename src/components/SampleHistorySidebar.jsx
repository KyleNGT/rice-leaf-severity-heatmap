import { useEffect, useRef, useState } from 'react';
import { sesToColor, sampleSesForLayer } from '../utils/sesScale';
import { HEATMAP_LAYER_GENERAL, MIN_SAMPLES } from '../constants/constants';
import MaskLayersIcon from './MaskLayersIcon';

/** Plant row headline: every disease this plant carries, comma-joined —
 * never just the dominant one. Falls back to diseaseName for any record
 * committed before diseaseFindings existed. */
function plantDiseaseSummary(sample) {
  const findings = sample.diseaseFindings;
  if (!findings) return sample.diseaseName;
  if (findings.length === 0) return 'Healthy';
  return findings.map((f) => f.displayName).join(', ');
}

const LOCATION_SOURCE_LABEL = {
  gps: 'GPS',
  exif: 'From photo',
  manual: 'Manual',
};

function formatCapturedAt(capturedAt) {
  if (!capturedAt) return '';
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * ============================================================
 * SampleHistorySidebar — Heatmap-step plant/photo audit trail
 * ============================================================
 * Hidden by default behind a left-edge tab. Lists every committed
 * plant sample with its pooled result, then — per plant, expandable —
 * every individual photo that went into it: thumbnail, per-photo
 * severity, disease class, confidence, and whether it was actually
 * counted (a flagged/failed photo stays visible but marked excluded,
 * same "legible from its own tile" principle as the sampling strip).
 *
 * `isOpen`/`expandedIds` stay internal — pure presentation detail App has
 * no use for. What App DOES need to drive from outside is the map/sidebar
 * link:
 *
 *   - `selection` — the plant currently picked, from EITHER direction (a
 *     map node clicked, or a row clicked here). `{ id, origin, seq }`.
 *     `origin` distinguishes who initiated it: only a `'map'`-origin
 *     selection should force this sidebar open/expanded/scrolled-to — a
 *     `'sidebar'`-origin one means the click happened right here, so the
 *     row is already open and doesn't need to be re-driven from the prop
 *     (see the effect below; this is also what stops a click that COLLAPSES
 *     an already-open row from immediately springing back open — that
 *     click still reports the selection upward for the map's benefit, but
 *     since its origin is 'sidebar' this component ignores its own echo).
 *     `seq` increments on every pick so re-selecting the SAME plant after
 *     closing the sidebar still re-triggers the open/expand/scroll effect.
 *   - `onFocusOnMap(sample)` — called on every row click (expand or
 *     collapse alike) so the map can fly to it and pulse the node.
 *
 * `activeLayer` — the heatmap layer currently shown on the map (General or
 * one disease). Each row's dot and severity color follow it via
 * sesScale.js's sampleSesForLayer, exactly like SampleMarker, so a plant's
 * color agrees between the sidebar and the map for whichever layer is up.
 *
 * `onExportLoocv(samples)` — optional; when provided, a low-prominence
 * button renders at the end of the plant list (below every row, still
 * inside this hidden panel) that runs Leave-One-Out Cross-Validation over
 * the session and downloads the results — see exportLoocv.js. Gated on
 * MIN_SAMPLES, same floor computeIDW itself requires. This component stays
 * purely presentational: it renders the button and forwards the click, all
 * computation happens in the caller (App.jsx's handleExportLoocv).
 */
export default function SampleHistorySidebar({
  samples,
  selection,
  onFocusOnMap,
  activeLayer,
  onInspectMasks,
  onExportLoocv,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const contentRef = useRef(null);
  const rowRefs = useRef(new Map());

  const togglePlant = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRowClick = (sample) => {
    togglePlant(sample.id);
    onFocusOnMap?.(sample);
  };

  // A node clicked on the map opens this sidebar and expands/scrolls to it.
  // Gated to origin === 'map' so a sidebar-originated selection (the user
  // just clicked this same row) doesn't re-drive itself — see the docblock.
  useEffect(() => {
    if (!selection || selection.origin !== 'map') return;

    setIsOpen(true);
    // Additive: expanding the map-selected plant must not collapse a
    // different plant the user already had open by hand.
    setExpandedIds((prev) => new Set(prev).add(selection.id));

    const raf = requestAnimationFrame(() => {
      const row = rowRefs.current.get(selection.id);
      const container = contentRef.current;
      if (!row || !container) return;
      // Manual scrollTop math against the actual scroll container, not
      // scrollIntoView — this panel is mid CSS-transform slide-in at the
      // same moment (see .history-sidebar's transition), and
      // scrollIntoView's ancestor-walking behavior for that case is
      // inconsistent across engines. Reading getBoundingClientRect() and
      // computing the delta ourselves is exact and unaffected by the
      // ancestor's transform.
      const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top - 8;
      container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [selection]);

  // Escape closes the sidebar — needed on desktop now that its backdrop is
  // suppressed there (see .history-backdrop's tablet+ media query in
  // App.css) so nodes stay clickable behind an open sidebar; without a
  // backdrop to click away on, keyboard/Escape is the fast close path.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const totalPhotos = samples.reduce((sum, s) => sum + (s.imageCount ?? s.images?.length ?? 0), 0);

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          className="history-toggle-btn"
          onClick={() => setIsOpen(true)}
          aria-label="Show sample history"
        >
          <span>Sample History</span>
          <span className="history-toggle-count">{samples.length}</span>
        </button>
      )}

      {isOpen && (
        <div className="history-backdrop" onClick={() => setIsOpen(false)} aria-hidden="true" />
      )}

      <aside
        className={`history-sidebar ${isOpen ? 'is-open' : ''}`}
        aria-hidden={!isOpen}
      >
        <div className="history-sidebar-header">
          <div>
            <h3 className="history-sidebar-title">Sample History</h3>
            <p className="history-sidebar-subtitle">
              {samples.length} {samples.length === 1 ? 'plant' : 'plants'} · {totalPhotos}{' '}
              {totalPhotos === 1 ? 'photo' : 'photos'}
            </p>
          </div>
          <button
            type="button"
            className="history-close-btn"
            onClick={() => setIsOpen(false)}
            aria-label="Close sample history"
          >
            ×
          </button>
        </div>

        <div className="history-sidebar-content" ref={contentRef}>
          {samples.length === 0 && (
            <p className="history-empty">No plant samples recorded yet.</p>
          )}

          {samples.map((sample, index) => {
            const layerKey = activeLayer ?? HEATMAP_LAYER_GENERAL;
            const ses = sampleSesForLayer(sample, layerKey);
            const color = sesToColor(ses);
            const expanded = expandedIds.has(sample.id);
            const isSelected = selection?.id === sample.id;
            const photos = sample.images ?? [];
            const locationLabel = LOCATION_SOURCE_LABEL[sample.locationSource] ?? '';
            const capturedLabel = formatCapturedAt(sample.capturedAt);

            return (
              <div key={sample.id} className={`history-plant ${isSelected ? 'is-selected' : ''}`}>
                <button
                  type="button"
                  className="history-plant-header"
                  onClick={() => handleRowClick(sample)}
                  aria-expanded={expanded}
                  ref={(node) => {
                    rowRefs.current.set(sample.id, node);
                    return () => rowRefs.current.delete(sample.id);
                  }}
                >
                  <span className="history-plant-dot" style={{ background: color }} />
                  <span className="history-plant-main">
                    <span className="history-plant-title-row">
                      <span className="history-plant-label">Plant #{index + 1}</span>
                      <span className="history-plant-severity" style={{ color }}>
                        {sample.severity.toFixed(1)}% · SES {Math.floor(ses)}
                      </span>
                    </span>
                    <span className="history-plant-meta">
                      {plantDiseaseSummary(sample)}
                      {' · '}
                      {sample.usableImageCount ?? photos.length} of{' '}
                      {sample.imageCount ?? photos.length}{' '}
                      {(sample.imageCount ?? photos.length) === 1 ? 'photo' : 'photos'} used
                    </span>
                    <span className="history-plant-coords">
                      {sample.lat.toFixed(6)}, {sample.lng.toFixed(6)}
                      {locationLabel ? ` · ${locationLabel}` : ''}
                      {capturedLabel ? ` · ${capturedLabel}` : ''}
                    </span>
                  </span>
                  <span className={`history-plant-chevron ${expanded ? 'is-expanded' : ''}`}>
                    ›
                  </span>
                </button>

                {expanded && (
                  <ul className="history-photo-list">
                    {photos.length === 0 && (
                      <li className="history-empty-photos">No photo detail retained.</li>
                    )}
                    {photos.map((photo, photoIndex) => (
                      <li key={photo.id} className={`history-photo ${photo.usable ? '' : 'is-excluded'}`}>
                        <img
                          className="history-photo-thumb"
                          src={photo.thumbnail}
                          alt={`Plant ${index + 1} photo ${photoIndex + 1}`}
                        />
                        <div className="history-photo-meta">
                          <span className="history-photo-severity">
                            {photo.severity != null ? `${photo.severity.toFixed(1)}%` : 'Excluded'}
                          </span>
                          <span className="history-photo-disease">
                            {photo.diseaseName ?? (photo.usable ? '—' : 'Not counted')}
                          </span>
                          {photo.confidence != null && (
                            <span className="history-photo-confidence">
                              confidence {parseFloat(photo.confidence).toFixed(2)}
                            </span>
                          )}
                        </div>
                        {photo.masks && (
                          <button
                            type="button"
                            className="mask-inspect-btn history-photo-masks"
                            onClick={() =>
                              onInspectMasks({
                                title: `Plant #${index + 1} · Photo ${photoIndex + 1}`,
                                subtitle:
                                  photo.severity != null
                                    ? `${photo.diseaseName ?? 'Healthy'} · ${photo.severity.toFixed(1)}%`
                                    : undefined,
                                originalSrc: photo.thumbnail,
                                masks: photo.masks,
                              })
                            }
                            aria-label={`Inspect model output for plant ${index + 1} photo ${photoIndex + 1}`}
                            title="Inspect model output"
                          >
                            <MaskLayersIcon />
                            <span>Masks</span>
                          </button>
                        )}
                        {!photo.usable && <span className="history-photo-badge">Excluded</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          {onExportLoocv && samples.length >= MIN_SAMPLES && (
            <button
              type="button"
              className="history-loocv-btn"
              onClick={() => onExportLoocv(samples)}
              title="Run Leave-One-Out Cross-Validation over this session's plant samples and download the results"
            >
              Export LOOCV Validation (CSV + JSON)
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
