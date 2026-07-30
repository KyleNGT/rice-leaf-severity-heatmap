/**
 * ============================================================
 * IDW Web Worker — Off-Thread Interpolation Engine
 * ============================================================
 * Runs Inverse Distance Weighting in a background thread to prevent UI
 * freezes, for one or more channels (disease classes) in a single pass —
 * see idwInterpolation.js for why one pass beats one worker run per channel.
 *
 * Receives:
 *   { samples, boundaryCoords, cellSize, power, bbox, channels }
 *   samples: [{ lat, lng, values: number[] }]  — one value per channel,
 *            same order as `channels` (a count, not the channel keys
 *            themselves — idwInterpolation.js owns the key↔index mapping).
 *
 * Posts back:
 *   { grid, min, max, cols, rows, channels }
 *   grid is one Float32Array(rows * cols * channels), CHANNEL-MAJOR:
 *     idx(ch, r, c) = ch * rows * cols + r * cols + c
 *   so each channel is a contiguous subarray() on the main thread — still a
 *   single Transferable, still zero-copy. min/max are one array per channel.
 *
 * IDW Formula (per channel, same weights shared across all channels since
 * they depend only on distance, not on value):
 *   Z(x) = Σ(wᵢ · zᵢ) / Σ(wᵢ)
 *   where wᵢ = 1 / d(x, xᵢ)^p
 *
 * -1 remains the sentinel for "outside the boundary", written into every
 * channel of a cell together — see HeatmapOverlay.jsx's `value < 0` guard,
 * which is unchanged by this file's move to multiple channels.
 */

/* eslint-disable no-restricted-globals */

self.onmessage = function (e) {
  const { samples, boundaryCoords, cellSize, power, bbox, channels } = e.data;

  const [minLng, minLat, maxLng, maxLat] = bbox;

  // Approximate degrees per meter at this latitude
  const latCenter = (minLat + maxLat) / 2;
  const degPerMeterLat = 1 / 111320;
  const degPerMeterLng = 1 / (111320 * Math.cos((latCenter * Math.PI) / 180));

  const stepLat = cellSize * degPerMeterLat;
  const stepLng = cellSize * degPerMeterLng;

  const cols = Math.ceil((maxLng - minLng) / stepLng);
  const rows = Math.ceil((maxLat - minLat) / stepLat);

  // Pre-compute the boundary ring for ray-casting PIP test
  const ring = boundaryCoords;

  const cellCount = rows * cols;
  const grid = new Float32Array(cellCount * channels);
  const gridMin = new Array(channels).fill(Infinity);
  const gridMax = new Array(channels).fill(-Infinity);
  let computedCells = 0;

  // Scratch buffers reused across cells to avoid a per-cell allocation.
  const numerators = new Float64Array(channels);

  for (let r = 0; r < rows; r++) {
    const lat = maxLat - r * stepLat - stepLat / 2;

    for (let c = 0; c < cols; c++) {
      const lng = minLng + c * stepLng + stepLng / 2;
      const cellIdx = r * cols + c;

      // Point-in-polygon (ray casting)
      if (!pointInPolygon(lng, lat, ring)) {
        for (let ch = 0; ch < channels; ch++) {
          grid[ch * cellCount + cellIdx] = -1; // Outside boundary
        }
        continue;
      }

      // IDW interpolation — weights are per-sample (distance-only), shared
      // across every channel; only the numerators differ.
      numerators.fill(0);
      let denominator = 0;
      let exactMatchIdx = -1;

      for (let i = 0; i < samples.length; i++) {
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
          numerators[ch] += w * values[ch];
        }
      }

      for (let ch = 0; ch < channels; ch++) {
        const value =
          exactMatchIdx >= 0
            ? samples[exactMatchIdx].values[ch]
            : denominator > 0
              ? numerators[ch] / denominator
              : 0;

        const idx = ch * cellCount + cellIdx;
        grid[idx] = value;

        if (value < gridMin[ch]) gridMin[ch] = value;
        if (value > gridMax[ch]) gridMax[ch] = value;
      }

      computedCells++;
    }

    // Progress reporting every 10 rows
    if (r % 10 === 0) {
      self.postMessage({
        type: 'progress',
        progress: Math.round((r / rows) * 100),
      });
    }
  }

  self.postMessage(
    {
      type: 'result',
      grid: grid.buffer,
      min: gridMin,
      max: gridMax,
      cols,
      rows,
      channels,
      computedCells,
    },
    [grid.buffer] // Transfer ownership for zero-copy
  );
};

/**
 * Ray-casting point-in-polygon test.
 * Works with a single ring (no holes).
 */
function pointInPolygon(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}
