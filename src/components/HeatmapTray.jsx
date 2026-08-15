import { HEATMAP_MIN_OPACITY, HEATMAP_MAX_OPACITY } from '../constants/constants';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';
import { useTrayDrag } from '../hooks/useTrayDrag';

/**
 * ============================================================
 * HeatmapTray — Collapsible Bottom Tray (Step 3 — Heatmap)
 * ============================================================
 * Same Google-Maps-style tray as SampleSheet (Step 2), applied to
 * the "Disease Pressure Heatmap" card so it no longer permanently
 * blocks the map it controls, on desktop or mobile. Unlike
 * SampleSheet, it mounts expanded — the card should show in full
 * the moment a heatmap is generated — and re-mounts (so it
 * re-expands) each time Step 3 is entered, since ActionPanel's
 * Step 3 branch is the only thing that renders it.
 *
 * Drag/tap/snap mechanics live in useTrayDrag, shared with
 * SampleSheet.
 */
export default function HeatmapTray({
  onResumeSampling,
  heatmapOpacity,
  onOpacityChange,
  heatmapData,
  availableLayers,
  heatmapLayer,
  onHeatmapLayerChange,
  onExportReport,
  onReset,
  isProcessing,
}) {
  const isMobile = useIsMobileViewport();
  const { expanded, dragging, containerRef, handleRef, dragStyle, handleProps } = useTrayDrag({
    initialExpanded: true,
  });

  return (
    <div className="action-panel action-panel--tray">
      <div
        ref={containerRef}
        className={`tray ${expanded ? 'tray--expanded' : ''} ${dragging ? 'tray--dragging' : ''}`}
        style={dragStyle}
      >
        <div
          ref={handleRef}
          className="tray-handle-row"
          aria-label="Disease Pressure Heatmap — drag or tap to collapse"
          {...handleProps}
        >
          <span className="tray-handle-bar" aria-hidden="true" />
          <span className="tray-title">Disease Pressure Heatmap</span>
          <span className={`tray-chevron ${expanded ? 'tray-chevron--expanded' : ''}`} aria-hidden="true" />
        </div>

        <div className="tray-content">
          {/* Layer toggle — mobile only. On desktop this same control lives
              on ColorLegend instead, since it was eating most of this
              card's height and blocking the map underneath it. Hidden
              entirely when the field has no disease reading at all, in
              which case General is the only layer there is. */}
          {heatmapData && availableLayers?.length > 1 && isMobile && (
            <div className="layer-toggle" role="group" aria-label="Heatmap layer">
              {availableLayers.map((layer) => (
                <button
                  key={layer.key}
                  type="button"
                  className={`layer-toggle-btn ${heatmapLayer === layer.key ? 'layer-toggle-btn--active' : ''}`}
                  onClick={() => onHeatmapLayerChange(layer.key)}
                  aria-pressed={heatmapLayer === layer.key}
                >
                  {layer.name}
                </button>
              ))}
            </div>
          )}

          {heatmapData && (
            <div className="opacity-control">
              <label htmlFor="opacity-slider" className="opacity-label">
                Overlay Opacity
              </label>
              <input
                id="opacity-slider"
                type="range"
                min={HEATMAP_MIN_OPACITY * 100}
                max={HEATMAP_MAX_OPACITY * 100}
                value={Math.round(heatmapOpacity * 100)}
                onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
                className="opacity-slider"
              />
              <span className="opacity-value">{Math.round(heatmapOpacity * 100)}%</span>
            </div>
          )}

          <button className="btn btn-primary btn-full" onClick={onResumeSampling}>
            Add More Samples
          </button>

          {heatmapData && (
            <button
              type="button"
              className="btn btn-secondary btn-full"
              onClick={onExportReport}
              disabled={isProcessing}
            >
              Export PDF Report
            </button>
          )}

          <button className="btn btn-secondary btn-full" onClick={onReset}>
            <svg
              className="btn-icon-svg"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 8a6 6 0 1 1 1.8 4.3" />
              <path d="M2 12.5V8.5h4" />
            </svg>
            Start New Analysis
          </button>
        </div>
      </div>
    </div>
  );
}
