import { STEPS } from '../constants/constants';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';
import HeatmapTray from './HeatmapTray';

/**
 * ============================================================
 * ActionPanel — Contextual Bottom Panel
 * ============================================================
 * Changes content per workflow step. During the boundary step,
 * replaces the default Geoman toolbar with clearly-labeled,
 * themed tool buttons.
 *
 * Heuristics applied:
 *   - Recognition rather than recall: labelled tool buttons
 *   - Visibility of system status: vertex count, drawing state
 *   - Aesthetic & minimalist design: only relevant actions shown
 *   - User control & freedom: cancel / redo / clear actions
 *   - Match system & real world: natural-language instructions
 */
export default function ActionPanel({
  currentStep,
  boundary,
  onAdvanceStep,
  onReset,
  onResumeSampling,
  heatmapOpacity,
  onOpacityChange,
  heatmapData,
  availableLayers,
  heatmapLayer,
  onHeatmapLayerChange,
  // Boundary drawing props
  drawingAction,
  onDrawingActionChange,
  drawingState,
  onPlacePoint,
  onUndoPoint,
  onFinishShape,
  onUndoVertex,
  onExportReport,
  isProcessing,
}) {
  const isMobile = useIsMobileViewport();

  // ── Step 1: Boundary — mobile center-anchored flow ─────────
  if (currentStep === STEPS.BOUNDARY && isMobile) {
    const vertexCount = drawingState?.vertexCount || 0;

    return (
      <div className="action-panel">
        <div className="action-card">
          <h3 className="action-title">Define Field Boundary</h3>

          <p className="action-desc">
            {!boundary && vertexCount === 0 &&
              'Pan and zoom so the crosshair marks your first corner, then tap "Place Point".'}
            {!boundary && vertexCount > 0 && vertexCount < 3 &&
              `${vertexCount}/3 minimum points placed. Move the crosshair to the next corner and tap "Place Point".`}
            {!boundary && vertexCount >= 3 &&
              `${vertexCount} points placed. Add more corners or tap "Close Boundary" to finalize the shape.`}
            {boundary && 'Boundary set! You can edit, redraw, or continue to sampling.'}
          </p>

          {!boundary && (
            <div className="boundary-tools">
              <button className="btn btn-tool btn-tool-primary" onClick={onPlacePoint}>
                <span className="btn-tool-label">Place Point</span>
              </button>
              <button className="btn btn-tool" onClick={onUndoPoint} disabled={vertexCount === 0}>
                <span className="btn-tool-label">Undo</span>
              </button>
            </div>
          )}

          {boundary && (
            <div className="boundary-tools">
              <button
                className={`btn btn-tool ${drawingAction === 'edit' ? 'btn-tool-active' : ''}`}
                onClick={() =>
                  onDrawingActionChange(drawingAction === 'edit' ? null : 'edit')
                }
              >
                <span className="btn-tool-label">
                  {drawingAction === 'edit' ? 'Editing...' : 'Edit Shape'}
                </span>
              </button>
              <button className="btn btn-tool" onClick={() => onDrawingActionChange('clear')}>
                <span className="btn-tool-label">Reset Boundary</span>
              </button>
            </div>
          )}

          {vertexCount > 0 && !boundary && (
            <div className="boundary-status">
              <span className="boundary-status-dot" />
              <span className="boundary-status-text">
                Drawing active — {vertexCount} {vertexCount === 1 ? 'vertex' : 'vertices'} placed
              </span>
            </div>
          )}

          <button
            className="btn btn-primary btn-full"
            disabled={!boundary && vertexCount < 3}
            onClick={boundary ? onAdvanceStep : onFinishShape}
          >
            {boundary ? 'Continue to Sampling →' : 'Close Boundary'}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 1: Boundary ───────────────────────────────────────
  if (currentStep === STEPS.BOUNDARY) {
    const isDrawing = drawingState?.isDrawing;
    const vertexCount = drawingState?.vertexCount || 0;

    return (
      <div className="action-panel">
        <div className="action-card">
          <h3 className="action-title">Define Field Boundary</h3>

          {/* Contextual instruction text */}
          <p className="action-desc">
            {!boundary && !isDrawing &&
              'Tap "Start Drawing" then tap points on the map to outline your rice field.'}
            {isDrawing && vertexCount < 3 &&
              `Tap the map to place vertices. ${vertexCount}/3 minimum points placed.`}
            {isDrawing && vertexCount >= 3 &&
              `${vertexCount} points placed. Tap the first point or double-tap to close the shape.`}
            {boundary && !isDrawing &&
              'Boundary set! You can edit, redraw, or continue to sampling.'}
          </p>

          {/* State 1: not yet drawing — a single entry point */}
          {!boundary && !isDrawing && (
            <button
              className="btn btn-primary btn-full"
              onClick={() => onDrawingActionChange('draw')}
            >
              Start Drawing
            </button>
          )}

          {/* State 2: actively drawing — explicit Cancel / Continue */}
          {!boundary && isDrawing && (
            <>
              <div className="boundary-tools">
                <button
                  className="btn btn-tool"
                  onClick={onUndoVertex}
                  disabled={vertexCount === 0}
                >
                  <span className="btn-tool-label">Undo</span>
                </button>
              </div>

              <div className="boundary-status">
                <span className="boundary-status-dot" />
                <span className="boundary-status-text">
                  Drawing active — {vertexCount} {vertexCount === 1 ? 'vertex' : 'vertices'} placed
                </span>
              </div>

              <div className="boundary-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => onDrawingActionChange(null)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" disabled>
                  Continue →
                </button>
              </div>
            </>
          )}

          {/* State 3: boundary set — review, edit, or advance */}
          {boundary && !isDrawing && (
            <>
              <div className="boundary-tools">
                <button
                  className={`btn btn-tool ${drawingAction === 'edit' ? 'btn-tool-active' : ''}`}
                  onClick={() =>
                    onDrawingActionChange(drawingAction === 'edit' ? null : 'edit')
                  }
                >
                  <span className="btn-tool-label">
                    {drawingAction === 'edit' ? 'Editing...' : 'Edit Shape'}
                  </span>
                </button>
                <button
                  className="btn btn-tool"
                  onClick={() => onDrawingActionChange('clear')}
                >
                  <span className="btn-tool-label">Reset Boundary</span>
                </button>
              </div>

              <button className="btn btn-primary btn-full" onClick={onAdvanceStep}>
                Continue to Sampling →
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Step 2: Sampling ─────────────────────────────────────────
  // No floating panel — the split-layout upload card (SamplePanel)
  // carries all guidance and controls for this step.
  if (currentStep === STEPS.SAMPLING) {
    return null;
  }

  // ── Step 3: Heatmap ────────────────────────────────────────
  // Mobile only — the desktop control set lives in MapSidebar's Heatmap
  // tab instead, beside the map rather than floating over it.
  if (currentStep === STEPS.HEATMAP && isMobile) {
    return (
      <HeatmapTray
        onResumeSampling={onResumeSampling}
        heatmapOpacity={heatmapOpacity}
        onOpacityChange={onOpacityChange}
        heatmapData={heatmapData}
        availableLayers={availableLayers}
        heatmapLayer={heatmapLayer}
        onHeatmapLayerChange={onHeatmapLayerChange}
        onExportReport={onExportReport}
        onReset={onReset}
        isProcessing={isProcessing}
      />
    );
  }

  return null;
}
