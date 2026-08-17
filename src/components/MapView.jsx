import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  ESRI_TILE_URL,
  ESRI_ATTRIBUTION,
  ESRI_MAX_ZOOM,
  ESRI_MAX_NATIVE_ZOOM,
  HISTORY_SIDEBAR_OFFSET_PX,
  STEPS,
  ENABLE_TAP_TO_SET_LOCATION,
} from '../constants/constants';
import BoundaryDrawer from './BoundaryDrawer';
import MobileBoundaryDrawer from './MobileBoundaryDrawer';
import MapController from './MapController';
import SampleMarker from './SampleMarker';
import HeatmapOverlay from './HeatmapOverlay';
import DraftMarker from './DraftMarker';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';

/**
 * TEMPORARY — dev/testing only. Lets a tap anywhere on the map set the
 * in-progress draft plant's lat/lng directly during Sampling, skipping
 * GPS/EXIF/manual typing. Gated by ENABLE_TAP_TO_SET_LOCATION; delete this
 * component (and its call site below) together with that constant and
 * App.jsx's handleMapTapLocation once done testing.
 */
function TapToSetLocation({ onTap }) {
  useMapEvents({
    click(e) {
      onTap(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

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
  heatmapGrid,
  heatmapCols,
  heatmapRows,
  heatmapBbox,
  heatmapLayer,
  heatmapOpacity,
  draftSample,
  draftSummary,
  mapFullscreen,
  drawingAction,
  onDrawingActionChange,
  onDrawingStateChange,
  mobileDrawerRef,
  desktopDrawerRef,
  selection,
  onSampleSelect,
  onMapTapLocation,
}) {
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [isLocating, setIsLocating] = useState(true);
  const isMobile = useIsMobileViewport();
  const isHeatmap = currentStep === STEPS.HEATMAP;
  // Node click-to-select only makes sense once the Sample History sidebar
  // exists to receive it (Heatmap step). Earlier steps keep today's
  // click-to-open popup on every node — see SampleMarker's docblock.
  const selectedSample =
    isHeatmap && selection ? samples.find((s) => s.id === selection.id) : null;

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
      <MapController
        currentStep={currentStep}
        boundary={boundary}
        isMobile={isMobile}
        mapFullscreen={mapFullscreen}
        // Only a sidebar-originated selection should move the camera — a
        // node clicked directly on the map is already exactly where the
        // user is looking, so flying to it would just be a jarring no-op
        // pan. See selection.origin below.
        focusTarget={isHeatmap && selection?.origin === 'sidebar' ? selection : null}
        focusOffsetX={isMobile ? 0 : HISTORY_SIDEBAR_OFFSET_PX}
      />

      {/* Boundary drawing tool — active only during boundary step */}
      <BoundaryDrawer
        isActive={currentStep === STEPS.BOUNDARY}
        onBoundaryCreated={onBoundaryCreated}
        drawingAction={drawingAction}
        onDrawingActionChange={onDrawingActionChange}
        onDrawingStateChange={onDrawingStateChange}
        drawerRef={desktopDrawerRef}
      />

      {/* Center-anchored drawing for mobile — only during initial placement */}
      {currentStep === STEPS.BOUNDARY && isMobile && !boundary && (
        <MobileBoundaryDrawer
          isActive={currentStep === STEPS.BOUNDARY}
          drawerRef={mobileDrawerRef}
          onBoundaryCreated={onBoundaryCreated}
          onDrawingStateChange={onDrawingStateChange}
        />
      )}

      {/* Sample markers. Click-to-select only wired up once the Sample
          History sidebar exists to receive it (Heatmap step) — earlier
          steps pass onSelect={null}, which keeps SampleMarker on its
          original click-to-open-popup behavior. */}
      {samples.map((sample, idx) => (
        <SampleMarker
          key={sample.id}
          sample={sample}
          index={idx}
          onSelect={isHeatmap ? onSampleSelect : null}
          isSelected={isHeatmap && selection?.id === sample.id}
          activeLayer={isHeatmap ? heatmapLayer : null}
        />
      ))}

      {/* Selection pulse — a separate, non-interactive ring rather than a
          toggled class on the sample's own marker: react-leaflet updates an
          existing CircleMarker's style via Leaflet's setStyle(), which never
          re-applies pathOptions.className to an already-mounted path (only
          the SVG renderer's one-time _initPath does). Keying this on
          `selection.seq` forces a fresh mount on every pick — including
          re-picking the SAME node — so the CSS animation class is applied
          new each time and the pulse actually replays. */}
      {isHeatmap && selectedSample && selection && (
        <CircleMarker
          key={`pulse-${selection.id}-${selection.seq}`}
          center={[selectedSample.lat, selectedSample.lng]}
          radius={16}
          interactive={false}
          pathOptions={{ className: 'sample-pulse-ring', color: '#ffffff', weight: 3, fill: false }}
        />
      )}

      {/* Heatmap overlay — grid is the ACTIVE layer's continuous-SES grid
          (see sesLayers in App.jsx), not raw PDLA; HeatmapOverlay paints it
          on the SES ramp regardless of which disease (or General) it is. */}
      {heatmapGrid && (
        <HeatmapOverlay
          grid={heatmapGrid}
          cols={heatmapCols}
          rows={heatmapRows}
          bbox={heatmapBbox}
          boundary={boundary}
          opacity={heatmapOpacity}
        />
      )}

      {/* TEMPORARY — dev/testing only, see TapToSetLocation above */}
      {ENABLE_TAP_TO_SET_LOCATION && currentStep === STEPS.SAMPLING && (
        <TapToSetLocation onTap={onMapTapLocation} />
      )}

      {/* Live preview pin for the in-progress draft sample */}
      <DraftMarker draft={draftSample} summary={draftSummary} />
    </MapContainer>
  );
}
