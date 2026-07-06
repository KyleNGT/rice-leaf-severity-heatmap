import { useState, useEffect } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  ESRI_TILE_URL,
  ESRI_ATTRIBUTION,
} from '../constants/constants';
import BoundaryDrawer from './BoundaryDrawer';
import SampleMarker from './SampleMarker';
import HeatmapOverlay from './HeatmapOverlay';
import ManualPinModal from './ManualPinModal';

/**
 * ============================================================
 * MapView — Primary Map Canvas
 * ============================================================
 * Wraps react-leaflet MapContainer with:
 *   - Esri World Imagery satellite tiles
 *   - GPS-based initial centering
 *   - Boundary drawing integration
 *   - Sample marker rendering
 *   - Heatmap overlay
 *   - Manual pin placement mode
 */
export default function MapView({
  currentStep,
  boundary,
  onBoundaryCreated,
  samples,
  heatmapData,
  heatmapOpacity,
  manualPinMode,
  onManualPinConfirm,
  onManualPinCancel,
  drawingAction,
  onDrawingStateChange,
}) {
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [isLocating, setIsLocating] = useState(true);

  // Attempt GPS centering on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setIsLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter([pos.coords.latitude, pos.coords.longitude]);
        setIsLocating(false);
      },
      () => {
        // Permission denied or error — use default
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  if (isLocating) {
    return (
      <div className="map-locating">
        <div className="loading-spinner" />
        <p>Getting your location...</p>
      </div>
    );
  }

  return (
    <MapContainer
      center={center}
      zoom={DEFAULT_ZOOM}
      className="map-container"
      zoomControl={false}
      attributionControl={true}
      tap={true}
      touchZoom={true}
      dragging={true}
    >
      <TileLayer url={ESRI_TILE_URL} attribution={ESRI_ATTRIBUTION} maxZoom={22} />

      {/* Boundary drawing tool — active only during boundary step */}
      <BoundaryDrawer
        isActive={currentStep === 'boundary'}
        onBoundaryCreated={onBoundaryCreated}
        drawingAction={drawingAction}
        onDrawingStateChange={onDrawingStateChange}
      />

      {/* Sample markers */}
      {samples.map((sample, idx) => (
        <SampleMarker key={sample.id} sample={sample} index={idx} />
      ))}

      {/* Heatmap overlay */}
      {heatmapData && (
        <HeatmapOverlay
          grid={heatmapData.grid}
          cols={heatmapData.cols}
          rows={heatmapData.rows}
          bbox={heatmapData.bbox}
          boundary={boundary}
          opacity={heatmapOpacity}
        />
      )}

      {/* Manual pin placement mode */}
      {manualPinMode && (
        <ManualPinModal
          boundary={boundary}
          onConfirm={onManualPinConfirm}
          onCancel={onManualPinCancel}
        />
      )}
    </MapContainer>
  );
}
