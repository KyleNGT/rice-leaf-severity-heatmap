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

### 🎨 Visual Tokens (Colors)
- `bg-brand-primary` / `#046307` (Emerald Green - Healthy crops / Success / Zero Pressure Warning)
- `text-neutral-dark` / `#212222` (Cool Gray - Readable body text)
- `bg-status-warning` / `#d7e051` (Yellow - Moderate disease pressure warning)
- `bg-status-danger` / `#ed5d54` (Bright Red - High disease severity/Blight alerts)
- `bg-canvas` / `#F9FAFB` (Off-white main background)

### 🔤 Typography (San Francisco Font Family / Sans-serif)
- Display Stats: 32px, Bold, tight tracking (For confidence percentages, map metrics)
- Section Headers: 20px, Semi-bold (For container/card titles)
- Body/Labels: 14px, Regular (For map legends, data tables)
- SF Mono for Coordinates and other numbers.

### 🧩 Component Constraints
- Layout Grid: Strictly follow an 8px spacing system (`p-2`, `p-4`, `p-8` / `gap-4`).
- Container Cards: White background, `border: 1px solid #E5E7EB`, `border-radius: 12px`, soft shadow.
- Status Badges: Semi-transparent background pill utility matching the disease severity level.

## IDW Parameters

Defined as constants in `src/constants/constants.js`:

- **Power parameter** `p = 2` — Standard quadratic distance decay.
- **Cell size** — 2 meters per grid cell.
- **Max cells** — 50,000 before adaptive coarsening.
- **Formula** — `Z(x) = Σ(wᵢ × zᵢ) / Σ(wᵢ)` where `wᵢ = 1 / d(x, xᵢ)^p`

Variables: `Z(x)` = estimated severity at target point, `wᵢ` = weight, `zᵢ` = known PDLA at sample i, `dᵢ` = Euclidean distance, `p` = power parameter.

IDW runs in a **Web Worker** (`idwWorker.js`) to avoid freezing the UI.

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

Resolution alone doesn't fix *magnification*, though: two photos of the same blade taken from different distances still land at different pixel scales unless the farmer has something physical to align against. The frame now also carries a static blade-width guide — a dashed vertical rail at `ALIGN_GUIDE_WIDTH_FRACTION` (25%) of the frame's width, spanning its full height — that asks the farmer to fit the leaf's width to the rail, not past it. This targets a constant pixels-per-blade-width across every photo, which is what the pixel-count pooling actually needs to be comparable plant-to-plant, not just frame-to-frame. **It is guidance only** — nothing measures or enforces whether a given photo complies.

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

**Running the backend:**
```bash
# One-time setup
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

# Every time
npm run dev:api
```
Then `npm run dev` in a second terminal — Vite proxies `/api/*` to `localhost:8000` (see `vite.config.js`).

