import { useState, useEffect } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  ESRI_TILE_URL,
  ESRI_ATTRIBUTION,
  ESRI_MAX_ZOOM,
  ESRI_MAX_NATIVE_ZOOM,
} from '../constants/constants';
import BoundaryDrawer from './BoundaryDrawer';
import MobileBoundaryDrawer from './MobileBoundaryDrawer';
import MapController from './MapController';
import SampleMarker from './SampleMarker';
import HeatmapOverlay from './HeatmapOverlay';
import ManualPinModal from './ManualPinModal';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';

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
  onDrawingActionChange,
  onDrawingStateChange,
  mobileDrawerRef,
}) {
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [isLocating, setIsLocating] = useState(true);
  const isMobile = useIsMobileViewport();

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
      <TileLayer
        url={ESRI_TILE_URL}
        attribution={ESRI_ATTRIBUTION}
        maxZoom={ESRI_MAX_ZOOM}
        maxNativeZoom={ESRI_MAX_NATIVE_ZOOM}
      />

      {/* Keeps the persistent map correctly sized/framed across steps */}
      <MapController currentStep={currentStep} boundary={boundary} isMobile={isMobile} />

      {/* Boundary drawing tool — active only during boundary step */}
      <BoundaryDrawer
        isActive={currentStep === 'boundary'}
        onBoundaryCreated={onBoundaryCreated}
        drawingAction={drawingAction}
        onDrawingActionChange={onDrawingActionChange}
        onDrawingStateChange={onDrawingStateChange}
      />

      {/* Center-anchored drawing for mobile — only during initial placement */}
      {currentStep === 'boundary' && isMobile && !boundary && (
        <MobileBoundaryDrawer
          isActive={currentStep === 'boundary'}
          drawerRef={mobileDrawerRef}
          onBoundaryCreated={onBoundaryCreated}
          onDrawingStateChange={onDrawingStateChange}
        />
      )}

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
