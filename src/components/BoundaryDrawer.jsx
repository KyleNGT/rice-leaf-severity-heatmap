import { useEffect, useImperativeHandle, useRef } from 'react';
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
 *   drawerRef       — imperative handle exposing undoLastVertex(), so the
 *                     ActionPanel's "Undo" button can pop the last placed
 *                     vertex without disrupting the in-progress draw
 *                     session (unlike `drawingAction`, which always
 *                     disables/re-enables draw mode on change).
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
  drawerRef,
}) {
  const map = useMap();
  const layerRef = useRef(null);
  const prevActionRef = useRef(null);
  // Layers currently wired up for live edit-sync, so the drawingAction
  // effect below (a separate effect, since it must not re-run Geoman setup
  // on every mode change) can add to the same set the main effect tears
  // down on cleanup. Bind/unbind fns are stashed in a ref so that second
  // effect always calls the CURRENT main-effect run's closures.
  const boundLayersRef = useRef(new Set());
  const editSyncRef = useRef({ bind: () => {} });

  // ── Configure Geoman (once) ───────────────────────────────
  useEffect(() => {
    if (!map || !isActive) return;

    // Captured once per effect run — boundLayersRef.current is always this
    // same Set instance for the component's lifetime (only its contents
    // mutate via add/delete/clear), so this is just naming it for the
    // cleanup closure below, not decoupling it from the ref.
    const boundLayers = boundLayersRef.current;

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
    // Reads the boundary back from Geoman's own layer registry rather than
    // trusting a captured e.layer/layerRef — matches the 'clear' branch
    // below, and for the same reason: it also covers polygons built by
    // MobileBoundaryDrawer (a plain L.polygon().addTo(map), never stored in
    // layerRef), since Geoman auto-attaches .pm to any vector layer added
    // to the map.
    const syncBoundaryFromMap = () => {
      const layers = map.pm.getGeomanLayers().filter((l) => !l._pmTempLayer);
      const poly = layers[layers.length - 1];
      onBoundaryCreated(poly ? poly.toGeoJSON() : null);
    };

    // pm:edit/pm:update/pm:dragend are fired by Geoman on the LAYER, never
    // on the map (unlike pm:create/pm:remove) — so they must be bound per
    // layer, not via map.on(). pm:edit fires per vertex-drag-end (live sync
    // while the user drags), pm:update fires once when edit mode is
    // switched off (the commit moment), and pm:dragend covers a whole-shape
    // drag if global drag mode is ever enabled.
    const bindEditSync = (layer) => {
      if (!layer || boundLayers.has(layer)) return;
      layer.on('pm:edit', syncBoundaryFromMap);
      layer.on('pm:update', syncBoundaryFromMap);
      layer.on('pm:dragend', syncBoundaryFromMap);
      boundLayers.add(layer);
    };

    const unbindEditSync = (layer) => {
      layer.off('pm:edit', syncBoundaryFromMap);
      layer.off('pm:update', syncBoundaryFromMap);
      layer.off('pm:dragend', syncBoundaryFromMap);
      boundLayers.delete(layer);
    };

    // Exposes this run's bind fn to the drawingAction effect below, so
    // entering edit mode can wire up a MobileBoundaryDrawer-created polygon
    // that handleCreate never saw.
    editSyncRef.current = { bind: bindEditSync };

    const handleCreate = (e) => {
      layerRef.current = e.layer;
      bindEditSync(e.layer);
      const geoJSON = e.layer.toGeoJSON();
      onBoundaryCreated(geoJSON);
      map.pm.disableDraw('Polygon');
      onDrawingStateChange?.({ isDrawing: false, vertexCount: 0 });
    };

    const handleRemove = () => {
      layerRef.current = null;
      boundLayers.forEach((layer) => unbindEditSync(layer));
      boundLayers.clear();
      onBoundaryCreated(null);
      onDrawingStateChange?.({ isDrawing: false, vertexCount: 0 });
    };

    // Track vertex placement for live feedback — pm:vertexadded/vertexremoved
    // fire on the working layer itself, not the map, so the listener must be
    // bound there. Both share this one handler: it recomputes the count from
    // getLatLngs() rather than incrementing/decrementing, so it's correct
    // either way. The in-progress working layer is a plain L.Polyline (flat
    // getLatLngs()), not yet a polygon with a nested ring, so it must be
    // counted flat.
    const handleVertexAdded = (e) => {
      const latlngs = e.layer?.getLatLngs?.() || [];
      const count = Array.isArray(latlngs[0]) ? latlngs[0].length : latlngs.length;
      onDrawingStateChange?.({ isDrawing: true, vertexCount: count });
    };

    const handleDrawStart = (e) => {
      onDrawingStateChange?.({ isDrawing: true, vertexCount: 0 });
      e.workingLayer?.on('pm:vertexadded', handleVertexAdded);
      e.workingLayer?.on('pm:vertexremoved', handleVertexAdded);
    };

    const handleDrawEnd = (e) => {
      e.workingLayer?.off('pm:vertexadded', handleVertexAdded);
      e.workingLayer?.off('pm:vertexremoved', handleVertexAdded);
      onDrawingStateChange?.({ isDrawing: false, vertexCount: 0 });
    };

    map.on('pm:create', handleCreate);
    map.on('pm:remove', handleRemove);
    map.on('pm:drawstart', handleDrawStart);
    map.on('pm:drawend', handleDrawEnd);

    return () => {
      // Disable modes FIRST — disableGlobalEditMode() fires one last
      // pm:update on the layer as it commits, which must still reach
      // syncBoundaryFromMap. Unbinding before disabling would drop that
      // final sync.
      map.pm.disableDraw();
      map.pm.disableGlobalEditMode();
      map.pm.disableGlobalRemovalMode();
      map.off('pm:create', handleCreate);
      map.off('pm:remove', handleRemove);
      map.off('pm:drawstart', handleDrawStart);
      map.off('pm:drawend', handleDrawEnd);
      boundLayers.forEach((layer) => unbindEditSync(layer));
      boundLayers.clear();
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
      // Wire up edit-sync on every current boundary layer. handleCreate
      // (above) already covers a layer Geoman itself drew, but a polygon
      // handed off by MobileBoundaryDrawer's finishShape() was never seen
      // there — this sweep is what picks it up.
      map.pm
        .getGeomanLayers()
        .filter((l) => !l._pmTempLayer)
        .forEach((layer) => editSyncRef.current.bind(layer));
    } else if (drawingAction === 'clear') {
      // Immediate clear — no "tap a shape to delete" chooser, since there's
      // only ever one boundary polygon. Removes via Geoman's own layer
      // registry rather than layerRef so it also covers polygons created by
      // MobileBoundaryDrawer (which never populates layerRef).
      map.pm.getGeomanLayers().forEach((layer) => layer.remove());
      layerRef.current = null;
      boundLayersRef.current.clear();
      onBoundaryCreated(null);
      onDrawingStateChange?.({ isDrawing: false, vertexCount: 0 });
      onDrawingActionChange?.(null);
    }
  }, [map, isActive, drawingAction, onBoundaryCreated, onDrawingActionChange, onDrawingStateChange]);

  // ── Imperative undo (Undo button) ───────────────────────────
  // Pops the last placed vertex off the in-progress polygon without
  // touching draw mode itself — routing this through `drawingAction`
  // instead would trip the effect above's unconditional
  // disableDraw()-then-re-enable, aborting the whole in-progress shape.
  // `_removeLastVertex` is Geoman's own internal method (no public
  // wrapper exists); it's exactly what Geoman's own hidden toolbar
  // action calls. If only one vertex remains, Geoman itself ends the
  // draw session (mirrors Cancel) rather than leaving an empty shape.
  const undoLastVertex = () => {
    if (!map) return;
    const drawHandler = map.pm.Draw?.Polygon;
    if (drawHandler?.enabled?.()) {
      drawHandler._removeLastVertex();
    }
  };

  useImperativeHandle(drawerRef, () => ({ undoLastVertex }));

  return null; // No DOM — the ActionPanel renders the custom buttons
}
