import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * ============================================================
 * MapLocateControl — Recenter-on-Me Button
 * ============================================================
 * Modeled directly on MapBearingControl.jsx: a themed button rendered
 * as a child of <MapContainer> (needed for useMap()), matching the
 * "Geoman's default toolbar is hidden, ActionPanel-style buttons only"
 * convention.
 *
 * The live-location marker deliberately never auto-pans the map (see
 * CLAUDE.md's Live Location section) — this button is the one way back
 * once the dot has walked off-screen, and it doubles as the user-gesture
 * iOS requires before DeviceOrientationEvent.requestPermission() may be
 * called (that call throws from inside a useEffect).
 *
 * If the farmer is standing outside the Sampling step's padded max
 * bounds (MapController's setMaxBounds lock), Leaflet's own
 * `_limitCenter` clamps the requested setView to the nearest allowed
 * center rather than refusing it outright — so this never "does
 * nothing", it just pans as close to the real position as the lock
 * permits.
 */
export default function MapLocateControl({ isMobile, position, needsPermission, onRequestPermission }) {
  const map = useMap();
  const wrapperRef = useRef(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  if (!isMobile || !position) return null;

  const handleClick = () => {
    if (needsPermission) onRequestPermission();
    map.setView([position.lat, position.lng], map.getZoom());
  };

  return (
    <div className="map-locate-btn-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="map-locate-btn"
        onClick={handleClick}
        aria-label="Center map on my location"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <path
            d="M12 2v3M12 19v3M2 12h3M19 12h3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span>My Location</span>
      </button>
    </div>
  );
}
