/**
 * ============================================================
 * IDW Interpolation — Main Thread Interface
 * ============================================================
 * Orchestrates the Web Worker and provides a Promise-based API.
 *
 * Interpolates one Float32Array grid PER DISEASE CHANNEL, in a single
 * worker pass (see idwWorker.js's channel-major output format) — the
 * point-in-polygon test is the expensive part of each cell and is identical
 * across channels, so running the worker once per disease would triple that
 * cost for nothing. `severityToColor` used to live here; SES coloring now
 * lives in sesScale.js, since color is a function of banded SES, not raw
 * PDLA — see sesGrid.js for how a channel's grid gets there.
 *
 * Usage:
 *   const { layers, cols, rows, bbox } =
 *     await computeIDW(samples, boundary, channelKeys, onProgress);
 *   // layers[channelKeys[i]] === { grid: Float32Array, min, max }
 */

import * as turf from '@turf/turf';
import { IDW_POWER, IDW_CELL_SIZE_METERS, IDW_MAX_CELLS } from '../constants/constants';

/**
 * Compute IDW interpolation over a field boundary, one channel per disease.
 *
 * @param {Array<{ lat: number, lng: number, diseaseSeverity: object }>} samples
 * @param {GeoJSON.Feature<GeoJSON.Polygon>} boundary
 * @param {string[]} channelKeys — ordered disease labels; a sample with no
 *   reading for a key contributes a real 0 (a measured absence, not missing
 *   data) via `sample.diseaseSeverity[key] ?? 0`.
 * @param {(progress: number) => void} [onProgress]
 * @returns {Promise<{
 *   layers: Record<string, { grid: Float32Array, min: number, max: number }>,
 *   cols: number, rows: number, bbox: number[], computedCells: number,
 * }>}
 */
export function computeIDW(samples, boundary, channelKeys, onProgress) {
  return new Promise((resolve, reject) => {
    if (!channelKeys || channelKeys.length === 0) {
      reject(new Error('computeIDW requires at least one channel key.'));
      return;
    }

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
    const channels = channelKeys.length;

    // Spawn Web Worker
    const worker = new Worker(
      new URL('./idwWorker.js', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        onProgress?.(e.data.progress);
      } else if (e.data.type === 'result') {
        const { cols, rows, min, max, computedCells } = e.data;
        const flat = new Float32Array(e.data.grid);
        const cellCount = cols * rows;

        const layers = {};
        channelKeys.forEach((key, ch) => {
          layers[key] = {
            grid: flat.subarray(ch * cellCount, (ch + 1) * cellCount),
            min: min[ch],
            max: max[ch],
          };
        });

        resolve({ layers, cols, rows, bbox, computedCells, cellSize });
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
        values: channelKeys.map((key) => s.diseaseSeverity?.[key] ?? 0),
      })),
      boundaryCoords,
      cellSize,
      power: IDW_POWER,
      bbox,
      channels,
    });
  });
}
