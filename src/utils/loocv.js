/**
 * ============================================================
 * Leave-One-Out Cross-Validation for the IDW Surface
 * ============================================================
 * Answers the thesis question "how accurate is the interpolated heatmap at
 * an un-sampled location?" by holding out each committed plant node in
 * turn, predicting its severity from the remaining N-1 nodes with the SAME
 * estimator the heatmap uses (idwCore.js's idwEstimateInto — see that
 * file's docblock for the formula and its degree-space distance caveat),
 * and comparing prediction to the node's actual measured value.
 *
 * Pure, DOM-free, Node-runnable (same discipline as sesScale.js — explicit
 * `.js` extensions on relative imports so `node src/utils/loocv.js` and
 * scripts/loocv.js resolve without a bundler). The only DOM-touching layer
 * is exportLoocv.js, which wraps these functions for the browser download
 * button in SampleHistorySidebar.jsx.
 *
 * IMPORTANT SCOPE NOTE (repeat in CLAUDE.md's LOOCV Validation section):
 * this measures INTERPOLATION skill at sampled locations, not SegFormer
 * classification accuracy, and not accuracy deep in the field interior
 * where sampling is sparsest. See CLAUDE.md for the full limitations list
 * (edge-node pessimism, coincident-node artifacts, degenerate channels,
 * equal node weighting).
 */

import { idwEstimateInto } from './idwCore.js';
import { resolveDiseaseChannels } from './idwInterpolation.js';
import { IDW_POWER, MIN_SAMPLES } from '../constants/constants.js';

/** Thrown when a dataset has too few points for a meaningful LOOCV fold —
 * IDW needs at least 2 OTHER points to interpolate from once one is held
 * out, matching the app's own MIN_SAMPLES gate on real sampling sessions. */
export class LoocvInsufficientDataError extends Error {
  constructor(n) {
    super(`LOOCV requires at least ${MIN_SAMPLES} points (got ${n}).`);
    this.name = 'LoocvInsufficientDataError';
    this.n = n;
  }
}

const TOTAL_SEVERITY_CHANNEL = '__total__';

/**
 * Build the { lat, lng, values[] } sample rows idwEstimateInto expects,
 * for a given ordered list of channel keys. Mirrors idwInterpolation.js's
 * computeIDW worker-input mapping exactly, plus the optional synthetic
 * total-severity channel LOOCV supports that the live heatmap does not.
 */
function toEstimatorSamples(dataset, channelKeys) {
  return dataset.map((s) => ({
    lat: s.lat,
    lng: s.lng,
    values: channelKeys.map((key) =>
      key === TOTAL_SEVERITY_CHANNEL ? (s.severity ?? 0) : (s.diseaseSeverity?.[key] ?? 0)
    ),
  }));
}

/**
 * Run Leave-One-Out Cross-Validation over a committed-samples dataset.
 *
 * @param {Array<{ id, lat, lng, severity, diseaseSeverity }>} dataset —
 *   committed plant samples, the same objects `App.jsx`'s `samples` state
 *   holds (see CLAUDE.md's committed sample shape).
 * @param {number} [powerParameter=IDW_POWER] — IDW power p to validate.
 * @param {object} [options]
 * @param {string[]} [options.channelKeys] — defaults to
 *   resolveDiseaseChannels(dataset).channelKeys, i.e. the exact channels
 *   the live heatmap would render for this dataset.
 * @param {boolean} [options.includeTotalSeverity=false] — also score a
 *   synthetic channel reading each sample's plant-pooled `severity` total
 *   (not one the heatmap itself renders as a channel, but the aggregate
 *   figure most likely to be quoted in a results table).
 * @returns {{
 *   n: number, power: number, channelKeys: string[],
 *   mae: number, rmse: number,
 *   channels: Record<string, { n: number, mae: number, rmse: number, meanActual: number, degenerate: boolean }>,
 *   residuals: Array<{ plantIndex: number, plantId: string, lat: number, lng: number, channel: string, actual: number, predicted: number, error: number, absError: number }>,
 * }}
 */
