import { useTrayDrag } from '../hooks/useTrayDrag';
import HeatmapControls from './HeatmapControls';

/**
 * ============================================================
 * HeatmapTray — Collapsible Bottom Tray (Step 3 — Heatmap, mobile only)
 * ============================================================
 * Same Google-Maps-style tray as SampleSheet (Step 2), applied to the
 * "Disease Pressure Heatmap" controls so they don't permanently block the
 * map on a phone screen. On desktop these same controls render instead in
 * MapSidebar's Heatmap tab, where there's room for them beside the map
 * rather than over it — ActionPanel only mounts this tray when
 * useIsMobileViewport() is true. Mounts expanded — the card should show in
 * full the moment a heatmap is generated — and re-mounts (so it
 * re-expands) each time Step 3 is entered, since ActionPanel's Step 3
 * branch is the only thing that renders it.
 *
 * Drag/tap/snap mechanics live in useTrayDrag, shared with SampleSheet.
 * All control markup lives in HeatmapControls.jsx, shared with the
 * desktop sidebar — this file is chrome only.
 */
export default function HeatmapTray(props) {
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
          aria-label="Heatmap Details — drag or tap to collapse"
          {...handleProps}
        >
          <span className="tray-handle-bar" aria-hidden="true" />
          <span className="tray-title">Heatmap Details</span>
          <span className={`tray-chevron ${expanded ? 'tray-chevron--expanded' : ''}`} aria-hidden="true" />
        </div>

        <div className="tray-content">
          <HeatmapControls {...props} />
        </div>
      </div>
    </div>
  );
}
