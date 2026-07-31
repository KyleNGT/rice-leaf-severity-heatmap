import { SES_COLORS, HEATMAP_LAYER_GENERAL } from '../constants/constants';
import { sesBandTable } from '../utils/sesScale';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';

/**
 * ============================================================
 * ColorLegend — IRRI SES 0–9 gradient, per active layer
 * ============================================================
 * The gradient itself is built from SES_COLORS (constants.js) — the single
 * definition of the ramp, shared with sesToColor/HeatmapOverlay/markers —
 * rather than a second hardcoded CSS gradient that could drift out of sync.
 *
 * General Threat has no PDLA breakpoints of its own (it's a MAX() of SES
 * classes, not a percentage — see sesGrid.js), so the PDLA tick row is only
 * shown for a single-disease layer, where it doubles as a reminder that
 * Leaf Blast's SES 9 starts at a lower PDLA than the shared scale's does.
 *
 * The disease layer toggle lives here on desktop, not on the bottom
 * ActionPanel card — that card is a centered floating element there and
 * the toggle was eating most of its height, blocking the map underneath.
 * ActionPanel still renders its own copy for mobile's bottom sheet, so the
 * two are mutually exclusive by viewport rather than duplicated.
 */
export default function ColorLegend({ activeLayer, layerName, availableLayers, onLayerChange }) {
  const isMobile = useIsMobileViewport();
  const isGeneral = !activeLayer || activeLayer === HEATMAP_LAYER_GENERAL;
  const gradient = `linear-gradient(to right, ${SES_COLORS.join(', ')})`;
  const bandTable = isGeneral ? null : sesBandTable(activeLayer);
  const showLayerToggle = !isMobile && availableLayers?.length > 1;

  return (
    <div className="color-legend">
      <span className="legend-title">
        {isGeneral ? 'General Threat (SES)' : `${layerName ?? activeLayer} (SES)`}
      </span>
      <div className="legend-gradient" style={{ background: gradient }} />
      <div className="legend-labels">
        <span>SES 0</span>
        <span>SES 3</span>
        <span>SES 6</span>
        <span>SES 9</span>
      </div>
      {bandTable && (
        <div className="legend-pdla-row">
          <span>0%</span>
          <span>{bandTable[2].lo}%</span>
          <span>{bandTable[5].lo}%</span>
          <span>&gt;{bandTable[8].lo}%</span>
        </div>
      )}
      {isGeneral && (
        <p className="legend-note">
          Highest disease class present at each point — not a percentage.
        </p>
      )}
      {showLayerToggle && (
        <div className="legend-layer-toggle">
          <label htmlFor="legend-layer-select" className="legend-layer-toggle-label">
            Filter by Disease
          </label>
          <select
            id="legend-layer-select"
            className="legend-layer-toggle-select"
            value={activeLayer}
            onChange={(e) => onLayerChange(e.target.value)}
          >
            {availableLayers.map((layer) => (
              <option key={layer.key} value={layer.key}>
                {layer.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
