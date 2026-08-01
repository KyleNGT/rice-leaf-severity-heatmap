/**
 * ============================================================
 * ML Service — Disease Severity Estimation
 * ============================================================
 * Calls the real 2-stage SegFormer inference API (backend/server.py)
 * and returns its structured JSON response.
 *
 * Kept in this file (rather than renamed) so the only call site,
 * App.jsx's `import { analyzePlantImage } from './services/mockMLService'`,
 * doesn't need to change. Response shape is unchanged from the mock
 * this replaced: { diseaseDetected, severity, diseaseName, confidence }.
 * `severity` is now a real float PDLA percentage rather than a random
 * integer — display sites round it with .toFixed(1).
 */

import { ANALYZE_ENDPOINT, ANALYZE_TIMEOUT_MS, HEALTH_ENDPOINT } from '../constants/constants';

/** Short timeout for the health probe — it exists to fail fast, not to wait
 * out a real inference. A generous value would defeat the point of calling
 * it before the farmer ever takes a photo. */
const HEALTH_TIMEOUT_MS = 8000;

/**
 * Tail of the request queue. `analyzePlantImage` chains onto this so only
 * one request is in flight at a time.
 *
 * This is not throttling for its own sake. The backend holds a single lock
 * around every forward pass (TwoStagePipeline._lock), so N concurrent
 * uploads are executed strictly sequentially there anyway — but
 * AbortSignal.timeout starts counting the moment fetch() is called, not
 * when the server begins work. Firing a plant's eight photos at once means
 * the last one burns seven inference-durations of its 30s budget sitting in
 * the server's queue, and dies of a timeout that looks like a network fault.
 * Queueing client-side makes each photo's clock start on its own turn.
 */
let queueTail = Promise.resolve();

/**
 * Send a plant photo to the inference API for disease analysis. Calls are
 * queued (see `queueTail`) — a plant's photos are analyzed one at a time.
 *
 * `diagnostics` carries the per-pixel counts that plant-level pooling needs;
 * see src/utils/aggregateSample.js. Aggregate from those counts, never from
 * `severity`, which the backend censors to 0 below its disease-fraction gate.
 *
 * @param {File} imageFile — The captured/uploaded image.
 * @returns {Promise<{
 *   diseaseDetected: boolean,
 *   severity: number,
 *   diseaseName: string,
 *   confidence: string,
 *   status?: string,
 *   diagnostics?: object,
 *   masks?: {
 *     leaf: string,
 *     disease: string,
 *     size_wh: [number, number],
 *     source_size_wh: [number, number],
 *     class_order: string[],
 *     palette: object,
 *     class_names: object,
 *     leaf_color: string,
 *   } | null,
 * }>}
 * @throws {Error} if the request fails, times out, or the server
 *   returns a non-OK status. Callers (App.jsx) must catch this and
 *   surface it — a swallowed failure must never let a null/undefined
 *   severity reach the IDW grid.
 */
export function analyzePlantImage(imageFile) {
  // Chain onto the tail regardless of how the previous call settled, so one
  // failed photo can't wedge the queue for the rest of the plant.
  const result = queueTail.then(
    () => sendForAnalysis(imageFile),
    () => sendForAnalysis(imageFile)
  );
  queueTail = result.catch(() => {});
  return result;
}

async function sendForAnalysis(imageFile) {
  const body = new FormData();
  body.append('image', imageFile);

  let res;
  try {
    res = await fetch(ANALYZE_ENDPOINT, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error('Analysis timed out. Check your connection and try again.');
    }
    throw new Error('Could not reach the analysis server.');
  }

  if (!res.ok) {
    // 502/503/504 come from the Vite dev proxy itself (see vite.config.js)
    // when it can't reach the backend at all — e.g. it isn't running, or
    // crashed on startup. That's a distinct, actionable situation from an
    // inference error the backend returns deliberately (which carries a
    // JSON `detail` and is handled below), so it gets its own message
    // instead of a bare status code.
    if ([502, 503, 504].includes(res.status)) {
      // import.meta.env.DEV is a Vite build-time constant, so this branch
      // compiles away entirely in a production bundle — a deployed build
      // never ships the dev-only instruction below.
      throw new Error(
        import.meta.env.DEV
          ? 'Cannot reach the analysis server. Make sure the backend is running (npm run dev:api).'
          : 'The analysis server is unavailable. Please try again in a moment.'
      );
    }

    let detail = '';
    try {
      detail = (await res.json())?.detail ?? '';
    } catch {
      // Body wasn't JSON — ignore, fall back to the status text below.
    }
    throw new Error(detail || `Analysis failed (${res.status})`);
  }

  return res.json();
}

/**
 * Probe GET /api/health before the farmer takes a single photo — lets the
 * Sampling step show "backend unreachable" up front instead of only
 * discovering it after a photo burns the full ANALYZE_TIMEOUT_MS. Also
 * doubles as a wake-up call to a scale-to-zero host, which is what keeps
 * the first real analyze() call inside its own timeout budget.
 *
 * Deliberately outside the analyze queue (`queueTail`) — a health probe
 * has nothing to do with photo ordering and must never wait behind one.
 *
 * @returns {Promise<boolean>} true if the backend answered healthy.
 */
export async function checkBackendHealth() {
  try {
    const res = await fetch(HEALTH_ENDPOINT, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
