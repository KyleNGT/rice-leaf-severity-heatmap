/**
 * ============================================================
 * Rice Leaf Severity Heatmap — Application Constants
 * ============================================================
 * Centralized configuration for the spatial interpolation
 * prototype. Change values here to tune the entire app.
 */

// ═══════════════════════════════════════════════════════════
// TEMPORARY — DEV/TESTING ONLY. DELETE BEFORE SHIP.
// ═══════════════════════════════════════════════════════════
/**
 * Lets a tap anywhere on the map set the in-progress draft plant's lat/lng
 * directly during the Sampling step, skipping GPS/EXIF/manual typing —
 * purely to place test plants faster. Not a feature the shipped app should
 * have. Flip to `false` to disable instantly, or strip this constant along
 * with MapView's `TapToSetLocation` child and App.jsx's
 * `handleMapTapLocation` once testing is done.
 */
export const ENABLE_TAP_TO_SET_LOCATION = true;

// ── Sampling Limits ──────────────────────────────────────────
/** Max plant nodes (sample points) per field session. */
export const MAX_SAMPLES = 50;

/** Min plant nodes required before "Generate Heatmap" is enabled. IDW needs
 * at least 2 points to interpolate a surface — a single sample has no
 * spatial variation to spread across the field. */
export const MIN_SAMPLES = 3;

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
 * fill only ~20% of the frame's width with leaf. A photo that actually follows
 * the guide therefore has a STRUCTURAL leaf_frame_fraction ceiling around
 * 0.20, which makes today's MAX_LEAF_FRAME_FRACTION (0.97) very loose relative
 * to a compliant photo — but nothing here retunes it, since the guide is
 * advisory only (no sensor checks compliance) and 0.97 must stay wide enough
 * to still pass an uncompliant-but-real photo. 0.20 is the number to compare
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
export const ALIGN_GUIDE_WIDTH_FRACTION = 0.2;

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
 * The color the alignment crop's void (the part of the framing rectangle that
 * hangs off the source image, up to ALIGN_MAX_OVERFLOW_FRACTION below) gets
 * painted before the crop reaches Phase 1 — see cropAlignedImage in
 * cropToStencil.js. This is NOT an arbitrary choice: Phase 1 has no negative
 * class, so a flat fill can get misread as leaf (a synthetic sky-blue probe
 * scored 99.97% "leaf_frame_fraction" — see the probe table in CLAUDE.md).
 *
 * Flat black, not soil brown. Re-measured by backend/probe_fill.py against 48
 * real, raw rice-leaf photos spanning all 3 disease classes plus healthy,
 * with genuinely complex backgrounds (other rice plants, unrelated shrubs,
 * soil) — not isolated studio shots (2026-07-29). Flat black's worst-case
 * leak was 2.36% of the painted ring area, statistically tied with
 * mirror-blur padding (2.37%) and clearly ahead of flat soil brown (5.10%,
 * the earlier pick) and RGB noise (57%, one outlier photo). Black was chosen
 * over the tied mirror-blur candidate because it's the simpler
 * implementation already in place (a flat fillRect) for no measured leak
 * disadvantage — mirror-blur would need real new code (mirror-pad + blur)
 * for zero measured benefit.
 *
 * This measurement also fixed a real bug in probe_fill.py itself: it had
 * been computing the leaf bbox via pipeline.analyze() (which EXIF-corrects
 * orientation) but painting the ring on a raw, EXIF-uncorrected array — a
 * coordinate-space mismatch invisible on square 1024x1024 crops (width can't
 * swap with height) but catastrophic on raw phone photos carrying an EXIF
 * Orientation tag, producing spurious leak numbers up to 27% that had
 * nothing to do with any candidate fill. Earlier soil-brown numbers (2.1%
 * worst-case, n=5-6) predate that fix and used a much smaller, less diverse
 * sample; this measurement supersedes them.
 */
export const ALIGN_VOID_FILL_RGB = [0, 0, 0];

