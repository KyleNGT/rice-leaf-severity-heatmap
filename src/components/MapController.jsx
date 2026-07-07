import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { STEPS } from '../constants/constants';

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
 *     toggling manual-pin mode — which also drops the split back
 *     to full-screen), Leaflet's cached container size goes stale,
 *     so the map must be told to re-measure via invalidateSize().
 *   - Entering the Sampling step with a boundary drawn, the map
 *     is framed to the field and panning is locked to it so the
 *     user can't scroll away from their own field. Leaving
 *     Sampling releases the lock.
 */
export default function MapController({ currentStep, boundary, isMobile, manualPinMode }) {
  const map = useMap();

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
  }, [map, currentStep, isMobile, manualPinMode]);

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

  return null;
}
