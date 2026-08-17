/**
 * ============================================================
 * StepperBar — Adaptive step progress indicator
 * ============================================================
 * Mobile: Shows only the current step as a compact pill badge
 *         (e.g., "Step 1/3 · Draw Boundary") to prevent overlap.
 * Desktop: Shows the full horizontal stepper with connectors.
 *
 * Heuristic: Visibility of system status — the user always
 * knows where they are in the workflow.
 */
import { STEP_ORDER, STEP_LABELS } from '../constants/constants';

export default function StepperBar({ currentStep }) {
  const currentIdx = STEP_ORDER.indexOf(currentStep);
  const totalSteps = STEP_ORDER.length;

  return (
    <>
      {/* Mobile: compact pill showing only current step */}
      <div className="stepper-mobile">
        <span className="stepper-mobile-text">
          Step {currentIdx + 1}/{totalSteps}
        </span>
        <span className="stepper-mobile-divider">·</span>
        <span className="stepper-mobile-label">
          {STEP_LABELS[currentStep]}
        </span>
      </div>

      {/* Desktop: full horizontal stepper */}
      <div className="stepper-desktop">
        {STEP_ORDER.map((step, idx) => {
          const isActive = idx === currentIdx;
          const isCompleted = idx < currentIdx;

          return (
            <div key={step} className="stepper-item-wrapper">
              <div
                className={`stepper-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
              >
                {isCompleted ? (
                  <div className="stepper-icon" aria-hidden="true">
                    ✓
                  </div>
                ) : (
                  <div className="stepper-index" aria-hidden="true">
                    {idx + 1}
                  </div>
                )}
                <span className="stepper-label">{STEP_LABELS[step]}</span>
              </div>
              {idx < STEP_ORDER.length - 1 && (
                <div
                  className={`stepper-connector ${isCompleted ? 'completed' : ''}`}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
