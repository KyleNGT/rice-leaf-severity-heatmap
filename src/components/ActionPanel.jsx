import { STEPS, HEATMAP_MIN_OPACITY, HEATMAP_MAX_OPACITY } from '../constants/constants';

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
  heatmapOpacity,
  onOpacityChange,
  heatmapData,
  // Boundary drawing props
  drawingAction,
  onDrawingActionChange,
  drawingState,
}) {
  // ── Step 1: Boundary ───────────────────────────────────────
  if (currentStep === STEPS.BOUNDARY) {
    const isDrawing = drawingState?.isDrawing;
    const vertexCount = drawingState?.vertexCount || 0;

    return (
      <div className="action-panel">
        <div className="action-card">
          <h3 className="action-title">
            <span className="action-icon">📐</span>
            Define Field Boundary
          </h3>

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

          {/* Drawing tool buttons */}
          <div className="boundary-tools">
            {!boundary && (
              <button
                className={`btn btn-tool ${drawingAction === 'draw' ? 'btn-tool-active' : ''}`}
                onClick={() =>
                  onDrawingActionChange(drawingAction === 'draw' ? null : 'draw')
                }
              >
                <span className="btn-tool-icon">✏️</span>
                <span className="btn-tool-label">
                  {drawingAction === 'draw' ? 'Drawing...' : 'Start Drawing'}
                </span>
              </button>
            )}

            {boundary && !isDrawing && (
              <>
                <button
                  className={`btn btn-tool ${drawingAction === 'edit' ? 'btn-tool-active' : ''}`}
                  onClick={() =>
                    onDrawingActionChange(drawingAction === 'edit' ? null : 'edit')
                  }
                >
                  <span className="btn-tool-icon">✋</span>
                  <span className="btn-tool-label">
                    {drawingAction === 'edit' ? 'Editing...' : 'Edit Shape'}
                  </span>
                </button>
                <button
                  className={`btn btn-tool ${drawingAction === 'delete' ? 'btn-tool-active' : ''}`}
                  onClick={() =>
                    onDrawingActionChange(drawingAction === 'delete' ? null : 'delete')
                  }
                >
                  <span className="btn-tool-icon">🗑️</span>
                  <span className="btn-tool-label">
                    {drawingAction === 'delete' ? 'Tap shape to delete' : 'Clear Boundary'}
                  </span>
                </button>
              </>
            )}
          </div>

          {/* Status indicator during drawing */}
          {isDrawing && (
            <div className="boundary-status">
              <span className="boundary-status-dot" />
              <span className="boundary-status-text">
                Drawing active — {vertexCount} {vertexCount === 1 ? 'vertex' : 'vertices'} placed
              </span>
            </div>
          )}

          {/* Continue button */}
          <button
            className="btn btn-primary btn-full"
            disabled={!boundary || isDrawing}
            onClick={onAdvanceStep}
          >
            {boundary ? 'Continue to Sampling →' : 'Draw boundary to continue'}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: Sampling (notification alert) ──────────────────
  if (currentStep === STEPS.SAMPLING) {
    return (
      <div className="sampling-alert">
        <span className="sampling-alert-icon">🌾</span>
        <span className="sampling-alert-text">
          Take or upload photos of rice leaves to collect samples.
        </span>
      </div>
    );
  }

  // ── Step 3: Heatmap ────────────────────────────────────────
  if (currentStep === STEPS.HEATMAP) {
    return (
      <div className="action-panel">
        <div className="action-card">
          <h3 className="action-title">
            <span className="action-icon">🗺️</span>
            Disease Pressure Heatmap
          </h3>

          {heatmapData && (
            <div className="opacity-control">
              <label htmlFor="opacity-slider" className="opacity-label">
                Overlay Opacity
              </label>
              <input
                id="opacity-slider"
                type="range"
                min={HEATMAP_MIN_OPACITY * 100}
                max={HEATMAP_MAX_OPACITY * 100}
                value={Math.round(heatmapOpacity * 100)}
                onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
                className="opacity-slider"
              />
              <span className="opacity-value">{Math.round(heatmapOpacity * 100)}%</span>
            </div>
          )}

          <button
            className="btn btn-secondary btn-full"
            onClick={onReset}
          >
            ↩ Start New Analysis
          </button>
        </div>
      </div>
    );
  }

  return null;
}
