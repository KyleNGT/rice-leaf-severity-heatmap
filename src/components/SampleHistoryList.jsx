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
 * SampleHistoryList — Heatmap-step plant/photo audit trail
 * ============================================================
 * Purely presentational list, one pane inside MapSidebar's Sample History
 * tab. Lists every committed plant sample with its pooled result, then —
 * per plant, expandable — every individual photo that went into it:
 * thumbnail, per-photo severity, disease class, confidence, and whether it
 * was actually counted (a flagged/failed photo stays visible but marked
 * excluded, same "legible from its own tile" principle as the sampling
 * strip).
 *
 * Open/close and tab selection are MapSidebar's job now — this component
 * only owns row-level state (`expandedId`) and the map/sidebar selection
 * link. Accordion: at most one plant's photo detail is open at a time —
 * expanding a new row collapses whichever was open, hence a single
 * `expandedId` rather than a Set.
 *
 *   - `selection` — the plant currently picked, from EITHER direction (a
 *     map node clicked, or a row clicked here). `{ id, origin, seq }`.
 *     `origin` distinguishes who initiated it: only a `'map'`-origin
 *     selection should force this list to expand/scroll to a row — a
 *     `'sidebar'`-origin one means the click happened right here, so the
 *     row is already open and doesn't need to be re-driven from the prop
 *     (see the effect below; this is also what stops a click that COLLAPSES
 *     an already-open row from immediately springing back open — that
 *     click still reports the selection upward for the map's benefit, but
 *     since its origin is 'sidebar' this component ignores its own echo).
 *     `seq` increments on every pick so re-selecting the SAME plant after
 *     switching away from this tab still re-triggers the expand/scroll
 *     effect.
 *   - `onFocusOnMap(sample)` — called on every row click (expand or
 *     collapse alike) so the map can fly to it and pulse the node.
 *   - `active` — whether this pane is the currently-shown sidebar tab.
 *     The expand/scroll effect no-ops while inactive, since
 *     getBoundingClientRect() against a hidden pane is meaningless; the
 *     effect re-runs (via `seq`/`active` in its deps) once the tab
 *     becomes active again.
 *
 * `activeLayer` — the heatmap layer currently shown on the map (General or
 * one disease). Each row's dot and severity color follow it via
 * sesScale.js's sampleSesForLayer, exactly like SampleMarker, so a plant's
 * color agrees between the sidebar and the map for whichever layer is up.
 *
 * `onExportLoocv(samples)` — optional; when provided, a button styled like
 * the Heatmap tab's Export PDF Report (.btn.btn-secondary.btn-full, not the
 * old low-prominence dashed style) renders at the end of the plant list
 * that runs Leave-One-Out Cross-Validation over the session and downloads
 * the results — see exportLoocv.js. Gated on MIN_SAMPLES, same floor
 * computeIDW itself requires. This component stays purely presentational:
 * it renders the button and forwards the click, all computation happens in
 * the caller (App.jsx's handleExportLoocv).
 */
export default function SampleHistoryList({
  samples,
  selection,
  onFocusOnMap,
  activeLayer,
  onInspectMasks,
  onExportLoocv,
  active,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const contentRef = useRef(null);
  const rowRefs = useRef(new Map());

  const togglePlant = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleRowClick = (sample) => {
    togglePlant(sample.id);
    onFocusOnMap?.(sample);
  };

  // A node clicked on the map expands/scrolls to it. Gated to
  // origin === 'map' so a sidebar-originated selection (the user just
  // clicked this same row) doesn't re-drive itself — see the docblock.
  // Gated to `active` because getBoundingClientRect() against a hidden
  // (inactive-tab) pane is meaningless — see docblock.
  useEffect(() => {
    if (!active || !selection || selection.origin !== 'map') return;

    // Accordion: the map-selected plant becomes the one open row, same as
    // a manual row click — replaces, not adds to, whatever was open.
    setExpandedId(selection.id);

    const raf = requestAnimationFrame(() => {
      const row = rowRefs.current.get(selection.id);
      const container = contentRef.current;
      if (!row || !container) return;
      // Manual scrollTop math against the actual scroll container, not
      // scrollIntoView — this panel is mid CSS-transform slide-in at the
      // same moment (see .map-sidebar's transition), and
      // scrollIntoView's ancestor-walking behavior for that case is
      // inconsistent across engines. Reading getBoundingClientRect() and
      // computing the delta ourselves is exact and unaffected by the
      // ancestor's transform.
      const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top - 8;
      container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [selection, active]);

  const totalPhotos = samples.reduce((sum, s) => sum + (s.imageCount ?? s.images?.length ?? 0), 0);

  return (
    <div className="history-sidebar-content" ref={contentRef}>
      <p className="history-list-summary">
        {samples.length} {samples.length === 1 ? 'plant' : 'plants'} · {totalPhotos}{' '}
        {totalPhotos === 1 ? 'photo' : 'photos'}
      </p>

      {samples.length === 0 && (
        <p className="history-empty">No plant samples recorded yet.</p>
      )}

      {samples.map((sample, index) => {
        const layerKey = activeLayer ?? HEATMAP_LAYER_GENERAL;
        const ses = sampleSesForLayer(sample, layerKey);
        const color = sesToColor(ses);
        const expanded = expandedId === sample.id;
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
          className="btn btn-secondary btn-full history-loocv-btn"
          onClick={() => onExportLoocv(samples)}
          title="Run Leave-One-Out Cross-Validation over this session's plant samples and download the results"
        >
          <span className="history-loocv-btn-label">
            Export LOOCV Validation
            <br />
            (2 CSV + JSON)
          </span>
        </button>
      )}
    </div>
  );
}
