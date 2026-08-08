#!/usr/bin/env node
/**
 * ============================================================
 * LOOCV Offline Runner
 * ============================================================
 * Closes the loop between the in-app "Export LOOCV Validation" button
 * (SampleHistorySidebar.jsx → exportLoocv.js) and offline re-analysis for
 * the thesis manuscript: take a downloaded loocv-summary-*.json (or a bare
 * array of committed samples) and re-run the validation / power sweep
 * without touching the app or a browser.
 *
 * Usage:
 *   node scripts/loocv.js <path-to-json> [--powers=1,1.5,2,2.5,3]
 *   npm run loocv -- <path-to-json> [--powers=1,1.5,2,2.5,3]
 *   node scripts/loocv.js --selftest
 *
 * Input JSON may be either:
 *   - a loocv-summary-*.json file (has a top-level `samples` array), or
 *   - a bare array of committed samples ([{ id, lat, lng, severity,
 *     diseaseSeverity }, ...]).
 *
 * --selftest runs analytic + refactor-parity checks with no input file —
 * see runSelfTest() below. Intended as the manual verification step for
 * any future change to idwCore.js or loocv.js, since there is no test
 * runner configured in this project (see CLAUDE.md's toolstack table).
 */

import { readFileSync } from 'node:fs';
import {
  runLOOCValidation,
  optimizePowerParameter,
  loocvSummaryRows,
  loocvSweepRows,
  LoocvInsufficientDataError,
} from '../src/utils/loocv.js';
import { idwEstimateInto } from '../src/utils/idwCore.js';

function parseArgs(argv) {
  const args = { file: null, powers: null, selftest: false };
  for (const arg of argv) {
    if (arg === '--selftest') {
      args.selftest = true;
    } else if (arg.startsWith('--powers=')) {
      args.powers = arg
        .slice('--powers='.length)
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n));
    } else if (!arg.startsWith('--')) {
      args.file = arg;
    }
  }
  return args;
}

function loadSamples(path) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const samples = Array.isArray(raw) ? raw : raw.samples;
  if (!Array.isArray(samples)) {
    throw new Error(
      `${path} has no usable sample array — expected a bare array or a { samples: [...] } object.`
    );
  }
  return samples;
}

function printResults(samples, powers) {
  // The headline summary always uses the app's own default IDW_POWER (via
  // runLOOCValidation's default parameter) regardless of --powers, which
  // only controls the sweep — matches what the in-app export button does.
  const result = runLOOCValidation(samples);
  const sweep = optimizePowerParameter(samples, powers && powers.length > 0 ? powers : undefined);

  console.log(`\nLOOCV summary (N=${result.n}, power=${result.power}):`);
  console.table(loocvSummaryRows(result));

  console.log('\nPower sweep (lowest pooled RMSE wins, ties favor lower power):');
  console.table(loocvSweepRows(sweep));

  console.log(
    `\nOptimal power: ${sweep.optimalPower} (RMSE ${sweep.optimalRmse.toFixed(2)})`
  );
}

/**
 * The pre-refactor IDW loop, copied verbatim as a reference implementation
 * to check idwCore.js's idwEstimateInto() against — see idwWorker.js's git
 * history for the original inline version this mirrors.
 */
