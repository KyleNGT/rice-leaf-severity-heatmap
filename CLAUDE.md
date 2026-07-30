# Rice Leaf Severity Heatmap — Project Context

## Purpose

This is a **thesis prototype** for the paper *"A Web-Based Rice Disease Detection and Field-Scale Disease Pressure Estimation System Using SegFormer and Spatial Interpolation"*. It implements the **front-end spatial interpolation and heatmap visualization** component, plus a **Python inference backend** (`backend/`) that serves the trained 2-stage SegFormer models under `segfomer_model/`.

The target users are **Filipino rice farmers** working in the field with smartphones. The app must be mobile-first, touch-optimized, and functional on mid-range Android devices over cellular connections.

## Workflow (Strict 3-Step Process)

The app enforces a linear, sequential workflow:

1. **Draw Boundary** — User draws a closed polygon on a satellite map to define their rice field.
2. **Sample Plants** — User captures/uploads photos for up to 50 georeferenced plant nodes. **A node is one rice plant, not one photo**: a rice leaf is long enough that a single leaf often needs several frames, and field practice samples several leaves per plant, so each node holds 1–`MAX_IMAGES_PER_SAMPLE` photos pooled into one severity value (PDLA %). Every photo passes through a mandatory alignment crop against one static framing rectangle before it's analyzed — see Sample Acquisition Methods below.
3. **Generate Heatmap** — IDW interpolation computes disease pressure for all un-sampled points inside the boundary, rendered as a green→red color overlay clipped to the polygon.

Steps cannot be skipped. The user must complete each step before advancing.

## Toolstack & Constraints

These decisions are **locked in** and must not be changed without explicit user approval:

| Decision | Choice | Rationale |
|---|---|---|
| Framework | **Vite + React + JavaScript** | No TypeScript. Lightweight prototype. |
| Map Tiles | **Esri World Imagery** only | Free, no API key. Do NOT substitute Mapbox, Google Maps, or any other provider. |
| Map Library | **Leaflet.js** via `react-leaflet` | With `leaflet-geoman-free` for polygon drawing. |
| Spatial Math | **Turf.js** (`@turf/turf`) | IDW, point-in-polygon validation, bbox operations. |
| EXIF Parser | **`exifreader`** | NOT `exif-js` (abandoned since 2019, insecure). |
| Image Crop UI | **`react-easy-crop`** | Pan/zoom/rotate for the mandatory alignment step (`ImageAlignmentModal.jsx`). Actual crop/resample is hand-rolled Canvas2D (`cropToStencil.js`) — the library only supplies interaction and reports coordinates. |
| CSS | **Vanilla CSS** (`App.css`) | No Tailwind, no CSS-in-JS. Single stylesheet with CSS custom properties. |
| PWA | **Skipped** | No Service Worker. Rely on standard browser/CDN caching. Adds too much debugging complexity for a thesis prototype. |
| Linter | **oxlint** | Fast, zero-config. Run via `npm run lint`. |

## UI/UX Design System

Color tokens are defined as CSS custom properties in `src/App.css`'s `:root` block — read there for current hex values.

### 🔤 Typography (San Francisco Font Family / Sans-serif)
- Display Stats: 32px, Bold, tight tracking (For confidence percentages, map metrics)
- Section Headers: 20px, Semi-bold (For container/card titles)
- Body/Labels: 14px, Regular (For map legends, data tables)
- SF Mono for Coordinates and other numbers.

### 🧩 Component Constraints
- Layout Grid: Strictly follow an 8px spacing system (`p-2`, `p-4`, `p-8` / `gap-4`).
- Container Cards: White background, `border: 1px solid #E5E7EB`, `border-radius: 12px`, soft shadow.
- Status Badges: Semi-transparent background pill utility matching the disease severity level.
- No emoji in the UI: buttons, labels, badges, and status text use plain text and/or SVG icons, never emoji characters. Recognition over recall is served by the text label itself; an emoji renders inconsistently across Android devices/fonts, which is a real risk for the mobile-first target audience.

## IDW Parameters

Tunable constants (power, cell size, max cells) and the formula/variable definitions live as documented constants in `src/constants/constants.js` — read there, not here.

IDW runs in a **Web Worker** (`idwWorker.js`) to avoid freezing the UI. It interpolates **one channel per disease class in a single pass** — the point-in-polygon test dominates the per-cell cost and is identical across diseases, so one multi-channel worker run beats one run per disease. The worker's output is one `Float32Array(rows × cols × channels)`, channel-major, sliced into per-disease `Float32Array` views on the main thread (`idwInterpolation.js`) with no copy. The interpolated quantity is still continuous float PDLA % — banding into IRRI SES happens strictly downstream, for display, and never touches the interpolation itself.

