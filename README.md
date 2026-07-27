# Rice Leaf Severity Heatmap

A thesis prototype for **"A Web-Based Rice Disease Detection and Field-Scale Disease Pressure Estimation System Using SegFormer and Spatial Interpolation."** It gives Filipino rice farmers a mobile-first web app to walk a field boundary, photograph individual plants, and get back an interpolated disease-pressure heatmap for the whole field.

## What it does

The app enforces a linear, 3-step workflow:

1. **Draw Boundary** — Draw a closed polygon over Esri satellite imagery to mark the rice field.
2. **Sample Plants** — Capture or upload photos for up to 50 georeferenced plant nodes (one node = one physical plant, which can hold several photos of its leaves). Each photo is sent to a Python inference backend that runs a 2-stage SegFormer pipeline (leaf isolation → disease segmentation) and returns a PDLA (Percent Diseased Leaf Area) severity score. A plant's photos are pooled into a single severity value.
3. **Generate Heatmap** — The sampled severities are interpolated across the rest of the boundary using Inverse Distance Weighting (IDW), rendered as a green → red disease-pressure overlay clipped to the polygon.

Disease classification currently covers 5 classes: `background, healthy_leaf, leaf_blast, brown_spot, bacterial_blight` (no Sheath Blight — limited by the trained checkpoint, not the code).

## Tech stack

| Layer | Choice |
|---|---|
| Front end | Vite + React (JavaScript, no TypeScript) |
| Map | Leaflet.js (`react-leaflet`) + `leaflet-geoman-free`, Esri World Imagery tiles |
| Spatial math | Turf.js (`@turf/turf`) for IDW, point-in-polygon, bbox ops |
| EXIF GPS | `exifreader` |
| Styling | Vanilla CSS, no Tailwind |
| Inference backend | Python + FastAPI, serving two SegFormer-B1 models via PyTorch/Transformers |
| Linter | oxlint |

There is no hosted inference endpoint or authentication — everything runs locally, in-memory, for a single field session per page load.

## Prerequisites

Install these on your local machine before setup:

- **Node.js 20+** (Vite 8 requires a current LTS/active Node; this repo was built against Node 23) and npm (bundled with Node).
- **Python 3.10–3.12** with `venv` support, for the inference backend. (PyTorch does not yet publish wheels for every newer Python release — stick to 3.10–3.12 if you hit install errors.)
- **git**, to clone the repo.
- ~2 GB free disk space for the Python/PyTorch virtual environment, plus the ~100 MB of SegFormer model weights already checked into `segfomer_model/`.
- No API keys are required — map tiles are Esri World Imagery's free tier, and there is no external ML API to configure.

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/KyleNGT/rice-leaf-severity-heatmap.git
cd rice-leaf-severity-heatmap
```

### 2. Install front-end dependencies

```bash
npm install
```

This installs React, react-leaflet, leaflet-geoman-free, Turf.js, exifreader, react-easy-crop, and the Vite/oxlint dev tooling — see `package.json` for exact versions.

### 3. Set up the Python inference backend

Create and populate a virtual environment **inside `backend/`** (the npm scripts expect it at this exact path):

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
```

This installs `torch`, `torchvision`, `transformers`, `safetensors`, `numpy`, `Pillow`, `fastapi`, `uvicorn[standard]`, and `python-multipart`. The trained model weights (`segfomer_model/phase1_leaf_isolation/`, `segfomer_model/phase2_disease_segmentation/`) are already included in the repo — no separate download step is needed.

> **Note on conda/Anaconda:** if you have conda installed, `conda init` prepends its own bin directory to your shell `PATH`, which can shadow the venv you just created — a new terminal tab (or conda re-asserting itself) will silently run the wrong `python`/`uvicorn`, one that never had `backend/requirements.txt` installed. The npm script below sidesteps this by invoking `backend/.venv/bin/uvicorn` directly. If the backend crashes on `import torch` or the front end shows "Cannot reach the analysis server," verify the interpreter directly:
> ```bash
> backend/.venv/bin/python -c "import torch; print(torch.__version__)"
> ```

### 4. Run the app (two terminals)

**Terminal 1 — inference backend:**

```bash
npm run dev:api
```

Starts FastAPI/uvicorn on `http://localhost:8000`, loading both SegFormer models once at startup.

**Terminal 2 — front end:**

```bash
npm run dev
```

Starts the Vite dev server on `http://localhost:5173`. Vite proxies `/api/*` requests through to the backend on port 8000 (see `vite.config.js`), so no CORS/config setup is needed beyond running both processes.

Open `http://localhost:5173` in a browser (or on a phone on the same network) to use the app.

## Other commands

```bash
npm run build     # Production build of the front end
npm run preview   # Preview the production build locally
npm run lint       # Run oxlint
```

## Project structure

```
src/            # React front end (components, hooks, services, utils, constants)
backend/        # FastAPI inference server (server.py, inference.py)
segfomer_model/ # Trained SegFormer-B1 weights + deployment metadata for both stages
```

See `CLAUDE.md` for full architecture notes, IDW parameters, and known prototype limitations.

## Known limitations

- Requires the FastAPI backend running locally — there is no hosted inference endpoint.
- No user authentication or persistence; state is in-memory and resets on page reload.
- No offline tile caching (no Service Worker/PWA).
- IDW computation caps at ~50,000 grid cells for browser performance; max 50 plant nodes and 10 photos per plant per session.
- Phase 1 (leaf isolation) has no negative class, so it cannot reject non-rice-leaf photos outright — see `CLAUDE.md` for the plausibility-guard heuristics used to mitigate this.
