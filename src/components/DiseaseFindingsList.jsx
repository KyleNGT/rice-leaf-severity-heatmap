import { pdlaToSes, pdlaToSesContinuous, sesToColor } from '../utils/sesScale';

/**
 * ============================================================
 * DiseaseFindingsList — Labeled multi-disease breakdown
 * ============================================================
 * Shared renderer for plant-level `diseaseFindings` arrays (see
 * aggregateSample.js) — one row per disease at least one photo was
 * diagnosed with, each with its own pooled PDLA %, IRRI SES, and photo
 * count, colored the same way the map and its popups already are
 * (`sesToColor` over the continuous SES so the dot agrees with the heatmap
 * ramp, `pdlaToSes` for the integer class in the text).
 *
 * A rice hill can carry more than one disease at once — a photo diagnosed
 * Leaf Blast and another diagnosed Brown Spot render as two labeled rows
 * instead of collapsing to whichever holds more pixels. Used at plant level
 * only (SamplePanel's summary, SampleMarker's popup) — each PHOTO carries a
 * single dominant diagnosis, shown as plain text at its own tile/row, not
 * this list; see photoDiagnosis in aggregateSample.js.
 */
export default function DiseaseFindingsList({ findings, emptyLabel = null }) {
  if (findings.length === 0) {
    if (!emptyLabel) return null;
    return (
      <div className="disease-findings">
        <span className="disease-findings-empty">{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className="disease-findings">
      {findings.map(({ label, displayName, pdla, photoCount }) => {
        const ses = pdlaToSes(pdla, label);
        const color = sesToColor(pdlaToSesContinuous(pdla, label));
        return (
          <div className="disease-findings-row" key={label}>
            <span className="disease-findings-name">
              <span className="disease-findings-dot" style={{ background: color }} />
              {displayName}
              {photoCount > 0 && (
                <span className="disease-findings-count">
                  · {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
                </span>
              )}
            </span>
            <span className="disease-findings-value">
              {pdla.toFixed(1)}% · SES {ses}
            </span>
          </div>
        );
      })}
    </div>
  );
}
