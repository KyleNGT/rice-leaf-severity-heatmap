/**
 * ============================================================
 * LOOCV Export — Browser Delivery Layer
 * ============================================================
 * The only DOM-touching piece of the LOOCV feature — loocv.js itself is
 * pure and Node-runnable. Wires runLOOCValidation()/optimizePowerParameter()
 * to three files (residuals CSV, metrics CSV, summary+sweep JSON) and two
 * console.table() dumps, triggered from the button SampleHistorySidebar.jsx
 * renders at the bottom of its plant list (see App.jsx's handleExportLoocv).
 *
 * The metrics CSV carries the same two tables as the console.table() dumps
 * (plus a run header and best-power-per-channel) — needed because the mobile
 * browsers this app is field-tested on have no devtools console.
 *
 * DELIVERY: mobile browsers (iOS Safari especially) honour only ONE
 * programmatic `<a download>` per user gesture, so firing three in a row
 * silently drops two of them. When the Web Share API can take files we
 * hand all three to the native share sheet (Save to Files / Mail / …) in a
 * single call instead; desktop and any browser without file-share support
 * fall back to the sequential-download path, which works fine there.
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

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Push the files to the user. Prefers a single Web Share sheet (so mobile
 * gets all three at once); otherwise downloads them one by one.
 *
 * Must be called synchronously from the click handler's task — no `await`
 * may run before this — or the browser's transient-activation window for
 * `navigator.share` will have closed.
 */
async function deliverFiles(files) {
  // Only route through the share sheet on touch-primary devices, where the
  // one-download-per-tap limit actually bites. Desktop keeps the plain
  // multi-download so the `npm run loocv` re-run workflow is untouched.
  const isTouchPrimary =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const canShareFiles =
    isTouchPrimary &&
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files });

  if (canShareFiles) {
    try {
      await navigator.share({
        files,
        title: 'LOOCV validation results',
        text: 'IDW interpolation accuracy: per-fold residuals, summary tables, and a re-run JSON.',
      });
      return;
    } catch (err) {
      // User dismissed the share sheet — that's a deliberate cancel, not a
      // failure; don't dump three downloads they just backed out of.
      if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
      // Anything else (rare) — fall through to the download path.
    }
  }

  for (const file of files) {
    downloadFile(file);
  }
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Run LOOCV + a power sweep over the current session's committed samples,
 * print both as console tables, and deliver a residuals CSV, a metrics CSV,
 * and a summary JSON (share sheet on mobile, downloads otherwise). Fast
 * (milliseconds for a 50-node session — no image decoding involved), so
 * callers don't need a loading overlay.
 *
 * Async because the Web Share path awaits the user closing the sheet.
 * Callers must invoke it directly from the click handler (no awaited work
 * before it) so `navigator.share`'s transient-activation requirement holds.
 *
 * @param {Array} samples — App.jsx's committed `samples` state.
 * @throws {LoocvInsufficientDataError} if samples.length < MIN_SAMPLES.
 */
export async function exportLoocvArtifacts(samples) {
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
  const files = [
    new File([loocvResidualsCsv(result)], `loocv-residuals-${stamp}.csv`, { type: 'text/csv' }),
    new File([loocvMetricsCsv(result, sweep)], `loocv-metrics-${stamp}.csv`, { type: 'text/csv' }),
    new File(
      [JSON.stringify(loocvSummaryJson(samples, result, sweep), null, 2)],
      `loocv-summary-${stamp}.json`,
      { type: 'application/json' }
    ),
  ];

  await deliverFiles(files);

  return { result, sweep };
}
