/**
 * ============================================================
 * LOOCV Export — Browser Download Layer
 * ============================================================
 * The only DOM-touching piece of the LOOCV feature — loocv.js itself is
 * pure and Node-runnable. Wires runLOOCValidation()/optimizePowerParameter()
 * to three downloaded files (residuals CSV, metrics CSV, summary+sweep JSON)
 * and two console.table() dumps, triggered from the button SampleHistorySidebar.jsx
 * renders at the bottom of its plant list (see App.jsx's handleExportLoocv).
 *
 * The metrics CSV carries the same two tables as the console.table() dumps
 * (plus a run header and best-power-per-channel) — needed because the mobile
 * browsers this app is field-tested on have no devtools console.
 *
 * There is no existing generic file-download helper in this codebase —
 * exportReport.js relies on jsPDF's own doc.save() — so this file owns a
 * small local Blob+anchor helper rather than introducing a new dependency.
 */

import {
  runLOOCValidation,
  optimizePowerParameter,
  loocvSummaryRows,
  loocvSweepRows,
  loocvResidualsCsv,
  loocvMetricsCsv,
  loocvSummaryJson,
} from './loocv.js';
import { IDW_POWER } from '../constants/constants';

function downloadTextFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Run LOOCV + a power sweep over the current session's committed samples,
 * print both as console tables, and download a residuals CSV and a
 * summary JSON. Fast (milliseconds for a 50-node session — no image
 * decoding involved), so callers don't need a loading overlay.
 *
 * @param {Array} samples — App.jsx's committed `samples` state.
 * @throws {LoocvInsufficientDataError} if samples.length < MIN_SAMPLES.
 */
export function exportLoocvArtifacts(samples) {
  const result = runLOOCValidation(samples, IDW_POWER);
  const sweep = optimizePowerParameter(samples);

  // eslint-disable-next-line no-console
  console.log(`LOOCV summary (N=${result.n}, power=${result.power}):`);
  // eslint-disable-next-line no-console
  console.table(loocvSummaryRows(result));
  // eslint-disable-next-line no-console
  console.log('Power sweep (lowest RMSE wins, ties favor lower power):');
  // eslint-disable-next-line no-console
  console.table(loocvSweepRows(sweep));

  const stamp = todayStamp();
  downloadTextFile(`loocv-residuals-${stamp}.csv`, loocvResidualsCsv(result), 'text/csv');
  downloadTextFile(`loocv-metrics-${stamp}.csv`, loocvMetricsCsv(result, sweep), 'text/csv');
  downloadTextFile(
    `loocv-summary-${stamp}.json`,
    JSON.stringify(loocvSummaryJson(samples, result, sweep), null, 2),
    'application/json'
  );

  return { result, sweep };
}
