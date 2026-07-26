/**
 * ============================================================
 * Rice Leaf Severity Heatmap — Application Constants
 * ============================================================
 * Centralized configuration for the spatial interpolation
 * prototype. Change values here to tune the entire app.
 */

// ── Sampling Limits ──────────────────────────────────────────
/** Max plant nodes (sample points) per field session. */
export const MAX_SAMPLES = 50;

/**
 * Max photos per plant. A node is one rice plant, and a rice leaf is long
 * and thin enough that a single leaf often needs several frames — plus field
 * practice samples several leaves per plant.
 *
 * Capped at 10 because analysis is serialized (see mockMLService.js), each
 * photo carries ANALYZE_TIMEOUT_MS, and a mid-range Android holds every
 * photo's blob in memory until the plant is committed.
 */
export const MAX_IMAGES_PER_SAMPLE = 10;

// ── Leaf Plausibility Guard ──────────────────────────────────
/**
 * Phase 1 is a binary leaf/background segmenter with **no negative class** —
 * it has no way to say "this is not a rice leaf". The API only reports
 * `no_leaf_detected` when it segments literally zero leaf pixels, which in
 * practice only happens on unstructured noise. Everything else gets some
 * mask, and a PDLA is computed from it.
 *
 * These bounds flag photos whose leaf mask is implausible for a real
 * handheld shot. Measured on synthetic probes (backend/inference.py loaded
 * directly):
 *
 *   subject               frame_fraction   mask_confidence
 *   textured soil            0.003            0.52
 *   grey concrete            0.295            0.56
 *   textured skin            0.998            0.78
 *   blue sky                 0.9997           0.96
 *   dense green canopy       1.000            0.99
 *   leaf blade on soil       0.139            0.958   <- a real shot looks like this
 *
 * Note the dominant failure is a mask that covers *everything*, not one that
 * covers too little: a uniform surface gets labelled leaf edge-to-edge, with
 * high confidence. A real leaf photo always retains some background, so a
 * near-total mask means leaf isolation found nothing to isolate and PDLA's
 * denominator has become "the whole frame".
 *
 * THESE ARE UNTUNED HEURISTICS from synthetic images, not field photos. They
 * reduce obviously-bad input; they are not a rice-leaf detector, and they
 * cannot become one without a model trained with a negative class. Re-measure
 * against real captures before the thesis quotes any of these numbers.
 */
export const MIN_LEAF_FRAME_FRACTION = 0.02;
export const MAX_LEAF_FRAME_FRACTION = 0.97;
export const MIN_LEAF_MASK_CONFIDENCE = 0.7;

// ── IDW (Inverse Distance Weighting) Parameters ─────────────
/**
 * IDW Power Parameter (p):
 * Controls how aggressively the influence of a sample point
 * drops off as distance increases.
 *   p = 2  → Standard quadratic decay (default)
 *   p > 2  → More localized influence
 *   p < 2  → Broader, smoother interpolation
 *
 * Variable Definitions:
 *   Z(x)  — Estimated severity at un-sampled point x
 *   wᵢ    — Weight: 1 / d(x, xᵢ)^p
 *   zᵢ    — Known PDLA (%) at sample point i
 *   dᵢ    — Euclidean distance from target x to sample xᵢ
 */
export const IDW_POWER = 2;

/** Approximate meters per grid cell for IDW computation. */
export const IDW_CELL_SIZE_METERS = 2;

/** Maximum grid cells before adaptive coarsening kicks in. */
export const IDW_MAX_CELLS = 50000;

// ── Map Defaults ─────────────────────────────────────────────
/** Default center: Central Luzon, Philippines (rice region). */
export const DEFAULT_CENTER = [15.47, 120.59];

/** Satellite-level zoom for field-scale detail. */
export const DEFAULT_ZOOM = 18;

/** Esri World Imagery — free, no API key required. */
export const ESRI_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const ESRI_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics';

/** How far a user can pinch/scroll-zoom in the UI. */
export const ESRI_MAX_ZOOM = 22;

/**
 * Esri World Imagery's actual max resolution most places (it varies
 * by region — rural areas are sometimes lower, dense cities sometimes
 * higher). Tiles requested past this zoom don't exist and Esri
 * returns a "Map data not yet available" placeholder instead of
 * imagery, so Leaflet is told to stop fetching past this level and
 * upscale the last real tile instead (blurry, but never blank).
 */
export const ESRI_MAX_NATIVE_ZOOM = 19;

// ── Geolocation ──────────────────────────────────────────────
/** Max time to wait for a live GPS fix during camera capture. */
export const GEO_TIMEOUT_MS = 10000;

// ── ML Inference API ─────────────────────────────────────────
/**
 * SegFormer 2-stage inference endpoint (backend/server.py). In dev,
 * Vite proxies this relative path to the FastAPI server — see
 * vite.config.js's server.proxy. Real inference is slower than the
 * mock's fake 1.5–2.5s delay, especially on CPU, hence the longer
 * timeout below.
 */
export const ANALYZE_ENDPOINT = '/api/analyze';
export const ANALYZE_TIMEOUT_MS = 30000;

// ── Severity Color Scale ─────────────────────────────────────
/**
 * Maps normalized severity [0, 1] to hex colors.
 * Green (healthy) → Yellow (moderate) → Red (severe).
 */
export const SEVERITY_COLORS = [
  [0.0, '#22c55e'],   // green-500  — Healthy
  [0.25, '#84cc16'],  // lime-500
  [0.5, '#eab308'],   // yellow-500 — Moderate
  [0.75, '#f97316'],  // orange-500
  [1.0, '#ef4444'],   // red-500    — Severe
];

// ── Heatmap Rendering ────────────────────────────────────────
export const HEATMAP_DEFAULT_OPACITY = 0.65;
export const HEATMAP_MIN_OPACITY = 0.2;
export const HEATMAP_MAX_OPACITY = 0.95;

// ── Application Steps ────────────────────────────────────────
export const STEPS = {
  BOUNDARY: 'boundary',
  SAMPLING: 'sampling',
  HEATMAP: 'heatmap',
};

export const STEP_ORDER = [STEPS.BOUNDARY, STEPS.SAMPLING, STEPS.HEATMAP];

export const STEP_LABELS = {
  [STEPS.BOUNDARY]: 'Draw Boundary',
  [STEPS.SAMPLING]: 'Sample Plants',
  [STEPS.HEATMAP]: 'Heatmap',
};