`npm run dev:api` invokes `backend/.venv/bin/uvicorn` by explicit path rather than a bare `uvicorn`. **This matters if conda/Anaconda is installed** — `conda init` prepends its own bin dir to `PATH`, which can shadow an activated venv (a new terminal tab, or conda re-asserting itself, silently reverts `uvicorn`/`python` to Anaconda's, which never had `backend/requirements.txt` installed). Symptom: the server crashes on `import torch`, or the front end shows "Cannot reach the analysis server." Verify the interpreter directly with `backend/.venv/bin/python -c "import torch; print(torch.__version__)"`.

## Architecture

```
src/
├── App.jsx              # Root state machine (step, boundary, samples, heatmap)
├── App.css              # All styles. Light theme, system/SF font stack.
├── main.jsx             # React entry point
├── constants/
│   └── constants.js     # All tunable values (IDW params, map defaults, steps)
├── components/
│   ├── MapView.jsx              # Leaflet MapContainer + GPS centering
│   ├── MapController.jsx        # Imperative map recentering/fit
│   ├── BoundaryDrawer.jsx       # Geoman polygon (desktop, custom toolbar)
│   ├── MobileBoundaryDrawer.jsx # Center-crosshair drawing for touch devices
│   ├── ActionPanel.jsx          # Bottom panel (contextual per step)
│   ├── StepperBar.jsx           # Header progress (pill on mobile, full on desktop)
│   ├── SamplePanel.jsx          # Photo strip + pooled plant result + Save Plant
│   ├── SampleSheet.jsx          # Mobile draggable bottom sheet wrapping SamplePanel
│   ├── ImageAlignmentModal.jsx  # Mandatory pan/zoom/rotate crop before analysis
│   ├── SampleMarker.jsx         # Committed plant node popup (all its photos)
│   ├── DraftMarker.jsx          # Live preview pin for the uncommitted plant
│   ├── HeatmapOverlay.jsx       # Canvas-based IDW render clipped to boundary
│   ├── ColorLegend.jsx          # Green→Red severity legend
│   └── LoadingOverlay.jsx       # Processing spinner with progress bar
├── hooks/
│   ├── useExifGps.js          # EXIF GPS extraction hook
│   ├── useDeviceLocation.js   # navigator.geolocation wrapper
│   ├── useIsMobileViewport.js # 768px breakpoint matchMedia hook
│   └── useAlignmentQueue.js   # Staging area for photos awaiting alignment
├── services/
│   └── mockMLService.js # Calls the real inference API; serializes requests
└── utils/
    ├── aggregateSample.js   # Pooled plant PDLA + leaf plausibility guard
    ├── makeThumbnail.js     # Canvas downscale to data URL (blob-leak control)
    ├── cropToStencil.js     # Alignment crop encoder (rotate+crop+resample to a fixed size)
    ├── idwInterpolation.js  # IDW orchestrator (spawns worker)
    └── idwWorker.js         # Web Worker for grid computation

backend/
├── inference.py          # TwoStagePipeline — SegFormer phase 1 + 2, PDLA
├── server.py              # FastAPI app, POST /api/analyze, GET /api/health
└── requirements.txt

segfomer_model/
├── deployment_metadata.json         # id2label, disease_class_ids, PDLA formula
├── phase1_leaf_isolation/           # binary leaf/background SegFormer-B1
└── phase2_disease_segmentation/     # 5-class disease SegFormer-B1
```

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

**Neither Camera nor Gallery goes straight to the ML pipeline.** Every picked photo queues through `ImageAlignmentModal` — pan/zoom/rotate (coarse 90° steps plus a continuous ±45° straighten slider) and flip horizontal/vertical the leaf into one static square framing rectangle (matching the SegFormer preprocessor's own 512×512 input shape, so its resize is isotropic), the same shape for every photo, then crop exactly to its boundary — before it becomes a draft image. Inside that rectangle, a dashed vertical guide marks 25% of the frame's width, full height: the on-screen instruction asks the farmer to fit the leaf's widest part to that rail without crossing it, giving a consistent blade-width-to-pixel scale across photos taken at different distances. **The guide is static visual guidance only — nothing detects or enforces whether the leaf actually fits it.** This is what makes `aggregateSample.js`'s pixel-count pooling scale-consistent, not just framing-consistent (see Plant-Level Pooling above); there is no path from either capture method to `/api/analyze` that skips it. A photo only becomes part of the draft, and only then starts analysis, once its crop is confirmed — see `useAlignmentQueue.js`. There is no re-align action: the original file isn't retained past a successful crop, so fixing a bad alignment means removing the photo from the strip and retaking it.

**Location is plant-level and resolved once**, same as before, just timed around the alignment step instead of around selection. The farmer walks around one plant taking several shots, so re-fixing GPS per photo would jitter the pin. For a camera batch, the GPS fix is requested the moment photos are picked (overlapping alignment time, rather than waiting for it) and applied when the first photo of that batch is confirmed. For a gallery batch, EXIF is read from the first *confirmed* photo's original file, not the first *selected* one — skipping a photo in the aligner correctly excludes its EXIF from setting the plant's location. Either way, coordinates already set are never overwritten by a later photo, and a manual edit always wins as the provenance of record (`locationSource: 'manual'`).

Adding a photo **appends** to the current plant — it does not start a new one. "Save Plant" commits the node and clears the draft; "Discard plant" (behind a confirmation dialog) throws it away. Removing the last photo discards the draft too.

**Blob lifetime:** draft photos are `URL.createObjectURL` blobs (the lightbox needs full resolution). On commit they are downscaled to small data URLs via `makeThumbnail.js` and the object URLs are revoked. Object URLs must never outlive a draft — 50 plants × up to 10 full-resolution photos would otherwise stay pinned in memory on the mid-range Android this targets.

## Key Development Commands

```bash
npm run dev      # Start Vite dev server (http://localhost:5173)
npm run build    # Production build
npm run lint     # Run oxlint
npm run preview  # Preview production build
```

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
- **IDW weights every node equally** regardless of how many photos back it. A node from one blurry photo influences the surface as much as one from ten; `leafPixels` is recorded on each sample if this is ever revisited.
- Per-photo `confidence` is a mean softmax posterior over pixels, **not a calibrated probability** that the diagnosis is correct. State that caveat wherever it is surfaced.
- **No guaranteed background margin.** The crop is exactly the static framing rectangle's boundary — unlike the old per-region stencils, there's no separate outer frame structurally guaranteeing background around the leaf regardless of how tightly the user fills the box. Re-measure `leaf_frame_fraction` against real cropped field captures, and be ready to raise `MAX_LEAF_FRAME_FRACTION` if well-aligned photos start approaching it, before either bound is quoted in the thesis.