export function runLOOCValidation(dataset, powerParameter = IDW_POWER, options = {}) {
  const n = dataset.length;
  if (n < MIN_SAMPLES) {
    throw new LoocvInsufficientDataError(n);
  }

  const channelKeys = options.channelKeys ?? resolveDiseaseChannels(dataset).channelKeys;
  const scoredChannels = options.includeTotalSeverity
    ? [...channelKeys, TOTAL_SEVERITY_CHANNEL]
    : channelKeys;

  const estimatorSamples = toEstimatorSamples(dataset, scoredChannels);
  const channels = scoredChannels.length;
  const out = new Float64Array(channels);

  const residuals = [];
  // Per-channel accumulators for sum|error| and sum(error^2), plus the
  // actual-value range needed to flag a degenerate (constant-actual) channel.
  const sumAbsError = new Float64Array(channels).fill(0);
  const sumSqError = new Float64Array(channels).fill(0);
  const sumActual = new Float64Array(channels).fill(0);
  const minActual = new Float64Array(channels).fill(Infinity);
  const maxActual = new Float64Array(channels).fill(-Infinity);

  for (let i = 0; i < n; i++) {
    const target = estimatorSamples[i];
    idwEstimateInto(out, estimatorSamples, target.lat, target.lng, powerParameter, channels, i);

    for (let ch = 0; ch < channels; ch++) {
      const actual = target.values[ch];
      const predicted = out[ch];
      const error = predicted - actual;

      sumAbsError[ch] += Math.abs(error);
      sumSqError[ch] += error * error;
      sumActual[ch] += actual;
      if (actual < minActual[ch]) minActual[ch] = actual;
      if (actual > maxActual[ch]) maxActual[ch] = actual;

      residuals.push({
        plantIndex: i,
        plantId: dataset[i].id,
        lat: dataset[i].lat,
        lng: dataset[i].lng,
        channel: scoredChannels[ch],
        actual,
        predicted,
        error,
        absError: Math.abs(error),
      });
    }
  }

  const channelsResult = {};
  let totalAbsError = 0;
  let totalSqError = 0;
  const totalFolds = n * channels;

  for (let ch = 0; ch < channels; ch++) {
    totalAbsError += sumAbsError[ch];
    totalSqError += sumSqError[ch];
    channelsResult[scoredChannels[ch]] = {
      n,
      mae: sumAbsError[ch] / n,
      rmse: Math.sqrt(sumSqError[ch] / n),
      meanActual: sumActual[ch] / n,
      // A channel where every held-out actual is identical (most commonly
      // all-zero, i.e. the disease is absent from every node) scores a
      // trivially perfect MAE/RMSE — that's an artifact of no variance to
      // predict, not measured interpolation skill. Never quote it.
      degenerate: maxActual[ch] - minActual[ch] < 1e-9,
    };
  }

  return {
    n,
    power: powerParameter,
    channelKeys: scoredChannels,
    mae: totalAbsError / totalFolds,
    rmse: Math.sqrt(totalSqError / totalFolds),
    channels: channelsResult,
    residuals,
  };
}

/**
 * Sweep a list of candidate IDW power parameters, running full LOOCV for
 * each, and report which minimizes pooled RMSE. Existing rationale for
 * IDW_POWER = 2 (src/constants/constants.js) can be checked against this,
 * or a measured optimum substituted with a documented, cited change.
 *
 * @param {Array} dataset
 * @param {number[]} [candidatePowers=[1.0, 1.5, 2.0, 2.5, 3.0]]
 * @param {object} [options] — forwarded to runLOOCValidation per candidate.
 * @returns {{
 *   candidates: Array<{ power: number, mae: number, rmse: number, channels: object }>,
 *   optimalPower: number, optimalRmse: number,
 *   bestPerChannel: Record<string, { power: number, rmse: number }>,
 * }}
 */
export function optimizePowerParameter(
  dataset,
  candidatePowers = [1.0, 1.5, 2.0, 2.5, 3.0],
  options = {}
) {
  if (!candidatePowers || candidatePowers.length === 0) {
    throw new Error('optimizePowerParameter requires at least one candidate power.');
  }

  const candidates = candidatePowers.map((power) => {
    const result = runLOOCValidation(dataset, power, options);
    return { power, mae: result.mae, rmse: result.rmse, channels: result.channels };
  });

  // Lowest pooled RMSE wins; ties break toward the lower power (the
  // smoother, more conservative surface — standard IDW convention).
  let best = candidates[0];
  for (const c of candidates.slice(1)) {
    if (c.rmse < best.rmse - 1e-12) best = c;
  }

  const bestPerChannel = {};
  for (const key of candidates[0] ? Object.keys(candidates[0].channels) : []) {
    let bestForKey = candidates[0];
    for (const c of candidates.slice(1)) {
      if (c.channels[key].rmse < bestForKey.channels[key].rmse - 1e-12) bestForKey = c;
    }
    bestPerChannel[key] = { power: bestForKey.power, rmse: bestForKey.channels[key].rmse };
  }

  return {
    candidates,
    optimalPower: best.power,
    optimalRmse: best.rmse,
    bestPerChannel,
  };
}

