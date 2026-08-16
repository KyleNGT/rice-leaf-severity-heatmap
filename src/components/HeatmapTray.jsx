import { useState, useRef, useEffect, useCallback } from 'react';
import { HEATMAP_MIN_OPACITY, HEATMAP_MAX_OPACITY } from '../constants/constants';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';
import { useTrayDrag } from '../hooks/useTrayDrag';
import ColorLegend from './ColorLegend';

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
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const { expanded, dragging, containerRef, handleRef, dragStyle, handleProps } = useTrayDrag({
    initialExpanded: true,
  });

  // ── Slider Logic 
  const sliderRef = useRef(null);
  const progressRef = useRef(null);
  const thumbRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const updateSlider = useCallback((percent) => {
    if (!sliderRef.current || !progressRef.current || !thumbRef.current) return;
    const clamped = Math.max(HEATMAP_MIN_OPACITY * 100, Math.min(100, percent));
    const rect = sliderRef.current.getBoundingClientRect();
    const px = (clamped / 100) * rect.width;
    
    progressRef.current.style.width = `${clamped}%`;
    thumbRef.current.style.left = `${px}px`;
  }, []);

  // Sync slider when props change (e.g. Reset)
  useEffect(() => {
    if (!sliderRef.current || isDragging) return;
    updateSlider(heatmapOpacity * 100);
  }, [heatmapOpacity, isDragging, updateSlider]);

  const handleStart = useCallback((e) => {
    setIsDragging(true);
    const rect = sliderRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    updateSlider(percent);
    onOpacityChange(percent / 100);
  }, [onOpacityChange, updateSlider]);

  const handleMove = useCallback((e) => {
    if (!isDragging || !sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    updateSlider(percent);
    onOpacityChange(percent / 100);
  }, [isDragging, onOpacityChange, updateSlider]);

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
          <span className={`tray-chevron ${expanded ? 'tray-chevron--expanded' : ''}`} aria-hidden="true" />
        </div>

        <div className="tray-content">
          {/* Relocated Legend */}
          {heatmapData && (
            <ColorLegend
              activeLayer={heatmapLayer}
              layerName={selectedLayer?.name}
              availableLayers={availableLayers}
              onLayerChange={onHeatmapLayerChange}
            />
          )}

          {/* Group Map Controls */}
          <div className="map-settings-group">
            <h4 className="map-settings-title">Map Settings</h4>

            {heatmapData && availableLayers?.length > 1 && isMobile && (
              <div className="heatmap-layer-menu">
                <button
                  type="button"
                  className="heatmap-layer-trigger"
                  onClick={() => setLayerMenuOpen((prev) => !prev)}
                  aria-expanded={layerMenuOpen}
                >
                  <span>Heatmap Layer: {selectedLayer?.name ?? 'General Threat'}</span>
                  <span className={`heatmap-layer-caret ${layerMenuOpen ? 'is-open' : ''}`} aria-hidden="true">
                    ▾
                  </span>
                </button>

                {layerMenuOpen && (
                  <div className="heatmap-layer-list" role="menu" aria-label="Heatmap layer options">
                    {availableLayers.map((layer) => (
                      <button
                        key={layer.key}
                        type="button"
                        className={`heatmap-layer-option ${heatmapLayer === layer.key ? 'is-selected' : ''}`}
                        onClick={() => {
                          onHeatmapLayerChange(layer.key);
                          setLayerMenuOpen(false);
                        }}
                      >
                        <span className="heatmap-layer-option-icon" aria-hidden="true">
                          {heatmapLayer === layer.key ? '✓' : '•'}
                        </span>
                        <span>{layer.name}</span>
                      </button>
                    ))}
                  </div>
                )}
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
                  <div className="slider-progress" ref={progressRef} style={{ width: '0%' }}></div>
                  <div 
                    className="slider-thumb" 
                    ref={thumbRef} 
                    style={{ left: '0px' }}
                  ></div>
                </div>
                {/* 🟢 End Slider */}

                <div className="opacity-slider-labels">
                  <span>{Math.round(HEATMAP_MIN_OPACITY * 100)}%</span>
                  <span>Mid</span>
                  <span>{Math.round(HEATMAP_MAX_OPACITY * 100)}%</span>
                </div>
              </div>
            )}
          </div>

          <div className="actions-panel">
            <h3 className="actions-title">Actions</h3>

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
      </div>
    </div>
  );
}
