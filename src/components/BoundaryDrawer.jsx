import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

/**
 * ============================================================
 * BoundaryDrawer — Geoman Polygon Drawing (Custom UI)
 * ============================================================
 * Hides the default Geoman toolbar entirely. Instead, exposes
 * draw/edit/clear actions via `drawingAction` prop so the
 * ActionPanel can drive drawing with clearly-labeled, themed
 * buttons.
 *
 * Props:
 *   isActive        — Whether this component should initialise
 *   onBoundaryCreated(geojson | null)  — Boundary state setter
 *   drawingAction   — 'draw' | 'edit' | 'clear' | null
 *   onDrawingActionChange(action) — used to reset 'clear' back to null
 *   onDrawingStateChange({ isDrawing, vertexCount }) — feedback
 *
 * Heuristics applied:
 *   - User control & freedom: user can cancel, undo, redraw
 *   - Visibility of system status: vertex count reported live
 *   - Error prevention: self-intersection disallowed
 *   - Match between system & real world: natural-language labels
 */
export default function BoundaryDrawer({
  onBoundaryCreated,
  isActive,
  drawingAction,
  onDrawingActionChange,
  onDrawingStateChange,
}) {
  const map = useMap();
  const layerRef = useRef(null);
  const prevActionRef = useRef(null);

  // ── Configure Geoman (once) ───────────────────────────────
  useEffect(() => {
    if (!map || !isActive) return;

    // Global drawing options — enlarged for mobile
    map.pm.setGlobalOptions({
      tooltips: false,
      allowSelfIntersection: false,
      snapVertex: true,
      snapMiddle: false,
      finishOn: 'dblclick',
      markerStyle: {
        radius: 12,
        weight: 3,
        opacity: 1,
        fillOpacity: 0.8,
      },
      pathOptions: {
        color: '#10b981',
        fillColor: '#10b981',
        fillOpacity: 0.15,
        weight: 3,
        dashArray: '8, 6',
      },
    });

    // HIDE the default Geoman toolbar — we use custom buttons
    map.pm.removeControls();

    // ── Event handlers ────────────────────────────────────────
    const handleCreate = (e) => {
      layerRef.current = e.layer;
      const geoJSON = e.layer.toGeoJSON();
      onBoundaryCreated(geoJSON);
      map.pm.disableDraw('Polygon');
      onDrawingStateChange?.({ isDrawing: false, vertexCount: 0 });
    };

    const handleEdit = (e) => {
      const geoJSON = e.layer.toGeoJSON();
      onBoundaryCreated(geoJSON);
    };

    const handleRemove = () => {
      layerRef.current = null;
      onBoundaryCreated(null);
      onDrawingStateChange?.({ isDrawing: false, vertexCount: 0 });
    };

    // Track vertex placement for live feedback — pm:vertexadded fires on the
    // working layer itself, not the map, so the listener must be bound there.
    // The in-progress working layer is a plain L.Polyline (flat getLatLngs()),
    // not yet a polygon with a nested ring, so it must be counted flat.
    const handleVertexAdded = (e) => {
      const latlngs = e.layer?.getLatLngs?.() || [];
      const count = Array.isArray(latlngs[0]) ? latlngs[0].length : latlngs.length;
      onDrawingStateChange?.({ isDrawing: true, vertexCount: count });
    };

    const handleDrawStart = (e) => {
      onDrawingStateChange?.({ isDrawing: true, vertexCount: 0 });
      e.workingLayer?.on('pm:vertexadded', handleVertexAdded);
    };

    const handleDrawEnd = (e) => {
      e.workingLayer?.off('pm:vertexadded', handleVertexAdded);
      onDrawingStateChange?.({ isDrawing: false, vertexCount: 0 });
    };

    map.on('pm:create', handleCreate);
    map.on('pm:edit', handleEdit);
    map.on('pm:remove', handleRemove);
    map.on('pm:drawstart', handleDrawStart);
    map.on('pm:drawend', handleDrawEnd);

    return () => {
      map.off('pm:create', handleCreate);
      map.off('pm:edit', handleEdit);
      map.off('pm:remove', handleRemove);
      map.off('pm:drawstart', handleDrawStart);
      map.off('pm:drawend', handleDrawEnd);
      map.pm.disableDraw();
      map.pm.disableGlobalEditMode();
      map.pm.disableGlobalRemovalMode();
      map.pm.removeControls();
    };
  }, [map, isActive, onBoundaryCreated, onDrawingStateChange]);

  // ── React to drawingAction changes ─────────────────────────
  useEffect(() => {
    if (!map || !isActive) return;
    if (drawingAction === prevActionRef.current) return;
    prevActionRef.current = drawingAction;

    // Disable all modes first
    map.pm.disableDraw();
    map.pm.disableGlobalEditMode();
    map.pm.disableGlobalRemovalMode();

    if (drawingAction === 'draw') {
      map.pm.enableDraw('Polygon');
    } else if (drawingAction === 'edit') {
      map.pm.enableGlobalEditMode();
    } else if (drawingAction === 'clear') {
      // Immediate clear — no "tap a shape to delete" chooser, since there's
      // only ever one boundary polygon. Removes via Geoman's own layer
      // registry rather than layerRef so it also covers polygons created by
      // MobileBoundaryDrawer (which never populates layerRef).
      map.pm.getGeomanLayers().forEach((layer) => layer.remove());
      layerRef.current = null;
      onBoundaryCreated(null);
      onDrawingStateChange?.({ isDrawing: false, vertexCount: 0 });
      onDrawingActionChange?.(null);
    }
  }, [map, isActive, drawingAction, onBoundaryCreated, onDrawingActionChange, onDrawingStateChange]);

  return null; // No DOM — the ActionPanel renders the custom buttons
}
