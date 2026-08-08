/**
 * ============================================================
 * IDW Core — Shared Single-Point Estimator
 * ============================================================
 * The per-cell IDW body extracted verbatim from idwWorker.js, so the
 * heatmap grid and the LOOCV validator (loocv.js) are provably running the
 * SAME estimator — no parallel re-implementation to drift out of sync with
 * the worker's actual math. This module is pure (no `self`, no DOM) and
 * runnable under Node, same discipline as sesScale.js.
 *
 * IDW Formula:
 *   Z(x) = Σ(wᵢ · zᵢ) / Σ(wᵢ)
 *   where wᵢ = 1 / d(x, xᵢ)^p
 *
 * Distance is raw Euclidean in DEGREE space (no cos(lat) anisotropy
 * correction inside the metric — that correction is applied only to grid
 * spacing, in idwWorker.js/idwInterpolation.js). This under-weights E-W
 * separations relative to true ground distance by ~1/cos(lat). It is a
 * deliberate property of the shipped model, not a bug this module should
 * fix — LOOCV must validate the model AS IMPLEMENTED. See CLAUDE.md's LOOCV
 * Validation section.
 */

/**
 * Estimate one point's value on every channel via Inverse Distance
 * Weighting over `samples`, writing results into caller-owned `out` (no
 * per-call allocation — this runs once per grid cell, tens of thousands of
 * times per heatmap, and once per LOOCV fold × sample).
 *
 * @param {Float64Array} out — length `channels` scratch, written in place.
 * @param {Array<{ lat: number, lng: number, values: number[] }>} samples
 * @param {number} lat — target point latitude (degrees).
 * @param {number} lng — target point longitude (degrees).
 * @param {number} power — IDW power parameter p.
 * @param {number} channels — number of channels (values[] length per sample).
 * @param {number} [skipIndex=-1] — index into `samples` to exclude, i.e. the
 *   held-out point for a LOOCV fold. -1 (default) uses every sample, which
 *   reproduces the heatmap's own behavior exactly.
 */
export function idwEstimateInto(out, samples, lat, lng, power, channels, skipIndex = -1) {
  out.fill(0);
  let denominator = 0;
  let exactMatchIdx = -1;

  for (let i = 0; i < samples.length; i++) {
    if (i === skipIndex) continue;

    const dx = lng - samples[i].lng;
    const dy = lat - samples[i].lat;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1e-10) {
      // Exact match — use this sample's values directly, for every channel.
      exactMatchIdx = i;
      break;
    }

    const w = 1 / Math.pow(dist, power);
    denominator += w;
    const values = samples[i].values;
    for (let ch = 0; ch < channels; ch++) {
      out[ch] += w * values[ch];
    }
  }

  if (exactMatchIdx >= 0) {
    const values = samples[exactMatchIdx].values;
    for (let ch = 0; ch < channels; ch++) {
      out[ch] = values[ch];
    }
  } else if (denominator > 0) {
    for (let ch = 0; ch < channels; ch++) {
      out[ch] /= denominator;
    }
  }
  // else: out stays all-zero (the fallback of 0 is only reachable with zero
  // usable samples, same as the worker's `denominator > 0 ? ... : 0`).
}
