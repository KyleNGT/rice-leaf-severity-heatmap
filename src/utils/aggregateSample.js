/**
 * ============================================================
 * Plant-Level Aggregation — Pooled PDLA
 * ============================================================
 * A sample node is one rice plant, photographed several times: a rice leaf
 * is long and thin and often needs more than one frame, and field practice
 * samples several leaves per plant. This module reduces those per-photo
 * inference results to the single severity the IDW grid interpolates.
 *
 * The severity is POOLED, not averaged:
 *
 *     PDLA_plant = 100 × Σ disease_pixels / Σ leaf_pixels
 *
 * which is the same number the pipeline would report for one composite image
 * of all the tissue photographed at that plant. Three reasons it is not a
 * mean of the per-photo percentages:
 *
 *   1. PDLA is a ratio of two counts. A mean of ratios is not the ratio of
 *      sums — a tight close-up of one lesion (4k leaf px, 50%) would weigh
 *      exactly as much as a wide shot of near-clean tissue (200k leaf px,
 *      1%). Pooling weights each photo by the leaf area it actually captured.
 *   2. `severity` is censored. backend/inference.py forces it to 0 whenever
 *      disease_fraction < minimum_disease_fraction, so averaging it
 *      under-reports a plant whose leaves are each lightly affected. We pool
 *      the raw counts and apply that gate once, at plant level.
 *   3. `diseaseName` is categorical and cannot be averaged at all; the
 *      pooled winner is the disease class holding the most leaf pixels
 *      across the plant.
 *
 * Every photo, camera or gallery, is now forced through a fixed alignment
 * crop before it ever reaches analysis (ImageAlignmentModal → cropToStencil.js)
 * — see ALIGN_OUTPUT_WIDTH/HEIGHT in constants.js. That normalizes framing
 * distance, which used to be the dominant source of
 * per-photo scale variance: every photo now shares one output resolution,
 * and that resolution sits under backend/inference.py's DEFAULT_MAX_SIDE, so
 * `_downscale` is a no-op for all of them — a close-up and a wide shot no
 * longer differ 4× in effective scale before a single pixel is counted.
 *
 * Caveat still worth carrying into the writeup, narrower than before: the
 * weights are now framing-consistent, not biologically calibrated. There is
 * no scale reference in frame (no ruler, no known-size marker), so the
 * mapping from pixels to mm² is unknown — it's consistent across photos, not
 * calibrated to a physical unit. The remaining assumption is that rice leaf
 * blade width is roughly constant within a variety (the stencil fixes
 * on-screen width, not measured width) and that the farmer aligned the leaf
 * to the stencil by eye; alignment error is unquantified.
 *
 * Per-disease severities (`diseaseSeverity`, added for the IRRI SES heatmap —
 * see sesScale.js/sesGrid.js) apply the SAME censoring gate independently to
 * each disease's own fraction, `classPixels[label] / leafPixels`, rather than
 * once to their sum. This is deliberate, not an oversight: with per-pixel
 * argmax, almost every leaf leaks a handful of stray pixels into every class,
 * so an ungated per-disease value would read as a nonzero PDLA — and
 * therefore SES 1 — on nearly every plant for nearly every disease it does
 * NOT have. Gating each disease the way the pooled total is already gated
 * keeps a healthy plant reading SES 0 on all three layers.
 *
 * One consequence worth carrying into the write-up: because each disease is
 * censored on its OWN fraction, `Σ diseaseSeverity` can be strictly less than
 * the pooled `severity` above — a disease sitting just under the gate
 * contributes to the pooled total (which is gated once, on the sum) but
 * reads 0 on its own layer.
 *
 * Pure module — no React, no DOM. Runnable directly under `node`.
 */

// Explicit .js extension (unlike the rest of the app, which relies on Vite's
// resolver) so this module can be imported by a bare `node` script — the
// pooling arithmetic is the part most worth checking against fixtures, and
// this prototype has no test runner to host it.
import {
  MIN_LEAF_FRAME_FRACTION,
  MAX_LEAF_FRAME_FRACTION,
  MIN_LEAF_MASK_CONFIDENCE,
} from '../constants/constants.js';

