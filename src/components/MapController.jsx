import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  STEPS,
  DEFAULT_ZOOM,
  SAMPLING_PAN_BOUNDS_PADDING,
  BOUNDARY_STYLE,
  BOUNDARY_CASING_STYLE,
  BOUNDARY_HEATMAP_FILL_OPACITY,
} from '../constants/constants';

/**
 * ============================================================
 * MapController — Persistent-Map Layout & Framing
 * ============================================================
 * MapView mounts a single <MapContainer> that stays alive across
 * all 3 workflow steps (never remounted). This component reacts
 * to layout/step changes on that same map instance:
 *
 *   - Whenever the split layout changes shape (entering/leaving
 *     the Step 2 split, a mobile/desktop breakpoint flip, or
 *     toggling the fullscreen map takeover — which also drops the
 *     split back to full-screen), Leaflet's cached container size
 *     goes stale, so the map must be told to re-measure via
 *     invalidateSize().
 *   - Entering the Sampling step with a boundary drawn, the map
 *     is framed to the field and panning is locked to it so the
 *     user can't scroll away from their own field. Leaving
 *     Sampling releases the lock.
 *   - A plant picked in the Sample History sidebar (Heatmap step)
 *     flies the camera to it — see the focusTarget effect below.
 */
export default function MapController({
  currentStep,
  boundary,
  isMobile,
  mapFullscreen,
  focusTarget,
  focusOffsetX = 0,
}) {
  const map = useMap();
  // The focusTarget effect's deps include focusOffsetX, which flips whenever
  // the viewport crosses the mobile/desktop breakpoint (see MapView). Without
  // this guard, resizing the window while a plant is focused would re-fly to
  // the SAME plant just because the offset changed. Only an actual new
  // selection — a bumped `seq` — should move the camera.
  const lastFocusSeq = useRef(0);
  // The decorative white casing polygon painted beneath the real boundary —
  // see the effect below and BOUNDARY_CASING_STYLE's doc comment for why
  // this can't just be a CSS filter on the boundary polygon itself.
  const casingLayerRef = useRef(null);

  // Re-measure the map whenever its container is resized by a layout change
  useEffect(() => {
    if (!map) return;

    const raf = requestAnimationFrame(() => map.invalidateSize());
    // The split layout's CSS/animation needs a moment to settle before a
    // second, later measurement catches the final box size
    const timeout = setTimeout(() => map.invalidateSize(), 260);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [map, currentStep, isMobile, mapFullscreen]);

  // Fit + lock the map to the field boundary while sampling
  useEffect(() => {
    if (!map) return;

    if (currentStep === STEPS.SAMPLING && boundary) {
      const bounds = L.geoJSON(boundary).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24] });
        map.setMaxBounds(bounds.pad(SAMPLING_PAN_BOUNDS_PADDING));
      }
    } else {
      map.setMaxBounds(null);
    }
  }, [map, currentStep, boundary]);

  // Paints/moves the white casing polygon directly beneath the real boundary
  // — genuine vector layering rather than a CSS filter, since a filter on the
  // boundary's own translucent fill washes it out to near-white (see
  // BOUNDARY_CASING_STYLE's comment in constants.js). Rebuilt from `boundary`
  // GeoJSON rather than read off the Geoman layer, so it stays correct
  // whether the shape came from BoundaryDrawer's Geoman flow or
  // MobileBoundaryDrawer's plain L.polygon. pmIgnore (set on the style
  // object) keeps this out of Geoman's own layer registry, so it can never be
  // mistaken for the real, user-editable boundary by the effect below or by
  // BoundaryDrawer's syncBoundaryFromMap.
  useEffect(() => {
    if (!map) return;

    if (!boundary) {
      if (casingLayerRef.current) {
        map.removeLayer(casingLayerRef.current);
        casingLayerRef.current = null;
      }
      return;
    }

    const [sourceLayer] = L.geoJSON(boundary).getLayers();
    const latlngs = sourceLayer?.getLatLngs();
    if (!latlngs) return;

    if (casingLayerRef.current) {
      casingLayerRef.current.setLatLngs(latlngs);
    } else {
      casingLayerRef.current = L.polygon(latlngs, BOUNDARY_CASING_STYLE).addTo(map);
    }
    casingLayerRef.current.bringToBack();
  }, [map, boundary]);

  // Drop the casing layer if this controller instance is ever torn down
  // (the map itself is persistent — see the file docblock — but this guards
  // against a future remount).
  useEffect(() => {
    return () => {
      if (casingLayerRef.current) {
        map?.removeLayer(casingLayerRef.current);
        casingLayerRef.current = null;
      }
    };
  }, [map]);

  // The boundary is ONE persistent layer created in Step 1 and never
  // remounted, so the Heatmap step's SES raster would otherwise sit under
  // the dark fill. Looked up via Geoman's layer registry (same approach as
  // BoundaryDrawer's syncBoundaryFromMap) rather than a captured ref, since
  // it also finds a polygon built by MobileBoundaryDrawer.
  useEffect(() => {
    if (!map || !boundary || !map.pm) return;
    const layers = map.pm.getGeomanLayers().filter((l) => !l._pmTempLayer);
    const poly = layers[layers.length - 1];
    poly?.setStyle?.({
      fillOpacity:
        currentStep === STEPS.HEATMAP ? BOUNDARY_HEATMAP_FILL_OPACITY : BOUNDARY_STYLE.fillOpacity,
    });
  }, [map, currentStep, boundary]);

  // Fly to a plant picked in the Sample History sidebar. Keyed on `seq`
  // rather than lat/lng so re-picking the SAME plant after panning away
  // still re-frames it — a bare coordinate pair wouldn't change identity on
  // a repeat pick, so this effect wouldn't re-run.
  //
  // The target is biased east by half `focusOffsetX` (the sidebar's own
  // width — see HISTORY_SIDEBAR_OFFSET_PX in constants.js) so the plant
  // lands centered in the strip of map actually visible beside the open
  // sidebar, not underneath it. A plain flyTo to the true coordinate would
  // put the node behind the sidebar on anything narrower than roughly
  // 3× the sidebar's width. `map.project`/`unproject` at the target zoom
  // does this shift in screen-pixel space, which is exact at any zoom —
  // unlike `flyToBounds` with padding, whose viewport-minus-padding math
  // goes negative (and returns a garbage zoom) on a narrow window.
  useEffect(() => {
    if (!map || !focusTarget) return;
    if (focusTarget.seq === lastFocusSeq.current) return;
    lastFocusSeq.current = focusTarget.seq;

    const zoom = Math.min(Math.max(map.getZoom(), DEFAULT_ZOOM), map.getMaxZoom());
    const shift = Math.min(focusOffsetX / 2, map.getSize().x * 0.35);
    const targetPoint = map.project([focusTarget.lat, focusTarget.lng], zoom);
    const center = map.unproject(targetPoint.subtract([shift, 0]), zoom);

    map.flyTo(center, zoom, { duration: 0.8 });
  }, [map, focusTarget, focusOffsetX]);

  return null;
}
