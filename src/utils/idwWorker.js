/**
 * ============================================================
 * IDW Web Worker — Off-Thread Interpolation Engine
 * ============================================================
 * Runs the Inverse Distance Weighting computation in a
 * background thread to prevent UI freezes.
 *
 * Receives:
 *   { samples, boundaryCoords, cellSize, power, bbox }
 *
 * Posts back:
 *   { grid, min, max, cols, rows }
 *
 * IDW Formula:
 *   Z(x) = Σ(wᵢ · zᵢ) / Σ(wᵢ)
 *   where wᵢ = 1 / d(x, xᵢ)^p
 */

/* eslint-disable no-restricted-globals */

self.onmessage = function (e) {
  const { samples, boundaryCoords, cellSize, power, bbox } = e.data;

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

  const grid = new Float32Array(rows * cols);
  let gridMin = Infinity;
  let gridMax = -Infinity;
  let computedCells = 0;

  for (let r = 0; r < rows; r++) {
    const lat = maxLat - r * stepLat - stepLat / 2;

    for (let c = 0; c < cols; c++) {
      const lng = minLng + c * stepLng + stepLng / 2;
      const idx = r * cols + c;

      // Point-in-polygon (ray casting)
      if (!pointInPolygon(lng, lat, ring)) {
        grid[idx] = -1; // Outside boundary
        continue;
      }

      // IDW interpolation
      let numerator = 0;
      let denominator = 0;
      let exactMatch = false;

      for (let i = 0; i < samples.length; i++) {
        const dx = lng - samples[i].lng;
        const dy = lat - samples[i].lat;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 1e-10) {
          // Exact match — use this sample's value directly
          grid[idx] = samples[i].severity;
          exactMatch = true;
          break;
        }

        const w = 1 / Math.pow(dist, power);
        numerator += w * samples[i].severity;
        denominator += w;
      }

      if (!exactMatch) {
        grid[idx] = denominator > 0 ? numerator / denominator : 0;
      }

      if (grid[idx] >= 0) {
        if (grid[idx] < gridMin) gridMin = grid[idx];
        if (grid[idx] > gridMax) gridMax = grid[idx];
        computedCells++;
      }
    }

    // Progress reporting every 10 rows
    if (r % 10 === 0) {
      self.postMessage({
        type: 'progress',
        progress: Math.round((r / rows) * 100),
      });
    }
  }

  self.postMessage({
    type: 'result',
    grid: grid.buffer,
    min: gridMin,
    max: gridMax,
    cols,
    rows,
    computedCells,
  }, [grid.buffer]); // Transfer ownership for zero-copy
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
