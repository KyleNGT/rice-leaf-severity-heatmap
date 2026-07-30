/**
 * ============================================================
 * IRRI SES Banding — PDLA % → Standard Evaluation System 0–9
 * ============================================================
 * Maps a continuous PDLA percentage to the IRRI Standard Evaluation System
 * for Rice's 0–9 disease severity scale, per disease class — see the
 * breakpoint tables and their sourcing notes in constants.js.
 *
 * Two mappings are exported:
 *   - pdlaToSes            — the exact integer SES class (0–9), what the
 *                             thesis can cite as "this cell is SES n".
 *   - pdlaToSesContinuous  — a fractional SES (e.g. 3.60) for smooth
 *                             rendering. It is built so
 *                             Math.floor(pdlaToSesContinuous(p, d)) ===
 *                             pdlaToSes(p, d) ALWAYS, including exactly on a
 *                             band's own upper edge — see the epsilon note
 *                             below. That invariant is what lets the heatmap
 *                             render smoothly while still being defensible
 *                             as "a map of the same 10 classes IRRI defines".
 *
 * Pure module — no React, no DOM. Runnable directly under `node`, same as
 * aggregateSample.js, which is why the import below keeps the explicit .js
 * extension instead of relying on Vite's resolver.
 */
import {
  SES_BREAKPOINTS_SHARED,
  SES_BREAKPOINTS_BLAST,
  SES_FALLBACK_BREAKPOINTS,
  SES_COLORS,
  HEATMAP_LAYER_GENERAL,
} from '../constants/constants.js';

/** The one disease with its own IRRI table; everything else — including any
 * label a future retrained checkpoint introduces — uses the shared scale. */
const BLAST_LABEL = 'leaf_blast';

/** Nudges a continuous value exactly on a band's own upper edge back under
 * the next integer, so Math.floor never disagrees with pdlaToSes there. The
 * color difference this makes (at most 1/2^30 of a step) is imperceptible;
 * see the module docblock for why exact agreement matters more than that. */
const CONTINUOUS_EPSILON = 1e-9;

export function sesBreakpointsFor(diseaseLabel) {
  if (diseaseLabel === BLAST_LABEL) return SES_BREAKPOINTS_BLAST;
  return SES_FALLBACK_BREAKPOINTS ?? SES_BREAKPOINTS_SHARED;
}

/**
 * The exact integer IRRI SES class (0–9) for a PDLA percentage.
 * @param {number} pdlaPercent
 * @param {string} diseaseLabel — e.g. 'leaf_blast', 'brown_spot'
 * @returns {number} 0–9
 */
export function pdlaToSes(pdlaPercent, diseaseLabel) {
  const bp = sesBreakpointsFor(diseaseLabel);
  const p = Math.max(0, pdlaPercent);
  if (p === 0) return 0;

  for (let level = 1; level <= 8; level++) {
    const hi = bp[level];
    // The shared scale's only irregular seam: IRRI writes level 1 as "> 0%
    // to < 1%" and level 2 as "≥ 1% to 3%", so the boundary point 1 belongs
    // to level 2, not level 1 — everywhere else the upper bound is inclusive.
    const upperIsExclusive = diseaseLabel !== BLAST_LABEL && level === 1;
    if (upperIsExclusive ? p < hi : p <= hi) return level;
  }
  return 9;
}

/**
 * A fractional SES in [0, 9] for smooth rendering — see module docblock for
 * the floor invariant this maintains against pdlaToSes.
 * @param {number} pdlaPercent
 * @param {string} diseaseLabel
 * @returns {number}
 */
export function pdlaToSesContinuous(pdlaPercent, diseaseLabel) {
  const p = Math.max(0, pdlaPercent);
  const level = pdlaToSes(p, diseaseLabel);
  if (level === 0) return 0;

  const bp = sesBreakpointsFor(diseaseLabel);
  const lo = bp[level - 1];
  // Level 9 is open-ended in the IRRI table (no real upper bound) — bp[9] is
  // the synthetic 100%-PDLA ceiling constants.js documents for this purpose.
  const hi = bp[level];
  const fraction = hi > lo ? (p - lo) / (hi - lo) : 0;

  return level + Math.min(fraction, 1 - CONTINUOUS_EPSILON);
}

/**
 * Band table for a disease, for legend display — the PDLA range backing
 * each SES level, with the top level's upper bound left `null` (open-ended,
 * matching IRRI's own "> 75%" / "> 65%" phrasing).
 * @param {string} diseaseLabel
 * @returns {Array<{level: number, lo: number, hi: number|null}>}
 */
export function sesBandTable(diseaseLabel) {
  const bp = sesBreakpointsFor(diseaseLabel);
  return Array.from({ length: 9 }, (_, i) => {
    const level = i + 1;
    return { level, lo: bp[level - 1], hi: level === 9 ? null : bp[level] };
  });
}

/**
 * A committed sample's SES on a given heatmap layer — the point-level
 * equivalent of sesGrid.js's grid functions, so a marker's color always
 * agrees with the surface cell underneath it. For the General layer this is
 * MAX() over the plant's own per-disease SES, mirroring maxSesGrid exactly.
 * @param {{ diseaseSeverity?: object, diseaseLabels?: string[] }} sample
 * @param {string} layerKey — a disease label, or HEATMAP_LAYER_GENERAL
 * @returns {number} continuous SES, 0–9
 */
export function sampleSesForLayer(sample, layerKey) {
  const diseaseSeverity = sample?.diseaseSeverity ?? {};
  const diseaseLabels = sample?.diseaseLabels ?? Object.keys(diseaseSeverity);

  if (layerKey === HEATMAP_LAYER_GENERAL) {
    let best = 0;
    for (const label of diseaseLabels) {
      const ses = pdlaToSesContinuous(diseaseSeverity[label] ?? 0, label);
      if (ses > best) best = ses;
    }
    return best;
  }

  return pdlaToSesContinuous(diseaseSeverity[layerKey] ?? 0, layerKey);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * SES value (integer or fractional, 0–9) → CSS rgb() color, linearly
 * interpolated between the two nearest SES_COLORS anchors.
 * @param {number} sesValue
 * @returns {string}
 */
export function sesToColor(sesValue) {
  const clamped = Math.max(0, Math.min(9, sesValue));
  const lower = Math.floor(clamped);
  const upper = Math.min(9, lower + 1);
  const f = clamped - lower;

  const [r1, g1, b1] = hexToRgb(SES_COLORS[lower]);
  const [r2, g2, b2] = hexToRgb(SES_COLORS[upper]);

  const r = Math.round(r1 + f * (r2 - r1));
  const g = Math.round(g1 + f * (g2 - g1));
  const b = Math.round(b1 + f * (b2 - b1));

  return `rgb(${r}, ${g}, ${b})`;
}
