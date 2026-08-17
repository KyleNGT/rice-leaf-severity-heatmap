import { useState, useRef, useEffect, useCallback } from 'react';
import { HEATMAP_MIN_OPACITY, HEATMAP_MAX_OPACITY } from '../constants/constants';
import ColorLegend from './ColorLegend';

/**
 * ============================================================
 * HeatmapControls — Step 3 control set (legend, layers, opacity, actions)
 * ============================================================
 * The single source of these controls, rendered by two different shells:
 * `HeatmapTray` (mobile, draggable bottom tray) and `MapSidebar` (desktop,
 * left sidebar's Heatmap tab). Neither shell duplicates this markup — a
 * change here lands on both surfaces at once.
 *
 * The layer switcher renders as one always-visible list on every viewport
 * (previously split between a mobile popover here and a desktop <select> in
 * ColorLegend) — both hosts have vertical room for the list form.
 *
 * The opacity slider positions its thumb by percent, not by measuring
 * sliderRef's pixel width, because this component can be laid out mid
 * CSS-transform (the sidebar sliding open) or fully collapsed (the mobile
 * tray) at the moment the sync effect runs — a getBoundingClientRect() read
 * in either case gives the wrong width. Percent-based left plus a CSS
 * translateX(-50%) on .slider-thumb (see App.css) sidesteps that; drag
 * input still reads the rect, which is correct because dragging only
 * happens while the control is visible and laid out.
 *
 * The track's full width is mapped onto [HEATMAP_MIN_OPACITY,
 * HEATMAP_MAX_OPACITY], not [0, 100] — the printed end labels ARE the
 * slider's actual range, so dragging to either end must land exactly on
 * them (a raw 0–100 track would let the far-left end silently set 0%,
 * making the overlay invisible despite the label reading 20%).
 */
export default function HeatmapControls({
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
  // ── Slider Logic
  const sliderRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  // Track fraction (0–1, how far across the slider the pointer is) maps
  // onto the [MIN, MAX] opacity range, not [0, 1] — see the docblock above.
  const opacityFromFraction = useCallback(
    (fraction) => HEATMAP_MIN_OPACITY + fraction * (HEATMAP_MAX_OPACITY - HEATMAP_MIN_OPACITY),
    []
  );

  // Inverse of the above, for rendering the thumb/progress position from
  // the current opacity value.
  const fractionFromOpacity = useCallback(
    (opacity) =>
      Math.max(
        0,
        Math.min(1, (opacity - HEATMAP_MIN_OPACITY) / (HEATMAP_MAX_OPACITY - HEATMAP_MIN_OPACITY))
      ),
    []
  );

  const opacityFromClientX = useCallback((clientX) => {
    const rect = sliderRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return opacityFromFraction(fraction);
  }, [opacityFromFraction]);

  const handleStart = useCallback((e) => {
    setIsDragging(true);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    onOpacityChange(opacityFromClientX(clientX));
  }, [onOpacityChange, opacityFromClientX]);

  const handleMove = useCallback((e) => {
    if (!isDragging || !sliderRef.current) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    onOpacityChange(opacityFromClientX(clientX));
  }, [isDragging, onOpacityChange, opacityFromClientX]);

  const handleEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Global event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleEnd);
      document.addEventListener('touchmove', handleMove, { passive: false });
      document.addEventListener('touchend', handleEnd);
      return () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleEnd);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleEnd);
      };
    }
  }, [isDragging, handleMove, handleEnd]);
  // ── End Slider Logic

  const selectedLayer = availableLayers?.find((layer) => layer.key === heatmapLayer) ?? availableLayers?.[0];
  const opacityPercent = Math.round(heatmapOpacity * 100);
  const thumbPercent = fractionFromOpacity(heatmapOpacity) * 100;

  return (
    <div className="heatmap-controls">
      {heatmapData && (
        <div className="heatmap-legend-group">
          <h4 className="map-settings-title">Legend</h4>
          <ColorLegend activeLayer={heatmapLayer} layerName={selectedLayer?.name} />
        </div>
      )}

      <div className="map-settings-group">
        {heatmapData && availableLayers?.length > 1 && (
          <div className="heatmap-layer-menu">
            <h4 className="map-settings-title">Disease Layers</h4>
            <div className="heatmap-layer-list">
              {availableLayers.map((layer) => (
                <button
                  key={layer.key}
                  type="button"
                  className={`heatmap-layer-option ${heatmapLayer === layer.key ? 'is-selected' : ''}`}
                  aria-pressed={heatmapLayer === layer.key}
                  onClick={() => onHeatmapLayerChange(layer.key)}
                >
                  {layer.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {heatmapData && (
          <div className="opacity-panel">
            <div className="opacity-header">
              <span className="opacity-label">Overlay Opacity:</span>
              <span className="opacity-value">{opacityPercent}%</span>
            </div>

            <div
              className="slider-container"
              ref={sliderRef}
              onMouseDown={handleStart}
              onTouchStart={handleStart}
            >
              <div className="slider-progress" style={{ width: `${thumbPercent}%` }}></div>
              <div className="slider-thumb" style={{ left: `${thumbPercent}%` }}></div>
            </div>

            <div className="opacity-slider-labels">
              <span>{Math.round(HEATMAP_MIN_OPACITY * 100)}%</span>
              <span>Mid</span>
              <span>{Math.round(HEATMAP_MAX_OPACITY * 100)}%</span>
            </div>
          </div>
        )}
      </div>

      <div className="actions-panel">
        <button className="btn btn-primary btn-full" onClick={onResumeSampling}>
          <span className="btn-icon-plus" aria-hidden="true">＋</span>
          Add More Samples
        </button>

        {heatmapData && (
          <button
            type="button"
            className="btn btn-secondary btn-full"
            onClick={onExportReport}
            disabled={isProcessing}
          >
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
              <path d="M4 2.5h5L12 5.5v8A1.5 1.5 0 0 1 10.5 15h-6A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3H4Z" />
              <path d="M9 2.5V6h3" />
            </svg>
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
  );
}
