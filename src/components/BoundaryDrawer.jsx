import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

/**
 * ============================================================
 * BoundaryDrawer — Geoman Polygon Drawing (Custom UI)
 * ============================================================
 * Hides the default Geoman toolbar entirely. Instead, exposes
 * draw/edit/delete actions via `drawingAction` prop so the
 * ActionPanel can drive drawing with clearly-labeled, themed
 * buttons.
 *
 * Props:
 *   isActive        — Whether this component should initialise
 *   onBoundaryCreated(geojson | null)  — Boundary state setter
 *   drawingAction   — 'draw' | 'edit' | 'delete' | null
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

    // Track vertex placement for live feedback
    const handleVertexAdded = (e) => {
      const count = e.workingLayer?.getLatLngs()?.[0]?.length || 0;
      onDrawingStateChange?.({ isDrawing: true, vertexCount: count });
    };

    const handleDrawStart = () => {
      onDrawingStateChange?.({ isDrawing: true, vertexCount: 0 });
    };

    const handleDrawEnd = () => {
      onDrawingStateChange?.({ isDrawing: false, vertexCount: 0 });
    };

    map.on('pm:create', handleCreate);
    map.on('pm:edit', handleEdit);
    map.on('pm:remove', handleRemove);
    map.on('pm:drawstart', handleDrawStart);
    map.on('pm:drawend', handleDrawEnd);
    map.on('pm:vertexadded', handleVertexAdded);

    return () => {
      map.off('pm:create', handleCreate);
      map.off('pm:edit', handleEdit);
      map.off('pm:remove', handleRemove);
      map.off('pm:drawstart', handleDrawStart);
      map.off('pm:drawend', handleDrawEnd);
      map.off('pm:vertexadded', handleVertexAdded);
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
    } else if (drawingAction === 'delete') {
      map.pm.enableGlobalRemovalMode();
    }
  }, [map, isActive, drawingAction]);

  return null; // No DOM — the ActionPanel renders the custom buttons
}
