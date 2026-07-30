/**
 * ============================================================
 * SES Grid Derivation — PDLA Grids → SES Grids → General Layer
 * ============================================================
 * Sits between idwInterpolation.js (which only knows continuous PDLA %) and
 * HeatmapOverlay.jsx (which only knows how to paint a continuous SES value).
 * Kept as its own module, rather than folded into either, so switching the
 * active layer in the UI is a cheap re-render, not a worker re-run — see
 * the useMemo in App.jsx that calls these.
 *
 * Pure module — no React, no DOM.
 */
import { pdlaToSesContinuous } from './sesScale.js';

/** The worker's "outside boundary" sentinel — see idwWorker.js. Carried
 * through every step so a cell outside the field never gets banded into a
 * fake SES 0 (which would read as "healthy" instead of "not part of the field"). */
const OUTSIDE_BOUNDARY = -1;

/**
 * Bands one disease's continuous-PDLA grid into a continuous-SES grid,
 * preserving the outside-boundary sentinel cell-for-cell.
 * @param {Float32Array} grid — PDLA percentages, -1 outside the boundary
 * @param {string} diseaseLabel
 * @returns {Float32Array} continuous SES values, -1 outside the boundary
 */
export function pdlaGridToSes(grid, diseaseLabel) {
  const out = new Float32Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    const p = grid[i];
    out[i] = p < 0 ? OUTSIDE_BOUNDARY : pdlaToSesContinuous(p, diseaseLabel);
  }
  return out;
}

/**
 * The General Threat layer: the per-cell MAX() across every disease's SES
 * grid, per the IRRI-based spec this app implements. Taking the max of the
 * CONTINUOUS SES values (rather than banding first, then maxing integers) is
 * equivalent — floor is monotone, so floor(max(a, b)) === max(floor(a),
 * floor(b)) — and this way the General layer renders exactly as smoothly as
 * every per-disease layer.
 * @param {Float32Array[]} sesGrids — same length, cell-aligned (all
 *   produced by pdlaGridToSes over the same IDW run, so their outside-
 *   boundary cells line up exactly).
 * @returns {Float32Array}
 */
export function maxSesGrid(sesGrids) {
  if (sesGrids.length === 0) return new Float32Array(0);
  const length = sesGrids[0].length;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let best = OUTSIDE_BOUNDARY;
    for (let g = 0; g < sesGrids.length; g++) {
      const v = sesGrids[g][i];
      if (v > best) best = v;
    }
    out[i] = best;
  }
  return out;
}