**IRRI SES banding.** `src/utils/sesScale.js` maps a continuous PDLA % to the IRRI Standard Evaluation System's 0–9 scale, using two breakpoint tables (`SES_BREAKPOINTS_SHARED` for Bacterial Blight/Brown Spot, `SES_BREAKPOINTS_BLAST` for Leaf Blast — its lesions expand faster, so it reaches SES 9 at 65% PDLA instead of 75%) in `constants.js`. Rendering uses a *continuous* SES value (`pdlaToSesContinuous`), not the rounded integer, so the heatmap surface stays visually smooth while `Math.floor()` of that value is always the exact IRRI class — this floor invariant is enforced even exactly on a band's own boundary (see the epsilon note in `sesScale.js`).

**Per-disease censoring.** `aggregateSample.js`'s `minimum_disease_fraction` gate is applied **independently to each disease's own fraction** (`classPixels[label] / leafPixels`), not once to their sum. This keeps a healthy plant reading SES 0 on every layer — with per-pixel argmax, nearly every leaf leaks a few stray pixels into every class, so an ungated per-disease value would read as a nonzero PDLA (SES 1) almost everywhere. Consequence: `Σ diseaseSeverity` can be strictly less than the pooled `severity`, since a disease sitting just under its own gate still contributed to the pooled total's single, looser gate on the sum.

