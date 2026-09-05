import { useEffect, useMemo, useRef } from 'react';
import { Marker, useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * ============================================================
 * LiveLocationMarker — "You Are Here" Dot + Heading Cone
 * ============================================================
 * Purely navigational — never feeds into a plant's recorded
 * coordinates (see CLAUDE.md's Sample Acquisition Methods /
 * location-provenance rules, which this deliberately sits outside of).
 *
 * Renders via react-leaflet's default markerPane, same as SampleMarker
 * and DraftMarker — per CLAUDE.md's Map Rotation section, leaflet-rotate
 * keeps markerPane inside norotatePane, so this marker's own position
 * and the cone's *base* orientation never rotate with the tiles. The
 * cone's rotation is therefore drawn at (heading - map.getBearing()),
 * NOT raw heading — skipping the bearing correction would leave the
 * cone pointing at true-north-relative heading while the satellite
 * imagery underneath has been twisted, silently pointing the farmer
 * the wrong way on a rotated map. See MapBearingControl.jsx for the
 * same 'rotate' event pattern this reads bearing from.
 *
 * The icon DOM node is built ONCE (useMemo, no deps) and never rebuilt
 * for position/heading updates — only the cone's inline transform/
 * opacity are mutated directly via the Leaflet marker's own DOM element
 * (icon.getElement()). Rebuilding the divIcon on every GPS/compass tick
 * would remount the node and defeat both the CSS glide transition and
 * any smoothing, the same reasoning DraftMarker's icon memo documents
 * for its drop animation.
 */

function buildIcon() {
  return new L.DivIcon({
    className: 'live-location-icon',
    html: `<div class="live-location-marker">
      <svg class="live-location-cone" width="60" height="60" viewBox="0 0 60 60" style="opacity:0">
        <path d="M30 30 L18 8 A24 24 0 0 1 42 8 Z"/>
      </svg>
      <div class="live-location-dot"></div>
    </div>`,
    iconSize: [60, 60],
    iconAnchor: [30, 30],
  });
}

export default function LiveLocationMarker({ position, heading }) {
  const map = useMap();
  const markerRef = useRef(null);
  const bearingRef = useRef(map.getBearing ? map.getBearing() : 0);
  const headingRef = useRef(heading);
  const unwrappedRef = useRef(null);

  const icon = useMemo(() => buildIcon(), []);

  // Applies the current heading/bearing to the already-mounted cone
  // element without touching React or the divIcon. Reads both angles from
  // refs (not closed-over props/state) because the 'rotate' listener below
  // is attached once (effect deps [map]) — a plain closure over `heading`
  // would go stale the moment the compass produced a new reading after
  // that listener was installed.
  const applyRotation = () => {
    const el = markerRef.current?.getElement?.();
    const cone = el?.querySelector('.live-location-cone');
    if (!cone) return;

    const currentHeading = headingRef.current;
    if (currentHeading === null || currentHeading === undefined) {
      cone.style.opacity = '0';
      return;
    }

    const screenAngle = ((currentHeading - bearingRef.current) % 360 + 360) % 360;

    // Unwrap so the CSS transition always takes the short way around —
    // otherwise a raw 359deg -> 1deg jump animates a 358deg backspin.
    if (unwrappedRef.current === null) {
      unwrappedRef.current = screenAngle;
    } else {
      let delta = screenAngle - (unwrappedRef.current % 360);
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      unwrappedRef.current += delta;
    }

    cone.style.opacity = '1';
    cone.style.transform = `rotate(${unwrappedRef.current}deg)`;
  };

  useEffect(() => {
    const onRotate = () => {
      bearingRef.current = map.getBearing();
      applyRotation();
    };
    map.on('rotate', onRotate);
    return () => map.off('rotate', onRotate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    headingRef.current = heading;
    applyRotation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heading]);

  // Suspend the glide transition during zoom animation — Leaflet drives
  // its own zoom animation through the same transform: translate3d(...)
  // this marker's CSS transitions for the walking glide, so leaving the
  // transition on makes the dot visibly lag behind a pinch-zoom.
  useEffect(() => {
    const el = () => markerRef.current?.getElement?.();
    const onZoomStart = () => el()?.classList.add('live-location-icon--no-transition');
    const onZoomEnd = () => el()?.classList.remove('live-location-icon--no-transition');
    map.on('zoomstart', onZoomStart);
    map.on('zoomend', onZoomEnd);
    return () => {
      map.off('zoomstart', onZoomStart);
      map.off('zoomend', onZoomEnd);
    };
  }, [map]);

  if (!position) return null;

  return (
    <Marker
      ref={markerRef}
      position={[position.lat, position.lng]}
      icon={icon}
      interactive={false}
      keyboard={false}
    />
  );
}
