/**
 * ============================================================
 * ColorLegend — Gradient severity scale
 * ============================================================
 * Fixed overlay showing the green → red gradient with labels.
 */
export default function ColorLegend() {
  return (
    <div className="color-legend">
      <span className="legend-title">Disease Severity</span>
      <div className="legend-gradient" />
      <div className="legend-labels">
        <span>0% Healthy</span>
        <span>50%</span>
        <span>100% Severe</span>
      </div>
    </div>
  );
}