/**
 * How much of the crop rect's own area is allowed to hang off the source
 * image before "Use Photo" is blocked. This is a REAL area fraction (see
 * getCropOverflowFraction's polygon-clipping rewrite in cropToStencil.js),
 * not the old binary contained/not-contained gate — the gap it allows gets
 * painted with ALIGN_VOID_FILL_RGB, not rejected, because zooming OUT to fit
 * a close-up leaf to the blade-width guide (ALIGN_GUIDE_WIDTH_FRACTION) is
 * exactly what pushes the frame past the image edge, and that is the correct
 * fix for that case, not a mistake to block.
 *
 * Re-measured by backend/probe_fill.py Part 2 (void cap) against the same
 * 48-photo real, diverse, EXIF-corrected dataset used for ALIGN_VOID_FILL_RGB
 * (2026-07-29) — the strongest evidence base this constant has had. At
 * void=40%: mean PDLA drift from the void=0 reference was +0.30 points, and
 * max |drift| was 7.38 — actually the LOWEST max-drift point across the whole
 * measured grid (20/30/35/40/45/50%), not merely an acceptable one. Mean
 * leaf_frame_fraction was 0.1339; the lowest individual photo's ff at 40% was
 * 0.046 (bacterial_blight_218.jpg), comfortably clear of
 * MIN_LEAF_FRAME_FRACTION (0.02) — no photo in this larger set came close to
 * the floor the way the earlier n=6 measurement's blast.jpg did.
 *
 * The dataset's remaining noise (max |drift| still bounces 7-15 points
 * across void levels rather than trending smoothly) traces to a specific,
 * now three-times-observed pattern: low-severity photos near
 * minimum_disease_fraction's censoring threshold are inherently unstable,
 * because PDLA is a ratio with a small numerator there — small absolute
 * pixel changes cause large relative swings. This shows up at EVERY void
 * level (not just high ones), so it isn't evidence against the 40% cap
 * specifically; it's a property of PDLA itself near the censoring floor. See
 * the Known Limitations note in CLAUDE.md.
 *
 * RE-MEASURE if this ever needs to move — do not hand-tune it.
 */
export const ALIGN_MAX_OVERFLOW_FRACTION = 0.4;

/**
 * Below this, the void is present but small enough not to interrupt the
 * farmer with a warning at all — only coverageOk's block (above
 * ALIGN_MAX_OVERFLOW_FRACTION) and this soft warning band apply. Between this
 * and ALIGN_MAX_OVERFLOW_FRACTION, "Use Photo" stays enabled but
 * ImageAlignmentModal.jsx shows a non-blocking note that part of the frame
 * will be filled in. Scaled up alongside the 40% cap to keep roughly the same
 * ~60%-of-cap yellow-zone position the 12%-of-20% version had. Not
 * independently measured — see ALIGN_MAX_OVERFLOW_FRACTION for the real data
 * point this is offset from.
 *
 * Across the measured grid, drift is systematically *downward* with more
 * void — shrinking the leaf into fewer output pixels loses lesion detail —
 * so two photos of the same plant taken at very different void levels are
 * not perfectly comparable even though both pass this gate. That's a real
 * cost of the looser cap versus the old 20%, not just a rounding artifact,
 * and worth stating as a limitation alongside the fill-color/cap sample-size
 * caveat below.
 */
export const ALIGN_WARN_OVERFLOW_FRACTION = 0.25;

/**
 * Below this source-pixel width backing the crop rect, upsampling to
 * ALIGN_OUTPUT_WIDTH is heavy enough to warrant a soft "may look blurry"
 * advisory. Not a hard block — upsampling here is correct, not a bug: once
 * capture geometry is normalized, physical area per output pixel is constant
 * by construction regardless of zoom, so a heavily-zoomed crop SHOULD be
 * upsampled to keep its pooling weight proportional to physical area. Only
 * sharpness suffers. Kept equal to ALIGN_OUTPUT_WIDTH by definition — the
 * warning is "we are upsampling at all", not a distinct tuned threshold.
 * Surfaced in ImageAlignmentModal.jsx as the "Zoomed in too close" caution
 * alert (`tooClose`) — same expression, just user-facing copy reframed
 * around the fix (zoom out) rather than the symptom (may look blurry).
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

/**
 * Horizontal band the Sample History sidebar occupies on desktop (its own
 * width plus its left inset — see `.history-sidebar` in App.css). When a
 * sidebar row flies the map to a plant (MapController's focusTarget), the
 * camera target is biased east by half of this so the node lands centered
 * in the strip actually visible beside the open sidebar, not underneath it.
 * Not used on mobile, where the sidebar covers the full width regardless.
 */
export const HISTORY_SIDEBAR_OFFSET_PX = 348;

/**
 * How far the user can pan away from their field boundary during Sampling
 * (MapController's setMaxBounds lock), as a fraction of the boundary's own
 * width/height added on every side (Leaflet's `LatLngBounds.pad`). 1.5 means
 * the pannable area extends 150% of the field's own size past each edge —
 * roughly a 4x-wider box — loose enough to glance at surrounding context
 * (access roads, neighboring plots for GPS orientation) while still pulling
 * back to the field on release. Was 0.15 (15%), which felt like a hard wall
 * for typical field sizes.
 */