/** Fallback if a response predates the backend sending its own gate value. */
const FALLBACK_MIN_DISEASE_FRACTION = 0.001;

/**
 * Why a photo's leaf mask looks implausible, or '' if it looks fine.
 *
 * Phase 1 has no negative class, so this is a plausibility check, not leaf
 * detection — see the threshold commentary in constants.js.
 *
 * @param {object|null} result — a raw /api/analyze response.
 * @returns {string} user-facing reason, or '' when nothing looks wrong.
 */
export function leafQualityWarning(result) {
  if (!result || result.status !== 'ok') return '';

  const d = result.diagnostics;
  if (!d) return '';

  const frame = d.leaf_frame_fraction;
  const conf = d.leaf_mask_confidence;

  if (typeof frame === 'number') {
    if (frame < MIN_LEAF_FRAME_FRACTION) {
      return `The leaf fills only ${(frame * 100).toFixed(1)}% of this photo. Move closer and retake.`;
    }
    // A real handheld leaf photo always keeps some background. An
    // edge-to-edge mask means isolation found nothing to isolate.
    if (frame > MAX_LEAF_FRAME_FRACTION) {
      return 'No background was found around the leaf, so this may not be a single rice leaf. Retake with the leaf against the ground or your hand.';
    }
  }

  if (typeof conf === 'number' && conf < MIN_LEAF_MASK_CONFIDENCE) {
    return 'The model was unsure this is a rice leaf. Retake in better light.';
  }

  return '';
}

/**
 * Does this draft image count toward the plant's severity?
 *
 * Excluded photos contribute nothing to EITHER side of the ratio, so they
 * cannot fabricate a severity — which is what keeps the "a failed analysis
 * must never reach the IDW grid" invariant true while still letting a plant
 * be saved when one of its photos failed.
 */
