/**
 * ============================================================
 * Rice Leaf Severity Heatmap — Application Constants
 * ============================================================
 * Centralized configuration for the spatial interpolation
 * prototype. Change values here to tune the entire app.
 */

// ── Sampling Limits ──────────────────────────────────────────
export const MAX_SAMPLES = 50;

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
