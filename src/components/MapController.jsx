import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { STEPS, DEFAULT_ZOOM } from '../constants/constants';

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
        map.setMaxBounds(bounds.pad(0.15));
      }
    } else {
      map.setMaxBounds(null);
    }
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
