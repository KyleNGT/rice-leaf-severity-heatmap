/**
 * ============================================================
 * Plant-Level Aggregation — Per-Photo Dominant-Disease Attribution
 * ============================================================
 * A sample node is one rice plant, photographed several times: a rice leaf
 * is long and thin and often needs more than one frame, and field practice
 * samples several leaves per plant. This module reduces those per-photo
 * inference results to the plant-level result the IDW grid interpolates.
 *
 * A rice hill has multiple tillers and leaves — it is biologically normal
 * for one part to carry Leaf Blast while another carries Brown Spot at the
 * same node. Each photo already receives ONE diagnosis from the backend
 * (`diseaseLabel`, its dominant class by pixel count, already gated on that
 * photo's own disease_fraction — see backend/inference.py). This module
 * takes that diagnosis at face value: a photo's WHOLE PDLA — every disease
 * pixel it has, not just its winning class's — is attributed entirely to
 * its one dominant disease. Photos are then grouped by diagnosis and pooled:
 *
 *     diseaseSeverity[label] = 100 × Σ disease_pixels (photos diagnosed `label`)
 *                                    ─────────────────────────────────────────
 *                                    Σ leaf_pixels (EVERY usable photo)
 *
 * The denominator is the plant's WHOLE leaf area, not just that disease's own
 * photos — so a per-disease value answers "how much of this plant is Brown
 * Spot", not "how bad is the Brown Spot where we found it". A photo diagnosed
 * Healthy contributes its leaf area to every denominator but zero to any
 * numerator. Consequence: since every photo's whole PDLA lands in exactly one
 * disease's numerator over one shared denominator, the per-disease values sum
 * EXACTLY to the pooled plant `severity` (barring independent 2dp rounding of
 * each). This replaces the old model, which pooled raw per-CLASS pixel counts
 * across every photo regardless of that photo's own diagnosis — a leaf_blast
 * photo's stray brown_spot argmax pixels used to count toward brown_spot's
 * total even though the photo was never diagnosed with it, which both diluted
 * per-disease values against leaf area they had nothing to do with, and
 * required an independent per-disease censoring gate to suppress that
 * leakage. Neither problem exists once each photo's pixels stay bound to its
 * own single diagnosis, so there is no separate per-disease gate here — each
 * photo was already censored once, by the backend, before it ever reports a
 * non-null diagnosis.
 *
 * Combining is by POOLING PIXELS, not averaging percentages: a photo
 * capturing more leaf area carries proportionally more weight. A close-up
 * lesion (4k leaf px) does not weigh the same as a wide shot of the same
 * disease (200k leaf px) just because both are "one photo".
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
 * `diseaseFindings` is the labeled, multi-disease list the sampling screen
 * renders: every disease at least one photo was diagnosed with, each with
 * its own pooled PDLA % and the count of photos behind it, sorted descending
 * — so a plant is never forced down to a single winning disease name for
 * display. `photoDiagnosis`, below, is the same one-disease-per-photo idea
 * applied to a single photo in isolation, for the per-tile display: the
 * photo's whole PDLA, labeled with its one dominant diagnosis.
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

/**
 * One photo's single diagnosis — its WHOLE PDLA, labeled with its one
 * dominant disease, exactly as the backend already computed it. No
 * per-disease breakdown at photo scale: a photo is one diagnosis, same as
 * the original single-image contract. Multi-disease reporting happens at
 * plant level, by grouping photos like this one — see the module docblock.
 *
 * @param {object|null} result — a raw /api/analyze response.
 * @returns {{label: string, displayName: string, pdla: number}|null} — null
 *   for anything that isn't a successful, DETECTED leaf photo: a failed
 *   request, `status: 'no_leaf_detected'`, or a photo the backend itself
 *   gated as Healthy (`diseaseLabel: 'healthy_leaf'` / `null`).
 */
