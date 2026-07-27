"""
============================================================
FastAPI Server — Rice Leaf Disease Inference API
============================================================
Serves the TwoStagePipeline (backend/inference.py) over HTTP so the
Vite/React app can call it instead of the mock ML service.

Run (from the repo root):
    npm run dev:api

That invokes backend/.venv/bin/uvicorn by explicit path rather than a
bare `uvicorn`, which matters on machines with conda/Anaconda installed:
`conda init` prepends its own bin dir to PATH ahead of any activated
venv, so a plain `uvicorn` can silently resolve to a Python that never
had backend/requirements.txt installed into it — the server appears to
start (or crashes on `import torch`) while never actually using the
project's dependencies.

The Vite dev server proxies /api/* to this process (see vite.config.js),
so src/services/mockMLService.js can call a plain relative path.
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

try:
    from backend.inference import TwoStagePipeline, get_pipeline
except ModuleNotFoundError as exc:
    # The single most common failure mode here: a conda (or other
    # system) Python shadowing backend/.venv on PATH, so uvicorn starts
    # fine but torch/transformers/etc. were never installed into it.
    # sys.executable is the one line that makes this obvious — the
    # original bug report was a bare traceback with no indication of
    # *which* Python was running.
    expected = Path(__file__).resolve().parent.parent / "backend" / ".venv" / "bin" / "python"
    raise RuntimeError(
        "\n\nBackend dependencies not found — you are probably running the wrong Python.\n"
        f"  interpreter: {sys.executable}\n"
        f"  expected:    {expected}\n"
        "Start the server with:  npm run dev:api\n"
        f"(original error: {exc})\n"
    ) from exc

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MODEL_ROOT = "segfomer_model"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load both models once, at process startup, not per-request — this
    # is the whole reason get_pipeline() is a singleton.
    logger.info("Loading SegFormer pipeline from %s ...", MODEL_ROOT)
    get_pipeline(MODEL_ROOT)
    logger.info("Pipeline loaded.")
    yield


app = FastAPI(title="Rice Disease Inference API", lifespan=lifespan)

# Permissive CORS for local dev (Vite on 5173, this server on 8000).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    """Lets the front end distinguish 'backend unreachable' from
    'backend reachable but inference failed' — see src/App.jsx's
    analysisError handling."""
    try:
        pipeline = get_pipeline(MODEL_ROOT)
    except Exception as exc:  # pipeline failed to load at startup
        raise HTTPException(status_code=503, detail=f"Pipeline unavailable: {exc}") from exc
    return {
        "status": "ok",
        "device": str(pipeline.device),
        "disease_labels": [pipeline.id2label[c] for c in pipeline.disease_class_ids],
    }


@app.post("/api/analyze")
async def analyze(image: UploadFile = File(...)):
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file is not an image.")

    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")

    pipeline: TwoStagePipeline = get_pipeline(MODEL_ROOT)

    try:
        # analyze() is CPU/GPU-bound and blocking; run it off the event
        # loop so one slow inference doesn't stall other requests
        # (health checks, concurrent uploads).
        result = await run_in_threadpool(pipeline.analyze, raw)
    except Exception as exc:
        logger.exception("Inference failed")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}") from exc

    return result