**General Threat layer.** `sesGrid.js`'s `maxSesGrid` takes the per-cell `MAX()` across every disease's continuous SES grid (`floor(max(a,b)) === max(floor(a), floor(b))`, so maxing the continuous values before flooring is equivalent to the spec's `Math.max()` over integer SES classes, and renders just as smoothly). **General is not a percentage** — it's the highest disease class present at a point — and must never be displayed or described as one; `ColorLegend.jsx` hides the PDLA breakpoint row for this layer specifically because it has none.

Switching the active layer (`heatmapLayer` state in `App.jsx`) never re-runs the worker — `sesLayers` is a `useMemo` over the one `computeIDW` result, so layer switches are pure re-renders.

## ML Inference Pipeline

`src/services/mockMLService.js` (name kept for import stability — the only importer is `App.jsx`) calls the real 2-stage SegFormer API at `ANALYZE_ENDPOINT` (`src/constants/constants.js`), proxied by Vite to a FastAPI server.

**Pipeline** (`backend/inference.py`, class `TwoStagePipeline`):
1. **Phase 1** (`segfomer_model/phase1_leaf_isolation/`) — binary SegFormer-B1, leaf vs. background.
2. **Leaf Focus Module** — pure numpy/PIL: mask × RGB blacks out background, crop to the mask's padded bbox.
3. **Phase 2** (`segfomer_model/phase2_disease_segmentation/`) — 5-class SegFormer-B1 on the cropped leaf: `background, healthy_leaf, leaf_blast, brown_spot, bacterial_blight`. **No Sheath Blight class exists in the trained checkpoint** — class ids are read from the model config / `deployment_metadata.json` at runtime, so a future re-trained model with more classes drops in without code changes.
4. **PDLA** = `100 × disease_pixels / phase1_leaf_pixels`, per `deployment_metadata.json`'s `pdla_formula`.

**Response contract** (unchanged from the original mock): `{ diseaseDetected, severity, diseaseName, confidence }`. `severity` is now a real float PDLA percentage — display sites use `.toFixed(1)`. A `status: "no_leaf_detected"` result and any thrown fetch error both set `analysisError` on the draft sample in `App.jsx`, and `canAddSample` blocks commit until it's clear — a failed or leafless analysis must never inject a fabricated severity into the IDW grid.

### Plant-Level Pooling

`/api/analyze` stays one image per request; `src/utils/aggregateSample.js` reduces a plant's photos to the single severity the IDW grid interpolates:

```
PDLA_plant = 100 × Σ disease_pixels / Σ leaf_pixels
```

This is the ratio of the summed pixel counts, **not the mean of the per-photo percentages**, and it equals what the pipeline would report for one composite image of all tissue photographed at that plant. Three reasons averaging is wrong:

- PDLA is a ratio of two counts, so a mean of ratios ≠ ratio of sums. A close-up of one lesion would weigh as much as a wide shot of clean tissue.
- `severity` is **censored** — `inference.py` forces it to `0.0` below `minimum_disease_fraction`, so averaging it under-reports a plant whose leaves are each lightly affected. Pool the raw counts and apply that gate once, at plant level (the aggregator reads the threshold out of the response so it stays tied to `deployment_metadata.json`).
- `diseaseName` is categorical. The pooled winner is the disease class holding the most leaf pixels across the plant, named via `diagnostics.disease_display_names`.

**No plant-level confidence is claimed.** Each photo's confidence is a mean softmax posterior conditioned on *that photo's* winning class, which may differ from the plant's, so combining them yields a number with no referent. The per-photo range is displayed instead.

A photo that fails or returns `no_leaf_detected` is **excluded, not fatal** — it contributes zero to both sides of the ratio, so it cannot fabricate a severity, and the plant is still savable as long as one photo produced a measurement. If every photo fails, `severity` is `null` (never `0`) and the plant cannot be committed.

**Weighting caveat for the write-up:** every photo — camera or gallery — now passes through a mandatory alignment crop (`ImageAlignmentModal.jsx` → `cropToStencil.js`) before it reaches analysis, at one fixed square output resolution for every photo (`ALIGN_OUTPUT_WIDTH/HEIGHT` in `constants.js`, 1024×1024 — square so the SegFormer preprocessor's own 512×512 resize is isotropic, unlike the old non-square crop). That resolution sits under the backend's `DEFAULT_MAX_SIDE`, so `_downscale` is a no-op for every photo — the dominant source of scale variance from output *resolution* (a close-up photographing 4× more effective resolution than a wide shot of the same tissue) is gone.

Resolution alone doesn't fix *magnification*, though: two photos of the same blade taken from different distances still land at different pixel scales unless the farmer has something physical to align against. The frame now also carries a static blade-width guide — a dashed vertical rail at `ALIGN_GUIDE_WIDTH_FRACTION` (20%) of the frame's width, spanning its full height — that asks the farmer to fit the leaf's width to the rail, not past it. This targets a constant pixels-per-blade-width across every photo, which is what the pixel-count pooling actually needs to be comparable plant-to-plant, not just frame-to-frame. **It is guidance only** — nothing measures or enforces whether a given photo complies.

What's left: no physical scale reference is in frame, so pixel→mm² is still unknown; the weights are now blade-width-normalized, not calibrated to a physical unit. The residual assumptions are that blade width is roughly constant within a variety, and that the farmer aligned to both the static framing rectangle and the width guide by eye.

### Leaf Plausibility Guard

Phase 1 is a binary leaf/background segmenter with **no negative class**, so it cannot say "this is not a rice leaf". `no_leaf_detected` only fires on zero leaf pixels. Measured against synthetic probes, the dominant failure is the *opposite* of what you'd expect — a uniform surface gets masked edge-to-edge with high confidence:

| subject | `leaf_frame_fraction` | `leaf_mask_confidence` |
|---|---|---|
| textured soil | 0.003 | 0.52 |
| grey concrete | 0.295 | 0.56 |
| textured skin | 0.998 | 0.78 |
| blue sky | 0.9997 | 0.96 |
| dense green canopy | 1.000 | 0.99 |
| **leaf blade on soil** | **0.139** | **0.958** |
| well-aligned crop (design target) | **0.13–0.16** | — |

So the guard is a *band*, not a floor: `MIN/MAX_LEAF_FRAME_FRACTION` and `MIN_LEAF_MASK_CONFIDENCE` in `constants.js`. Thresholds live in the front end so they can be tuned without restarting a process that loads two SegFormers. **They are untuned heuristics from synthetic images** — re-measure against real field captures before quoting them.

**Post-crop note:** the six-row probe table above predates the alignment crop and no longer describes the input distribution this guard actually sees — every photo reaching it is now cropped exactly to the static framing rectangle's boundary, with no separate outer frame guaranteeing background margin the way the old per-region stencils did (each of those enclosed a small, fixed fraction of a larger box, so background survived regardless of how tightly the user filled the outline). Now, how much background survives depends entirely on how loosely the user centers their leaf in the box, per the on-screen instruction text. If well-aligned real photos start landing close to `MAX_LEAF_FRAME_FRACTION` (0.97), that is the first constant to revisit — the safety margin this guard used to get for free is now just a soft expectation, not a structural guarantee.

**Running the backend:** see the `run-backend` skill for setup steps and the conda/venv-shadowing gotcha.

## UI / UX Principles

These principles are actively enforced and must be maintained:

- **Mobile-first** — All touch targets ≥ 48px. The app is designed for field use on smartphones.
- **Heuristic evaluation** (Nielsen's 10) — Applied throughout:
  - Visibility of system status (live vertex counter, step indicator, loading progress).
  - Recognition over recall (all tool buttons have text labels + icons, not just icons).
  - User control & freedom (cancel drawing, edit/redraw boundary, manual GPS fallback).
  - Error prevention (disable "Continue" while drawing, point-in-polygon validation).
  - Match system & real world (natural language instructions, not technical jargon).
- **Geoman's default toolbar is hidden** — Custom themed buttons in the ActionPanel replace it.
- **Responsive stepper** — Mobile shows a compact pill (`Step 1/3 · Draw Boundary`), desktop shows full horizontal stepper. Breakpoint: 768px.
- **Mobile sampling uses a draggable bottom sheet** (`SampleSheet.jsx`) floating over a full-bleed map; desktop uses the side-by-side split. Both render the same `SamplePanel`, so a prop change lands on both surfaces at once.
- **Every photo's fate is legible from its own tile** — analyzing, failed, quality-flagged, or counted — so the farmer can see which shot to retake without parsing a summary. This is why the photo strip is a vertical list rather than a horizontal carousel: a carousel would hide the warning text.

## Sample Acquisition Methods

The app supports three ways to georeference a plant node:

1. **Camera capture** — `<input capture="environment">` takes one photo and uses the device's live GPS.
2. **Gallery upload** — `multiple`, so a plant's photos can be picked in one go. Parses EXIF GPS from the first *committed* file via `exifreader`.
3. **Manual Latitude/Longitude Input** — If no GPS is found or the GPS falls outside the boundary, the user types the coordinates. `DraftMarker` previews the pin live as they do.

**Neither Camera nor Gallery goes straight to the ML pipeline.** Every picked photo queues through `ImageAlignmentModal` — pan/zoom/rotate (coarse 90° steps plus a continuous ±45° straighten slider) and flip horizontal/vertical the leaf into one static square framing rectangle (matching the SegFormer preprocessor's own 512×512 input shape, so its resize is isotropic), the same shape for every photo, then crop to its boundary — before it becomes a draft image. Inside that rectangle, a dashed vertical guide marks 20% of the frame's width, full height: the on-screen instruction asks the farmer to fit the leaf's widest part to that rail without crossing it, giving a consistent blade-width-to-pixel scale across photos taken at different distances. **The guide is static visual guidance only — nothing detects or enforces whether the leaf actually fits it.** This is what makes `aggregateSample.js`'s pixel-count pooling scale-consistent, not just framing-consistent (see Plant-Level Pooling above); there is no path from either capture method to `/api/analyze` that skips it. A photo only becomes part of the draft, and only then starts analysis, once its crop is confirmed — see `useAlignmentQueue.js`. There is no re-align action: the original file isn't retained past a successful crop, so fixing a bad alignment means removing the photo from the strip and retaking it.

Framing feedback is severity-tiered, not one generic warning: a single `alert` object in `ImageAlignmentModal.jsx` (blocking > soft overflow > too-close, at most one shown) drives a badge over the viewfinder, the frame border color/pulse, and a promoted alert card in lockstep, so a hard block (`ALIGN_MAX_OVERFLOW_FRACTION` exceeded, "Use Photo" disabled) never looks like a soft advisory (the 25–40% overflow band, or zoomed in past `ALIGN_BLUR_WARN_SOURCE_WIDTH`) the way the old single `.align-warning` line did. The card always renders inside a fixed-height `.align-alert-slot` (empty when there's no alert) rather than being a conditional flow element, so mounting it — or switching between the blocking and caution copy, which are different lengths — never changes `.align-overlay`'s flex layout and never resizes the viewfinder underneath it; longer copy scrolls inside the band instead.

**The framing rectangle can legally hang off the source photo.** Fitting a close-up leaf to the blade-width guide often means zooming *out*, which is exactly what pushes the frame past the source image's edge — so the confirm gate (`getCropOverflowFraction` in `cropToStencil.js`) is a real clipped-area fraction, not a contained-or-not check, and blocks "Use Photo" only past `ALIGN_MAX_OVERFLOW_FRACTION` (40% of the frame's area). Below that, `cropAlignedImage` paints the uncovered part with `ALIGN_VOID_FILL_RGB` (flat black, `constants.js`) instead of rejecting the photo — PDLA only counts pixels inside the Phase-1 leaf mask, so a fill that reads as background is invariant to the ratio. That color isn't a guess: Phase 1 has no negative class and can misread a flat, uniform fill as leaf (this file's own probe table shows sky-blue scoring 99.97% "leaf"), so `backend/probe_fill.py` measured candidate fills — flat black, soil brown, soil-colored noise, blurred mirror-padding — against the real checkpoint, first on a 5-6 photo convenience sample (an earlier pass picked soil brown), then re-measured on 48 real, raw, unaligned rice-leaf photos spanning all 3 disease classes plus healthy, with genuinely complex backgrounds — other rice plants, unrelated shrubs, bare soil (2026-07-29). That larger run fixed a real bug in the probe script itself (it computed the leaf bbox via the EXIF-orientation-corrected `pipeline.analyze()` but painted the ring on an EXIF-uncorrected raw array — invisible on square crops, but a coordinate-space mismatch on any raw phone photo carrying an EXIF rotation tag, producing spurious "leaks" up to 27% that had nothing to do with any fill color) and reversed the fill-color pick: flat black's worst-case leak was 2.36% of the painted ring area, statistically tied with mirror-blur padding (2.37%) and well ahead of the earlier soil-brown pick (5.10% on this larger set). Black won over the tied mirror-blur candidate because it's the simpler implementation already in place, for no measured leak disadvantage. The cap itself — 40% — was re-measured on the same 48-photo set: mean PDLA drift from the void=0 reference stayed under 1 point at every measured void level (20-50%), and 40% specifically had the *lowest* max drift (7.38) of the whole grid, with the least-favorable individual photo's `leaf_frame_fraction` at 0.046 — comfortably clear of the 0.02 floor. The dataset's remaining noise (max drift still bounces 7-15 points across void levels) traces to a specific, repeatedly-observed pattern, not a void-cap problem: low-severity photos near the `minimum_disease_fraction` censoring threshold are inherently unstable, because PDLA is a ratio with a small numerator there, so small absolute pixel changes cause large relative swings — see the Known Limitations note below. Two of the 50 raw photos gathered for this measurement were excluded first: 2 stock-photo screenshots whose visible watermark text crossed directly over the lesion area, and 2 more whose baseline `leaf_frame_fraction` (0.039 and 0.405) was far enough from anything achievable through the app's own alignment modal that using them as a "before any void" reference point would have measured compounding-error-from-a-bad-starting-point rather than actual void tolerance.

**Location is plant-level and resolved once**, same as before, just timed around the alignment step instead of around selection. The farmer walks around one plant taking several shots, so re-fixing GPS per photo would jitter the pin. For a camera batch, the GPS fix is requested the moment photos are picked (overlapping alignment time, rather than waiting for it) and applied when the first photo of that batch is confirmed. For a gallery batch, EXIF is read from the first *confirmed* photo's original file, not the first *selected* one — skipping a photo in the aligner correctly excludes its EXIF from setting the plant's location. Either way, coordinates already set are never overwritten by a later photo, and a manual edit always wins as the provenance of record (`locationSource: 'manual'`).

Adding a photo **appends** to the current plant — it does not start a new one. "Save Plant" commits the node and clears the draft; "Discard plant" (behind a confirmation dialog) throws it away. Removing the last photo discards the draft too.

**Blob lifetime:** draft photos are `URL.createObjectURL` blobs (the lightbox needs full resolution). On commit they are downscaled to small data URLs via `makeThumbnail.js` and the object URLs are revoked. Object URLs must never outlive a draft — 50 plants × up to 10 full-resolution photos would otherwise stay pinned in memory on the mid-range Android this targets.

## Known Limitations (Prototype Scope)

- Disease classification covers 5 classes only (no Sheath Blight) — limited by the trained Phase 2 checkpoint, not the code.
- Requires the FastAPI backend running locally (`backend/server.py`); there is no hosted inference endpoint.
- No user authentication or data persistence (state is in-memory only).
- No offline tile caching (no Service Worker).
- Single-field session only (page reload resets everything).
- IDW computation caps at ~50,000 grid cells for browser performance.
- Max 50 plant nodes per session, max 10 photos per plant.
- **Phase 1 cannot reject non-rice subjects.** It has no negative class, so a photo of soil, a hand, or sky still yields a leaf mask and a PDLA. The plausibility band in `constants.js` reduces obviously-bad input but is not a rice-leaf detector, and cannot become one without retraining with a negative class. The alignment crop doesn't change this — it fixes framing, not subject matter.
- **Pooling weights are blade-width-normalized, not biologically calibrated.** Every photo shares one fixed square output resolution and a static blade-width guide (see Plant-Level Pooling above), which together target a constant pixels-per-blade-width across photos — but there's no physical scale reference in frame, so pixels still can't be converted to mm². The residual assumptions are that blade width is roughly constant within a variety and that the farmer aligned to both the static framing rectangle and the width guide accurately by eye.
- **The blade-width guide is advisory, not enforced.** It's a static dashed rail drawn at `ALIGN_GUIDE_WIDTH_FRACTION` of the frame width — no sensor checks whether the leaf's width actually stays inside it. A photo that ignores the guide entirely is still accepted and pooled the same as one that follows it precisely.
- **There is no re-align action.** The original file isn't retained past a successful crop (ten originals pinned for one draft would blow the memory budget the `MAX_IMAGES_PER_SAMPLE` comment already worries about), so fixing a bad alignment means removing the photo and retaking it.
- **IDW weights every node equally** regardless of how many photos back it. A node from one blurry photo influences the surface as much as one from ten; `leafPixels` is recorded on each sample if this is ever revisited. This now applies **independently to each of the four surfaces** (General plus the three disease layers) — a node's influence isn't diluted or concentrated differently on one layer versus another, but the underlying equal-weighting limitation is unchanged on all of them.
- **Per-disease PDLA is censored independently, so per-disease values sum to ≤ the pooled `severity`.** See the IDW Parameters section above. This is by design (it keeps a healthy plant reading SES 0 on every disease layer), but it means `diseaseSeverity.leaf_blast + diseaseSeverity.brown_spot + diseaseSeverity.bacterial_blight` is not generally equal to `severity` — don't assume they reconcile when writing up numbers side by side.
- **The General Threat heatmap layer is `Math.max()` of SES classes, not a percentage.** It answers "what is the worst disease pressure at this point," not "how diseased is this point" — those are different questions once more than one disease is present at different points in the field. Never label it with a `%` sign or average it with the per-disease PDLA values.
- **IRRI SES breakpoints are applied as documented by IRRI, not re-validated against this checkpoint's own PDLA distribution.** The banding in `sesScale.js` assumes the trained Phase 2 model's disease-pixel counting is comparable enough to IRRI's original visual-rating methodology to reuse its numeric breakpoints as-is. That assumption is untested here.
- Per-photo `confidence` is a mean softmax posterior over pixels, **not a calibrated probability** that the diagnosis is correct. State that caveat wherever it is surfaced.
- **No guaranteed background margin.** The crop is the static framing rectangle's boundary — unlike the old per-region stencils, there's no separate outer frame structurally guaranteeing background around the leaf regardless of how tightly the user fills the box. Re-measure `leaf_frame_fraction` against real cropped field captures, and be ready to raise `MAX_LEAF_FRAME_FRACTION` if well-aligned photos start approaching it, before either bound is quoted in the thesis.
- **The overflow void-fill cap and fill color are now measured on a 48-photo real, diverse, EXIF-corrected sample** (`backend/probe_fill.py` against `sample_photos/`, 2026-07-29) — stronger evidence than the original 5-6 photo pass, but still one dataset, one snapshot in time. `ALIGN_MAX_OVERFLOW_FRACTION` (0.40) and `ALIGN_VOID_FILL_RGB` (flat black) should still be re-run if the Phase 1 checkpoint changes or a substantially larger field set becomes available — see the Sample Acquisition Methods note above for exactly what was measured and why.
- **PDLA is unstable for low-severity photos near the `minimum_disease_fraction` censoring threshold**, independent of void/overflow entirely — this has now shown up in three separate photos across three separate measurement runs (small-disease-area leaves whose severity swings by double digits or fully censors to 0 from small absolute pixel changes). It's a property of PDLA being a ratio with a small numerator near a hard censoring cutoff, not a void-cap defect, and not something a bigger dataset will smooth away. Worth flagging explicitly if the thesis reports PDLA confidence/precision for low-severity cases.
- **PDLA drift is systematically downward as void increases**, and two photos of the same plant taken at very different void levels are not perfectly comparable even though both pass the overflow gate — a real cost of the looser 40% cap versus the original 20%, not just measurement noise.