function referenceEstimate(samples, lat, lng, power, channels, skipIndex) {
  const numerators = new Float64Array(channels);
  let denominator = 0;
  let exactMatchIdx = -1;

  for (let i = 0; i < samples.length; i++) {
    if (i === skipIndex) continue;
    const dx = lng - samples[i].lng;
    const dy = lat - samples[i].lat;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-10) {
      exactMatchIdx = i;
      break;
    }
    const w = 1 / Math.pow(dist, power);
    denominator += w;
    const values = samples[i].values;
    for (let ch = 0; ch < channels; ch++) numerators[ch] += w * values[ch];
  }

  const out = new Float64Array(channels);
  for (let ch = 0; ch < channels; ch++) {
    out[ch] =
      exactMatchIdx >= 0
        ? samples[exactMatchIdx].values[ch]
        : denominator > 0
          ? numerators[ch] / denominator
          : 0;
  }
  return out;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Self-test FAILED: ${message}`);
}

function approxEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

function runSelfTest() {
  let checks = 0;

  // ── 1. Refactor parity: idwEstimateInto vs. the pre-refactor reference
  //    loop, over randomized sample sets, both with and without a skipped
  //    index. This is the check that matters most — it's what proves the
  //    idwCore.js extraction didn't move the heatmap. ──────────────────
  const rng = mulberry32(42);
  for (let trial = 0; trial < 200; trial++) {
    const channels = 1 + Math.floor(rng() * 3);
    const n = 2 + Math.floor(rng() * 20);
    const samples = Array.from({ length: n }, () => ({
      lat: 14 + rng() * 0.1,
      lng: 121 + rng() * 0.1,
      values: Array.from({ length: channels }, () => rng() * 100),
    }));
    const power = 1 + rng() * 3;
    const lat = 14 + rng() * 0.1;
    const lng = 121 + rng() * 0.1;
    const skipIndex = rng() < 0.5 ? -1 : Math.floor(rng() * n);

    const out = new Float64Array(channels);
    idwEstimateInto(out, samples, lat, lng, power, channels, skipIndex);
    const ref = referenceEstimate(samples, lat, lng, power, channels, skipIndex);

    for (let ch = 0; ch < channels; ch++) {
      assert(
        approxEqual(out[ch], ref[ch]),
        `refactor parity mismatch (trial ${trial}, ch ${ch}): got ${out[ch]}, expected ${ref[ch]}`
      );
      checks++;
    }
  }

  // ── 2. Constant field → MAE = RMSE = 0 exactly. ─────────────────────
  const constantSamples = [
    { id: 'a', lat: 14.0, lng: 121.0, severity: 10, diseaseSeverity: { leaf_blast: 10 } },
    { id: 'b', lat: 14.001, lng: 121.0, severity: 10, diseaseSeverity: { leaf_blast: 10 } },
    { id: 'c', lat: 14.0, lng: 121.001, severity: 10, diseaseSeverity: { leaf_blast: 10 } },
    { id: 'd', lat: 14.001, lng: 121.001, severity: 10, diseaseSeverity: { leaf_blast: 10 } },
  ];
  const constResult = runLOOCValidation(constantSamples, 2, { channelKeys: ['leaf_blast'] });
  assert(constResult.mae === 0, `constant field MAE should be exactly 0, got ${constResult.mae}`);
  assert(constResult.rmse === 0, `constant field RMSE should be exactly 0, got ${constResult.rmse}`);
  assert(constResult.channels.leaf_blast.degenerate === true, 'constant field channel should flag degenerate');
  checks += 3;

  // ── 3. Hand-computable 3-point case. Held out point B is predicted from
  //    A and C only; with p=2 and these coordinates the weights and
  //    resulting value can be checked by hand. ────────────────────────
  const handSamples = [
    { id: 'A', lat: 0, lng: 0, severity: 0, diseaseSeverity: { x: 0 } },
    { id: 'B', lat: 0, lng: 1, severity: 0, diseaseSeverity: { x: 100 } },
    { id: 'C', lat: 0, lng: 2, severity: 0, diseaseSeverity: { x: 0 } },
  ];
  // Predicting B (lng=1) from A (lng=0, val=0) and C (lng=2, val=0):
  // dist(A,B) = dist(C,B) = 1, so w_A = w_C = 1, predicted = (0+0)/2 = 0.
  const handResult = runLOOCValidation(handSamples, 2, { channelKeys: ['x'] });
  const bResidual = handResult.residuals.find((r) => r.plantId === 'B');
  assert(approxEqual(bResidual.predicted, 0), `hand-computed case: expected predicted=0, got ${bResidual.predicted}`);
  assert(approxEqual(bResidual.actual, 100), `hand-computed case: expected actual=100, got ${bResidual.actual}`);
  checks += 2;

  // ── 4. N < MIN_SAMPLES throws. ───────────────────────────────────────
  let threw = false;
  try {
    runLOOCValidation(handSamples.slice(0, 2), 2, { channelKeys: ['x'] });
  } catch (err) {
    threw = err instanceof LoocvInsufficientDataError;
  }
  assert(threw, 'N < MIN_SAMPLES should throw LoocvInsufficientDataError');
  checks += 1;

  console.log(`Self-test PASSED (${checks} assertions across 4 checks: refactor parity, constant field, hand-computed case, insufficient-data guard).`);
}

/** Deterministic PRNG so self-test failures are reproducible. */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selftest) {
    runSelfTest();
    return;
  }

  if (!args.file) {
    console.error('Usage: node scripts/loocv.js <path-to-json> [--powers=1,1.5,2,2.5,3]');
    console.error('       node scripts/loocv.js --selftest');
    process.exitCode = 1;
    return;
  }

  const samples = loadSamples(args.file);
  try {
    printResults(samples, args.powers);
  } catch (err) {
    if (err instanceof LoocvInsufficientDataError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

main();