/** Plain-object rows for `console.table(loocvSummaryRows(result))`. */
export function loocvSummaryRows(result) {
  const rows = Object.entries(result.channels).map(([channel, c]) => ({
    channel,
    n: c.n,
    mae: c.mae.toFixed(2),
    rmse: c.rmse.toFixed(2),
    meanActual: c.meanActual.toFixed(2),
    degenerate: c.degenerate,
  }));
  rows.push({
    channel: '(pooled, all channels)',
    n: result.n,
    mae: result.mae.toFixed(2),
    rmse: result.rmse.toFixed(2),
    meanActual: '—',
    degenerate: rows.every((r) => r.degenerate),
  });
  return rows;
}

/** Plain-object rows for `console.table(loocvSweepRows(sweep))`. */
export function loocvSweepRows(sweep) {
  return sweep.candidates.map((c) => ({
    power: c.power,
    mae: c.mae.toFixed(2),
    rmse: c.rmse.toFixed(2),
    isOptimal: c.power === sweep.optimalPower,
  }));
}

/**
 * Escape one value for a CSV cell: wrap in double quotes (doubling any
 * embedded quote) when the stringified value contains a comma, a quote, a
 * newline, or leading/trailing whitespace. Channel labels like
 * `(pooled, all channels)` contain a comma, so an unquoted `.join(',')`
 * would silently split them across two columns.
 */
function csvCell(value) {
  const s = String(value);
  return /[",\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text of every per-point, per-channel residual — one row per fold. */
export function loocvResidualsCsv(result) {
  const header = 'plant_index,plant_id,lat,lng,disease,actual_pdla,predicted_pdla,error,abs_error';
  const lines = result.residuals.map((r) =>
    [
      r.plantIndex,
      r.plantId,
      r.lat.toFixed(6),
      r.lng.toFixed(6),
      r.channel,
      r.actual.toFixed(2),
      r.predicted.toFixed(2),
      r.error.toFixed(2),
      r.absError.toFixed(2),
    ]
      .map(csvCell)
      .join(',')
  );
  return [header, ...lines].join('\n');
}

/**
 * CSV rendering of the two tables exportLoocv.js also dumps via
 * console.table() (the per-channel summary and the power sweep), plus a
 * third best-power-per-channel section and a `#`-comment run header. This
 * exists because the mobile browsers this app is field-tested on expose no
 * devtools console, so the console dumps are invisible where they matter.
 *
 * Rows are taken from loocvSummaryRows()/loocvSweepRows() — the same
 * helpers console.table() and scripts/loocv.js use — so the CSV can never
 * drift from the printed tables. The pooled row's em-dash meanActual
 * becomes an empty cell (numeric column).
 */
export function loocvMetricsCsv(result, sweep) {
  const lines = [];

  lines.push(`# generated_at,${new Date().toISOString()}`);
  lines.push(`# n,${result.n}`);
  lines.push(`# power,${result.power}`);
  lines.push(`# optimal_power,${sweep.optimalPower}`);
  lines.push(`# optimal_rmse,${sweep.optimalRmse.toFixed(2)}`);
  lines.push('# errors are PDLA percentage points, not banded SES');
  lines.push('');

  lines.push('table,channel,n,mae,rmse,mean_actual,degenerate');
  for (const row of loocvSummaryRows(result)) {
    lines.push(
      [
        'summary',
        row.channel,
        row.n,
        row.mae,
        row.rmse,
        row.meanActual === '—' ? '' : row.meanActual,
        row.degenerate,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  lines.push('');

  lines.push('table,power,mae,rmse,is_optimal');
  for (const row of loocvSweepRows(sweep)) {
    lines.push(['sweep', row.power, row.mae, row.rmse, row.isOptimal].map(csvCell).join(','));
  }
  lines.push('');

  lines.push('table,channel,best_power,rmse');
  for (const [channel, best] of Object.entries(sweep.bestPerChannel)) {
    lines.push(
      ['best_power_per_channel', channel, best.power, best.rmse.toFixed(2)].map(csvCell).join(',')
    );
  }

  return lines.join('\n');
}

/**
 * Serializable summary bundling the LOOCV result, the power sweep, and a
 * slim copy of the input samples (id/lat/lng/severity/diseaseSeverity only
 * — never thumbnails or masks) so the JSON file alone is enough to re-run
 * the validation offline later, however long after the session it's opened.
 */
export function loocvSummaryJson(dataset, result, sweep) {
  return {
    generatedAt: new Date().toISOString(),
    n: result.n,
    power: result.power,
    channelKeys: result.channelKeys,
    mae: result.mae,
    rmse: result.rmse,
    channels: result.channels,
    sweep: {
      candidates: sweep.candidates,
      optimalPower: sweep.optimalPower,
      optimalRmse: sweep.optimalRmse,
      bestPerChannel: sweep.bestPerChannel,
    },
    samples: dataset.map((s) => ({
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      severity: s.severity,
      diseaseSeverity: s.diseaseSeverity,
    })),
  };
}
