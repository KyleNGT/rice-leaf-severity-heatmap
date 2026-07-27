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
 *
 * Post-crop note: since the alignment step (ImageAlignmentModal.jsx) every
 * photo reaching this guard is cropped exactly to the static framing
 * rectangle's boundary (ALIGN_OUTPUT_WIDTH × ALIGN_OUTPUT_HEIGHT) — there is
 * no separate outer frame with guaranteed margin around it the way the old
 * per-region stencils had (each of those enclosed a fixed, small fraction of
 * a larger box, so background survived regardless of how tightly the user
 * filled the outline). Now, how much background survives is entirely up to
 * how loosely the user centers their leaf in the box, per the on-screen
 * instruction text. If well-aligned real photos start landing close to
 * MAX_LEAF_FRAME_FRACTION (0.97), that is the first constant to revisit —
 * the safety margin this guard used to get for free is now just a soft
 * expectation, not a structural guarantee. The probe table above was
 * measured on *uncropped* images and is no longer the input distribution
 * this guard actually sees; re-measure it on real cropped field captures
 * before quoting either bound.
 */
export const MIN_LEAF_FRAME_FRACTION = 0.02;
export const MAX_LEAF_FRAME_FRACTION = 0.97;
export const MIN_LEAF_MASK_CONFIDENCE = 0.7;

// ── Normalized Leaf Capture (Static Framing Rectangle + Alignment Crop) ─
/**
 * Every photo — camera or gallery — is forced through a fixed capture
 * geometry before it reaches the ML pipeline: align the leaf inside one
 * static rectangle, crop exactly to it. There is no per-photo choice of
 * shape (there used to be three region-specific stencils sharing one crop
 * box; now there's a single rectangle, which is simpler and changes nothing
 * about why this works) — every photo still ends up at the same fixed
 * output size, which is what stops Σ leaf_pixels in aggregateSample.js from
 * varying with framing distance. See the pooling note there.
 */

/**
 * Fixed alignment crop output — a narrow portrait rectangle (aspect
 * literally ALIGN_FRAME_WIDTH_FRACTION / ALIGN_FRAME_HEIGHT_FRACTION below,
 * i.e. 0.3 / 0.8 = 0.375), matching a single rice leaf's own long-and-thin
 * proportions more tightly than the previous 3:4 frame did. 1600 on the long
 * edge sits safely under backend/inference.py's DEFAULT_MAX_SIDE (2048), so
 * `_downscale` there returns scale = 1.0 for EVERY photo, not just usually.
 * That turns leaf_frame_fraction's denominator (work_w × work_h) into the
 * same constant for every photo, with zero resampling variance between them.
 * Today a 4032×3024 photo and a 1600×1200 photo differ 4× in effective
 * scale, and therefore in pixel count, for identical tissue; this one change
 * is what removes that variance.
 */
export const ALIGN_OUTPUT_WIDTH = 600;
export const ALIGN_OUTPUT_HEIGHT = 1600;
export const ALIGN_ASPECT = ALIGN_OUTPUT_WIDTH / ALIGN_OUTPUT_HEIGHT;

/**
 * On-screen layout ONLY — how large the visible framing rectangle is drawn
 * relative to the alignment stage's own measured size (via a ResizeObserver
 * in ImageAlignmentModal.jsx), leaving visible dimmed margin on every side
 * rather than the rectangle filling its container edge-to-edge. This is
 * deliberately separate from ALIGN_ASPECT/ALIGN_OUTPUT_WIDTH/HEIGHT above,
 * which govern the actual EXPORTED crop and never change with device or
 * viewport size — only the on-screen pixel size of the rectangle varies by
 * device, never what gets cropped out of the source photo. Their ratio
 * (0.3 / 0.8) must equal ALIGN_ASPECT, or the visible box and the exported
 * crop would disagree in shape.
 */
export const ALIGN_FRAME_WIDTH_FRACTION = 0.3;
export const ALIGN_FRAME_HEIGHT_FRACTION = 0.8;

/**
 * JPEG encode quality for the cropped output. This blob is the measurement
 * input, not a preview — below ~0.85 chroma subsampling starts merging lesion
 * boundaries into leaf tissue and biases PDLA. Above ~0.92 the file grows
 * with no benefit a 512×512 SegFormer input could use.
 */
export const ALIGN_JPEG_QUALITY = 0.92;

/** How far the user can pinch/slider-zoom in the alignment cropper. */
export const ALIGN_MIN_ZOOM = 0.4;
export const ALIGN_MAX_ZOOM = 5;

/**
 * Rotation is coarse + fine, matching how phone photo editors (e.g. iOS
 * Photos) split "my photo is sideways" from "let me straighten the horizon":
 *
 *   - Coarse: a quick-rotate button steps `baseRotation` by this many degrees
 *     (0°/90°/180°/270°), for fixing a sideways photo in one tap.
 *   - Fine: a continuous slider adjusts `fineRotation` within
 *     ±ALIGN_FINE_ROTATION_RANGE_DEG, for straightening. Tapping the quick
 *     button resets fineRotation to 0, so the slider always reads relative
 *     to the current quarter-turn.
 *
 * The two sum to the single `rotation` value passed to <Cropper> and into
 * cropToStencil.js. Rotation itself was never restricted to multiples of
 * this step — only the OLD confirm-gate math was (see
 * getCropOverflowFraction's history in cropToStencil.js); that gate is now
 * an exact inverse-transform containment check at ANY angle, not just
 * 0/90/180/270, so nothing here caps what `rotation` can actually be.
 */
export const ALIGN_ROTATION_STEP_DEG = 90;

/** Fine-rotation slider range, in degrees each direction from 0. */
export const ALIGN_FINE_ROTATION_RANGE_DEG = 45;

/**
 * How much of the crop rect is allowed to hang off the source image before
 * "Use Photo" is blocked — a tiny epsilon for floating-point slack, not a
 * real allowance. getCropOverflowFraction is exact at any rotation angle, so
 * this threshold applies uniformly regardless of how `rotation` was reached.
 */
export const ALIGN_MAX_OVERFLOW_FRACTION = 0.005;

/**
 * Below this source-pixel width backing the crop rect, upsampling to
 * ALIGN_OUTPUT_WIDTH is heavy enough to warrant a soft "may look blurry"
 * advisory. Not a hard block — upsampling here is correct, not a bug: once
 * capture geometry is normalized, physical area per output pixel is constant
 * by construction regardless of zoom, so a heavily-zoomed crop SHOULD be
 * upsampled to keep its pooling weight proportional to physical area. Only
 * sharpness suffers.
 */
export const ALIGN_BLUR_WARN_SOURCE_WIDTH = 600;

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
