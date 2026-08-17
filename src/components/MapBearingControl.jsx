import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * ============================================================
 * MapBearingControl — Reset-to-North Button
 * ============================================================
 * Rendered as a child of <MapContainer> (not App.jsx's map-box overlay
 * row) specifically so it can call useMap() — see the CLAUDE.md note
 * that only children of MapContainer may do that. Mirrors the
 * leaflet-rotate plugin's own L.Control.Rotate in behavior (hidden at
 * bearing 0, tap resets to north) but as a themed custom button, since
 * the design system hides Geoman's/any plugin's default toolbar in
 * favor of ActionPanel-style buttons — the plugin's own control is
 * explicitly disabled in MapView (rotateControl={false}).
 *
 * Bearing can be nonzero on any step except while "Edit Shape" is active
 * within Boundary (MapController forces it back to 0 there), so no separate
 * step/edit-mode check is needed here — this button simply tracks the map's
 * own 'rotate' event and hides itself whenever bearing rounds to 0.
 *
 * Desktop-only exception: rotation itself is gated to the touch gesture
 * (see MapController — shiftKeyRotate/rotateControl are both disabled in
 * MapView, so a mouse-only desktop has no way to rotate), but MapController's
 * touchRotate gate keys off currentStep, not device — a touchscreen laptop
 * could still rotate the map via the same two-finger gesture as mobile. This
 * button is desktop-view UI chrome regardless of that edge case, so it's
 * hidden outright on desktop via the isMobile prop rather than trying to
 * detect touch support.
 */
export default function MapBearingControl({ isMobile }) {
  const map = useMap();
  const [bearing, setBearing] = useState(0);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!map) return;

    const onRotate = () => setBearing(map.getBearing());
    onRotate();
    map.on('rotate', onRotate);
    return () => map.off('rotate', onRotate);
  }, [map]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  if (!isMobile) return null;

  // Sub-degree rotation is imperceptible and would otherwise flicker the
  // button in and out around the bearing-snap threshold's own edge.
  if (Math.abs(bearing) < 0.5) return null;

  return (
    <div className="map-compass-btn-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="map-compass-btn"
        onClick={() => map.setBearing(0)}
        aria-label="Reset map orientation to north"
      >
        <svg
          className="map-compass-btn__needle"
          style={{ transform: `rotate(${-bearing}deg)` }}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path d="M12 2 L16 13 L12 10.5 L8 13 Z" fill="#c1121f" />
          <path d="M12 22 L8 13 L12 15.5 L16 13 Z" fill="#9ca3af" />
        </svg>
        <span>North</span>
      </button>
    </div>
  );
}