export const SAMPLING_PAN_BOUNDS_PADDING = 1.5;

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
 * Base origin for the inference API (backend/server.py). Empty by default,
 * so ANALYZE_ENDPOINT/HEALTH_ENDPOINT stay the bare relative paths that
 * vite.config.js's server.proxy forwards to localhost:8000 in dev.
 *
 * That proxy is dev-only — it has no effect on a `vite build` output, so a
 * deployed build (e.g. on Vercel) has no way to reach the backend unless
 * this is set. Set VITE_API_BASE_URL in the hosting provider's environment
 * variables to the backend's public origin (e.g. a Cloudflare Tunnel URL
 * while testing, or a container host's URL later). Trailing slashes are
 * stripped so '<url>/' and '<url>' behave the same.
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/**
 * SegFormer 2-stage inference endpoint. Real inference is slower than the
 * old mock's fake 1.5–2.5s delay, especially on CPU, hence the long timeout
 * below — a remote backend adds network latency on top, plus a possible
 * cold-start model load if the host scales to zero.
 */
export const ANALYZE_ENDPOINT = `${API_BASE_URL}/api/analyze`;

/**
 * Lets the front end distinguish "backend unreachable" from "backend
 * reachable but inference failed" before the user ever takes a photo — see
 * checkBackendHealth() in mockMLService.js and its call site in App.jsx.
 */
export const HEALTH_ENDPOINT = `${API_BASE_URL}/api/health`;

export const ANALYZE_TIMEOUT_MS = 60000;

// ── IRRI Standard Evaluation System (SES) Scales ────────────
/**
 * The heatmap no longer paints raw PDLA % on a linear ramp. It bands PDLA
 * into the official IRRI Standard Evaluation System for Rice's 0–9 disease
 * severity scale, per disease. Two tables exist because IRRI's own breakpoints
 * differ by disease — Leaf Blast's lesions expand faster than Brown Spot's or
 * Bacterial Blight's, so blast reaches SES 9 at 65% PDLA while the shared
 * scale doesn't reach SES 9 until 75%.
 *
 * Each array is a breakpoint table indexed by SES level: `bp[k]` is the upper
 * bound of level `k`'s PDLA band (`bp[0] = 0` is the level-0 anchor, not a
 * band edge). Every band is `(bp[k-1], bp[k]]` — upper-inclusive — with ONE
 * documented exception: on the shared scale, level 1 is `(0, 1)`, i.e. its
 * upper bound of 1 is EXCLUSIVE, because IRRI writes level 2 as "≥1% to 3%".
 * `bp[9]` is not a real IRRI boundary (both scales are open-ended past level
 * 8) — it's set to 100 (the max possible PDLA) purely so the continuous
 * SES mapping in sesScale.js has a finite band to interpolate level 9 within.
 * See sesScale.js for the code that reads these; see CLAUDE.md's IDW
 * Parameters section for how the resulting SES value drives rendering.
 */
export const SES_BREAKPOINTS_SHARED = [0, 1, 3, 5, 10, 15, 25, 50, 75, 100]; // Bacterial Blight, Brown Spot
export const SES_BREAKPOINTS_BLAST = [0, 0.3, 0.9, 2, 7, 14, 24, 39, 65, 100]; // Leaf Blast

/** Disease labels with no dedicated IRRI table (e.g. a re-trained checkpoint
 * with a new class) fall back to the shared scale — the conservative choice,
 * since it reaches SES 9 later than blast's table would. */
export const SES_FALLBACK_BREAKPOINTS = SES_BREAKPOINTS_SHARED;

/**
 * SES level → color, index === SES level (0–9). Green (healthy) through
 * yellow/orange (moderate-severe) into red, then violet for the two most
 * severe classes — violet reads as "beyond red" without introducing a second
 * hue family partway through, and keeps SES 8/9 visually distinct from each
 * other and from SES 7, which the old 5-stop green→red ramp could not do
 * across 10 discrete classes.
 */
export const SES_COLORS = [
  '#15803d', // SES 0 — green-700 (healthy)
  '#4d9f3f',
  '#84cc16', // lime-500
  '#c6d420',
  '#eab308', // yellow-500
  '#f59e0b', // amber-500
  '#f97316', // orange-500
  '#dc2626', // red-600
  '#a21caf', // fuchsia-700
  '#6d28d9', // SES 9 — violet-700
];

/** Layer key for the MAX()-of-diseases surface (see sesGrid.js). Not a real
 * disease label, so it's kept distinct from anything `disease_labels` could
 * ever contain. */
export const HEATMAP_LAYER_GENERAL = 'general';

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