export function photoDiagnosis(result) {
  if (!result || result.status !== 'ok') return null;
  if (!result.diseaseDetected) return null;

  const label = result.diseaseLabel;
  if (!label || label === 'healthy_leaf') return null;

  const displayNames = result.diagnostics?.disease_display_names ?? {};
  return {
    label,
    displayName: displayNames[label] ?? result.diseaseName ?? label,
    pdla: result.severity,
  };
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
 *   diseaseFindings: Array<{label: string, displayName: string, pdla: number,
 *                           photoCount: number}>,
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
    // The DOMINANT disease — the highest-pooled diseaseFindings entry — kept
    // for display sites that need one headline label (history row title,
    // marker popup fallback). It is NOT the only disease the plant may have;
    // see diseaseFindings below for the full labeled breakdown.
    diseaseName: null,
    diseaseLabel: null,
    leafPixels: 0,
    // Pooled disease pixel count from DIAGNOSED photos only — see the module
    // docblock. A photo the backend gated as Healthy contributes its leaf
    // area to leafPixels above but nothing here.
    diseasePixels: 0,
    // Raw per-class pixel counts pooled across every usable photo,
    // regardless of that photo's own diagnosis. Provenance only (write-up) —
    // NOT what diseaseSeverity is computed from; see the module docblock.
    classPixels: {},
    // Per-disease PDLA %, one photo's whole PDLA per its one diagnosis,
    // pooled over the plant's WHOLE leaf area — see the module docblock.
    // Keyed by every label in diseaseLabels, so a disease this plant doesn't
    // have still reads an explicit 0 rather than being absent.
    diseaseSeverity: {},
    diseaseLabels: [],
    diseaseDisplayNames: {},
    // Every disease at least one photo was diagnosed with, each with its own
    // pooled PDLA % and the photo count behind it, sorted descending. Derived
    // from diseaseSeverity (same numbers), so the two can never disagree.
    diseaseFindings: [],
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

  // ── Pool leaf area, raw class pixels (provenance), spread, confidence ──
  // leafPixels is the SHARED denominator every disease's severity divides
  // by — see the module docblock for why the denominator is the plant's
  // whole leaf area, not just that disease's own photos.
  const classPixels = {};
  let leafPixels = 0;
  const perPhotoPdla = [];
  const confidences = [];

  for (const image of usable) {
    const d = image.result.diagnostics;
    leafPixels += d.leaf_pixels ?? 0;

    for (const [label, count] of Object.entries(d.class_pixels ?? {})) {
      classPixels[label] = (classPixels[label] ?? 0) + count;
    }

    // The uncensored per-photo value, for the within-plant spread.
    if (typeof d.pdla_percent_raw === 'number') perPhotoPdla.push(d.pdla_percent_raw);

    const conf = parseFloat(image.result.confidence);
    if (Number.isFinite(conf)) confidences.push(conf);
  }

  summary.leafPixels = leafPixels;
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

  // Sourced from the response rather than hardcoded so it stays tied to
  // segfomer_model/deployment_metadata.json and can't drift.
  const diagnostics = usable[0].result.diagnostics;
  const diseaseLabels = diagnostics.disease_labels ?? [];
  const displayNames = diagnostics.disease_display_names ?? {};
  summary.diseaseLabels = diseaseLabels;
  summary.diseaseDisplayNames = displayNames;

  // ── Group each photo's WHOLE disease-pixel count under its OWN single
  // diagnosis ── A photo only joins a group if the backend itself diagnosed
  // it with a real disease (already gated on that photo's own
  // disease_fraction); a photo the backend read as Healthy joins no group —
  // its leaf area still counted toward leafPixels above, but it contributes
  // zero disease pixels anywhere. No re-gating happens here; see the module
  // docblock for why a second, plant-level gate would be wrong.
  const groups = {};
  for (const image of usable) {
    const r = image.result;
    if (!r.diseaseDetected) continue;
    const label = r.diseaseLabel;
    if (!label || label === 'healthy_leaf' || !diseaseLabels.includes(label)) continue;

    if (!groups[label]) groups[label] = { diseasePixels: 0, photoCount: 0 };
    groups[label].diseasePixels += r.diagnostics.disease_pixels ?? 0;
    groups[label].photoCount += 1;
  }

  // ── Pool pixels within each group over the plant's WHOLE leaf area ──
  const diseaseSeverity = {};
  for (const label of diseaseLabels) {
    const g = groups[label];
    diseaseSeverity[label] = g
      ? Math.round(Math.min(100, Math.max(0, 100 * g.diseasePixels / leafPixels)) * 100) / 100
      : 0;
  }
  summary.diseaseSeverity = diseaseSeverity;

  // Plant total: every diagnosed photo's disease pixels, same shared
  // denominator — since every photo's whole PDLA lands in exactly one
  // group, this equals Σ diseaseSeverity (each independently rounded to
  // 2dp, so the two can differ in the 2nd decimal but agree at 1dp display).
  const pooledDiseasePixels = Object.values(groups).reduce((sum, g) => sum + g.diseasePixels, 0);
  summary.diseasePixels = pooledDiseasePixels;
  summary.diseaseDetected = pooledDiseasePixels > 0;
  summary.severity =
    Math.round(Math.min(100, Math.max(0, 100 * pooledDiseasePixels / leafPixels)) * 100) / 100;

  // ── Labeled multi-disease breakdown ──
  // Every disease at least one photo was diagnosed with, as its own row —
  // this is what lets a plant with a leaf-blast photo AND a brown-spot photo
  // show both, instead of collapsing to whichever holds more pixels.
  summary.diseaseFindings = diseaseLabels
    .filter((label) => diseaseSeverity[label] > 0)
    .map((label) => ({
      label,
      displayName: displayNames[label] ?? label,
      pdla: diseaseSeverity[label],
      photoCount: groups[label].photoCount,
    }))
    .sort((a, b) => b.pdla - a.pdla);

  if (summary.diseaseFindings.length === 0) {
    summary.diseaseName = 'Healthy';
    summary.diseaseLabel = 'healthy_leaf';
    return summary;
  }

  // ── Dominant label: the highest-pooled finding ──
  const winner = summary.diseaseFindings[0];
  summary.diseaseLabel = winner.label;
  summary.diseaseName = winner.displayName;

  return summary;
}
