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
 * instruction text.
 *
 * The frame now also carries a static blade-width guide (see
 * ALIGN_GUIDE_WIDTH_FRACTION below) whose whole point is to get the farmer to
 * fill only ~25% of the frame's width with leaf. A photo that actually follows
 * the guide therefore has a STRUCTURAL leaf_frame_fraction ceiling around
 * 0.25, which makes today's MAX_LEAF_FRAME_FRACTION (0.97) very loose relative
 * to a compliant photo — but nothing here retunes it, since the guide is
 * advisory only (no sensor checks compliance) and 0.97 must stay wide enough
 * to still pass an uncompliant-but-real photo. 0.25 is the number to compare
 * against once real cropped field captures are measured; the probe table
 * above was taken on *uncropped, unguided* images and describes neither this
 * guard's current input distribution nor the post-guide one.
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
 * Fixed alignment crop output — a SQUARE matching the SegFormer preprocessor's
 * own input size (see segfomer_model/*\/preprocessor_config.json, both phases:
 * do_resize: true, size: {512, 512}). A non-square crop gets resized
 * anisotropically by that preprocessor — the previous 600×1600 rectangle was
 * squashed 2.67× horizontally on its way into the model, fattening every leaf.
 * Square makes that resize isotropic. 1024 sits safely under
 * backend/inference.py's DEFAULT_MAX_SIDE (2048), so `_downscale` there
 * returns scale = 1.0 for EVERY photo, not just usually. That turns
 * leaf_frame_fraction's denominator (work_w × work_h) into the same constant
 * for every photo, with zero resampling variance between them. Today a
 * 4032×3024 photo and a 1600×1200 photo differ 4× in effective scale, and
 * therefore in pixel count, for identical tissue; this one change is what
 * removes that variance. (1024, not 512, so Phase 2's leaf-bbox crop still has
 * real detail to upsample from — see ALIGN_GUIDE_WIDTH_FRACTION below for the
 * complementary fix to *magnification*.)
 */
export const ALIGN_OUTPUT_WIDTH = 1024;
export const ALIGN_OUTPUT_HEIGHT = 1024;
export const ALIGN_ASPECT = ALIGN_OUTPUT_WIDTH / ALIGN_OUTPUT_HEIGHT; // 1

/**
 * Largest fraction of the alignment stage the framing rectangle may occupy,
 * on EITHER axis — the box is then fit as the largest ALIGN_ASPECT rectangle
 * that stays within that inset (see the fit in ImageAlignmentModal.jsx), so
 * its on-screen aspect always equals ALIGN_ASPECT regardless of the stage's
 * own aspect. Do not go back to separate width/height fractions: that's
 * exactly what let the on-screen box and the exported crop disagree in shape
 * before (a tall stage produced a visibly non-square box that still exported
 * as a square, silently distorting the image). One inset fraction plus an
 * aspect-preserving fit makes that class of bug unrepresentable.
 */
export const ALIGN_STAGE_INSET_FRACTION = 0.92;

/**
 * Width of the static blade-width guide drawn inside the framing rectangle, as
 * a fraction of the frame's own width; it spans the full frame height. This is
 * the fix for scale (as opposed to ALIGN_OUTPUT_WIDTH/HEIGHT, which fixed
 * output *resolution* but not *magnification*): two photos of the same blade
 * taken from different distances still land at different pixel scales unless
 * the farmer is given something physical to align against. Asking them to fit
 * the leaf's width to this rail — not past it — targets a constant
 * pixels-per-blade-width across every photo, which is what
 * aggregateSample.js's Σ leaf_pixels pooling actually needs to be comparable
 * plant-to-plant. PURELY VISUAL — nothing measures or enforces whether a given
 * photo complies; see the leaf-plausibility-guard comment above for the
 * consequence of that.
 */
export const ALIGN_GUIDE_WIDTH_FRACTION = 0.25;

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
 * sharpness suffers. Kept equal to ALIGN_OUTPUT_WIDTH by definition — the
 * warning is "we are upsampling at all", not a distinct tuned threshold.
 */
export const ALIGN_BLUR_WARN_SOURCE_WIDTH = ALIGN_OUTPUT_WIDTH;

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