export function isUsableImage(image) {
  if (!image || image.analyzing || image.error) return false;
  if (!image.result || image.result.status !== 'ok') return false;
  if (!image.result.diagnostics) return false;
  // Flagged photos are excluded unless the user explicitly kept them.
  if (leafQualityWarning(image.result) && !image.dismissedWarning) return false;
  return true;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Reduce a draft's images to the plant-level result.
 *
 * @param {Array<{analyzing: boolean, error: string, result: object|null,
 *                dismissedWarning: boolean}>} images
 * @returns {{
 *   severity: number|null, diseaseDetected: boolean,
 *   diseaseName: string|null, diseaseLabel: string|null,
 *   leafPixels: number, diseasePixels: number, classPixels: object,
 *   diseaseSeverity: object, diseaseLabels: string[], diseaseDisplayNames: object,
 *   totalCount: number, usableCount: number, failedCount: number,
 *   flaggedCount: number, analyzingCount: number,
 *   confidenceRange: [number, number]|null,
 *   pdlaSpread: {min: number, max: number, sd: number}|null,
 * }}
 */
export function summarizePlant(images = []) {
  const usable = images.filter(isUsableImage);

  const summary = {
    severity: null,
    diseaseDetected: false,
    diseaseName: null,
    diseaseLabel: null,
    leafPixels: 0,
    diseasePixels: 0,
    classPixels: {},
    // Per-disease PDLA %, gated independently — see the docblock above.
    // Keyed by every label in diseaseLabels, so a disease this plant doesn't
    // have still reads an explicit 0 rather than being absent.
    diseaseSeverity: {},
    diseaseLabels: [],
    diseaseDisplayNames: {},
    totalCount: images.length,
    usableCount: usable.length,
    analyzingCount: images.filter((im) => im?.analyzing).length,
    failedCount: images.filter(
      (im) => im && !im.analyzing && (im.error || im.result?.status !== 'ok')
    ).length,
    flaggedCount: images.filter(
      (im) => im && !im.analyzing && !im.error && leafQualityWarning(im.result)
    ).length,
    confidenceRange: null,
    pdlaSpread: null,
  };

  if (usable.length === 0) return summary;

  // ── Pool the raw pixel counts ──
  const classPixels = {};
  let leafPixels = 0;
  let diseasePixels = 0;
  const perPhotoPdla = [];
  const confidences = [];

  for (const image of usable) {
    const d = image.result.diagnostics;
    leafPixels += d.leaf_pixels ?? 0;
    diseasePixels += d.disease_pixels ?? 0;

    for (const [label, count] of Object.entries(d.class_pixels ?? {})) {
      classPixels[label] = (classPixels[label] ?? 0) + count;
    }

    // The uncensored per-photo value, for the within-plant spread.
    if (typeof d.pdla_percent_raw === 'number') perPhotoPdla.push(d.pdla_percent_raw);

    const conf = parseFloat(image.result.confidence);
    if (Number.isFinite(conf)) confidences.push(conf);
  }

  summary.leafPixels = leafPixels;
  summary.diseasePixels = diseasePixels;
  summary.classPixels = classPixels;

  if (confidences.length > 0) {
    summary.confidenceRange = [Math.min(...confidences), Math.max(...confidences)];
  }

  if (perPhotoPdla.length > 0) {
    summary.pdlaSpread = {
      min: Math.min(...perPhotoPdla),
      max: Math.max(...perPhotoPdla),
      sd: standardDeviation(perPhotoPdla),
    };
  }

  // Every usable photo somehow reported zero leaf area — no measurement was
  // made, so severity stays null. Emitting 0 here would plant a false
  // "healthy" node over what may be a real hotspot.
  if (leafPixels === 0) return summary;

  // ── Apply the disease gate ONCE, at plant level ──
  // Sourced from the response rather than hardcoded so it stays tied to
  // segfomer_model/deployment_metadata.json and can't drift.
  const diagnostics = usable[0].result.diagnostics;
  const diseaseLabels = diagnostics.disease_labels ?? [];
  const displayNames = diagnostics.disease_display_names ?? {};
  summary.diseaseLabels = diseaseLabels;
  summary.diseaseDisplayNames = displayNames;

  const threshold = diagnostics.minimum_disease_fraction ?? FALLBACK_MIN_DISEASE_FRACTION;

  const fraction = diseasePixels / leafPixels;
  const detected = fraction >= threshold;

  summary.diseaseDetected = detected;
  summary.severity = detected
    ? Math.round(Math.min(100, Math.max(0, 100 * fraction)) * 100) / 100
    : 0;

  // ── Per-disease severities, gated independently ──
  // As noted in the docblock, every individual disease fraction is <= the
  // pooled fraction (classPixels sums to diseasePixels), so when the pooled
  // gate above fails to clear, every per-disease gate below fails too —
  // this loop naturally yields all-zeros for a plant read as Healthy.
  const diseaseSeverity = {};
  for (const label of diseaseLabels) {
    const labelFraction = (classPixels[label] ?? 0) / leafPixels;
    diseaseSeverity[label] =
      labelFraction >= threshold
        ? Math.round(Math.min(100, Math.max(0, 100 * labelFraction)) * 100) / 100
        : 0;
  }
  summary.diseaseSeverity = diseaseSeverity;

  if (!detected) {
    summary.diseaseName = 'Healthy';
    summary.diseaseLabel = 'healthy_leaf';
    return summary;
  }

  // ── Pooled winner: the disease class holding the most leaf pixels ──
  // Label list comes from the response so a re-trained Phase 2 with
  // different classes needs no change here.
  let winner = null;
  for (const label of diseaseLabels) {
    if (winner === null || (classPixels[label] ?? 0) > (classPixels[winner] ?? 0)) {
      winner = label;
    }
  }

  // The backend breaks an exact pixel tie on mean posterior; we break it on
  // disease_labels order. Only observable when two classes hold precisely
  // the same pixel count, which the display rounding hides anyway.
  summary.diseaseLabel = winner;
  summary.diseaseName = winner ? (displayNames[winner] ?? winner) : null;

  return summary;
}
