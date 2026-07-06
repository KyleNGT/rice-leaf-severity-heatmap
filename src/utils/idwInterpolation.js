/**
 * ============================================================
 * IDW Interpolation — Main Thread Interface
 * ============================================================
 * Orchestrates the Web Worker and provides a Promise-based API.
 *
 * Usage:
 *   const { grid, cols, rows, min, max } =
 *     await computeIDW(samples, boundary, onProgress);
 */

import * as turf from '@turf/turf';
import { IDW_POWER, IDW_CELL_SIZE_METERS, IDW_MAX_CELLS } from '../constants/constants';

/**
 * Compute IDW interpolation over a field boundary.
 *
 * @param {Array<{ lat: number, lng: number, severity: number }>} samples
 * @param {GeoJSON.Feature<GeoJSON.Polygon>} boundary
 * @param {(progress: number) => void} [onProgress]
 * @returns {Promise<{ grid: Float32Array, cols: number, rows: number, min: number, max: number, bbox: number[] }>}
 */
export function computeIDW(samples, boundary, onProgress) {
  return new Promise((resolve, reject) => {
    // Compute bounding box of the boundary polygon
    const bbox = turf.bbox(boundary); // [minLng, minLat, maxLng, maxLat]

    // Adaptive cell size: coarsen if the field is large
    let cellSize = IDW_CELL_SIZE_METERS;

    // Estimate grid dimensions
    const latCenter = (bbox[1] + bbox[3]) / 2;
    const degPerMeterLat = 1 / 111320;
    const degPerMeterLng = 1 / (111320 * Math.cos((latCenter * Math.PI) / 180));

    let estCols = Math.ceil((bbox[2] - bbox[0]) / (cellSize * degPerMeterLng));
    let estRows = Math.ceil((bbox[3] - bbox[1]) / (cellSize * degPerMeterLat));

    // Coarsen if exceeding max cells
    while (estCols * estRows > IDW_MAX_CELLS && cellSize < 20) {
      cellSize += 1;
      estCols = Math.ceil((bbox[2] - bbox[0]) / (cellSize * degPerMeterLng));
      estRows = Math.ceil((bbox[3] - bbox[1]) / (cellSize * degPerMeterLat));
    }

    // Extract the outer ring coordinates [lng, lat]
    const boundaryCoords = boundary.geometry.coordinates[0];

    // Spawn Web Worker
    const worker = new Worker(
      new URL('./idwWorker.js', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        onProgress?.(e.data.progress);
      } else if (e.data.type === 'result') {
        const grid = new Float32Array(e.data.grid);
        resolve({
          grid,
          cols: e.data.cols,
          rows: e.data.rows,
          min: e.data.min,
          max: e.data.max,
          bbox,
          computedCells: e.data.computedCells,
        });
        worker.terminate();
      }
    };

    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };

    worker.postMessage({
      samples: samples.map((s) => ({
        lat: s.lat,
        lng: s.lng,
        severity: s.severity,
      })),
      boundaryCoords,
      cellSize,
      power: IDW_POWER,
      bbox,
    });
  });
}

/**
 * Generate a color from the severity color scale.
 * Linearly interpolates between color stops.
 *
 * @param {number} value — Severity percentage (0–100)
 * @returns {string} — CSS rgba color string
 */
export function severityToColor(value) {
  const t = Math.max(0, Math.min(100, value)) / 100;

  // Color stops: green → lime → yellow → orange → red
  const stops = [
    { pos: 0.0, r: 34, g: 197, b: 94 },   // #22c55e
    { pos: 0.25, r: 132, g: 204, b: 22 },  // #84cc16
    { pos: 0.5, r: 234, g: 179, b: 8 },    // #eab308
    { pos: 0.75, r: 249, g: 115, b: 22 },  // #f97316
    { pos: 1.0, r: 239, g: 68, b: 68 },    // #ef4444
  ];

  // Find the two stops we're between
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].pos && t <= stops[i + 1].pos) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  // Interpolate
  const range = upper.pos - lower.pos || 1;
  const f = (t - lower.pos) / range;

  const r = Math.round(lower.r + f * (upper.r - lower.r));
  const g = Math.round(lower.g + f * (upper.g - lower.g));
  const b = Math.round(lower.b + f * (upper.b - lower.b));

  return `rgb(${r}, ${g}, ${b})`;
}
