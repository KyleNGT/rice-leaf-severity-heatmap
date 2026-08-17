// Side-effect import that patches Leaflet core (L.Map, L.Marker, L.GridLayer,
// etc.) with rotation support. Must be imported — for its side effects only,
// before any `L.map()`/`<MapContainer>` is constructed — from a component
// that will actually render the map (currently MapView.jsx). The `./leafletGlobal.js`
// import is required first: leaflet-rotate's ESM sources reference a bare
// global `L` and never import leaflet themselves, so window.L must already be
// set before this module evaluates (see that file's own comment).
import './leafletGlobal.js';
import 'leaflet-rotate';

import { MAP_BEARING_SNAP_DEG } from '../constants/constants';

/**
 * Wraps `map.setBearing` so a requested bearing within MAP_BEARING_SNAP_DEG
 * of 0 snaps to exactly 0. Without this, leaflet-rotate's TouchGestures
 * handler drifts the bearing a few degrees on every plain pinch-zoom (see
 * MAP_BEARING_SNAP_DEG's doc comment in constants.js) — a real nuisance for
 * a farmer who only meant to zoom. Idempotent to call more than once on the
 * same map instance (checks a flag before wrapping).
 */
export function installBearingSnap(map) {
  if (!map || map._bearingSnapInstalled) return;
  map._bearingSnapInstalled = true;

  const originalSetBearing = map.setBearing.bind(map);
  map.setBearing = (theta) => {
    const wrapped = ((theta % 360) + 360) % 360;
    const distanceFromNorth = Math.min(wrapped, 360 - wrapped);
    originalSetBearing(distanceFromNorth <= MAP_BEARING_SNAP_DEG ? 0 : theta);
  };
}
