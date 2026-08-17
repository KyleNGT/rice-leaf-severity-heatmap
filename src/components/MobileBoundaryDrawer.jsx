import { useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useMap, CircleMarker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import { BOUNDARY_STYLE, BOUNDARY_DRAW_STYLE, BOUNDARY_VERTEX_STYLE } from '../constants/constants';

/**
 * ============================================================
 * MobileBoundaryDrawer — Center-Anchored Boundary Drawing
 * ============================================================
 * Alternative to BoundaryDrawer's tap-to-place flow for small/
 * touch viewports, where tapping precise map locations is hard.
 * A fixed crosshair (rendered by App) marks the map's center;
 * the user pans/zooms the map under the crosshair, then commits
 * the centered point via the "Place Point" button (driven
 * imperatively through `drawerRef`, since the buttons live in
 * ActionPanel, outside the map).
 *
 * Placed vertices are geographic — panning/zooming afterwards
 * only moves the *candidate* point (the crosshair), never
 * already-committed vertices.
 *
 * On finish, builds a real Leaflet polygon layer (rather than
 * just handing off GeoJSON) so leaflet-geoman's global edit/
 * remove modes — driven by BoundaryDrawer — recognize and can
 * operate on it exactly like a polygon Geoman drew itself.
 */
export default function MobileBoundaryDrawer({
  isActive,
  drawerRef,
  onBoundaryCreated,
  onDrawingStateChange,
}) {
  const map = useMap();
  const [vertices, setVertices] = useState([]); // [{ lat, lng }]

  // Reset in-progress vertices whenever this mode becomes inactive
  useEffect(() => {
    if (!isActive) setVertices([]);
  }, [isActive]);

  useEffect(() => {
    onDrawingStateChange?.({ isDrawing: vertices.length > 0, vertexCount: vertices.length });
  }, [vertices, onDrawingStateChange]);

  const placePoint = useCallback(() => {
    if (!map) return;
    const center = map.getCenter();
    setVertices((prev) => [...prev, { lat: center.lat, lng: center.lng }]);
  }, [map]);

  const undoLast = useCallback(() => {
    setVertices((prev) => prev.slice(0, -1));
  }, []);

  const clear = useCallback(() => {
    setVertices([]);
  }, []);

  const finishShape = useCallback(() => {
    if (!map || vertices.length < 3) return;
    const latlngs = vertices.map((v) => [v.lat, v.lng]);
    const layer = L.polygon(latlngs, BOUNDARY_STYLE).addTo(map);
    onBoundaryCreated(layer.toGeoJSON());
    setVertices([]);
  }, [map, vertices, onBoundaryCreated]);

  useImperativeHandle(
    drawerRef,
    () => ({ placePoint, undoLast, finishShape, clear }),
    [placePoint, undoLast, finishShape, clear]
  );

  if (!isActive || vertices.length === 0) return null;

  return (
    <>
      {vertices.length >= 2 && (
        <Polyline positions={vertices.map((v) => [v.lat, v.lng])} pathOptions={BOUNDARY_DRAW_STYLE} />
      )}
      {vertices.map((v, i) => (
        <CircleMarker key={i} center={[v.lat, v.lng]} radius={8} pathOptions={BOUNDARY_VERTEX_STYLE} />
      ))}
    </>
  );
}
