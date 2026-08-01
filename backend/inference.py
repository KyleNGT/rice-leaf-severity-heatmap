"""
============================================================
Two-Stage SegFormer Inference — Rice Leaf Disease Severity
============================================================
Replaces src/services/mockMLService.js's random values with real
model output. Implements the pipeline described in the thesis:

    Phase 1  (phase1_leaf_isolation)       binary leaf / background mask
    Leaf Focus Module (this file, no model) mask -> crop RGB
    Phase 2  (phase2_disease_segmentation)  5-class disease segmentation
    PDLA = 100 * disease_pixels / phase1_leaf_pixels

Class semantics (id2label, disease class ids) are read from the model
configs / deployment_metadata.json at load time rather than hardcoded,
so a future re-trained checkpoint (e.g. adding Sheath Blight) drops in
without touching this file. As shipped, the Phase 2 checkpoint has a
5-class head — background, healthy_leaf, leaf_blast, brown_spot,
bacterial_blight — with no Sheath Blight class.

Deployment notes
-----------------
* Model weights ship with file mode 0600. The serving process must run
  as the file owner, or `from_pretrained` raises PermissionError.
* `analyze()` is blocking (CPU/GPU-bound). From FastAPI, declare the
  route with `def` (not `async def`) so Starlette runs it in the
  threadpool — see backend/server.py.
"""

from __future__ import annotations

import base64
import colorsys
import io
import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageOps
from transformers import AutoImageProcessor, SegformerForSemanticSegmentation

logger = logging.getLogger(__name__)

# Defaults — every one is overridden by deployment_metadata.json / the
# model configs at load time when those files supply a value.
DEFAULT_IMAGE_SIZE = 512
DEFAULT_PADDING_FRACTION = 0.05
DEFAULT_MIN_DISEASE_FRACTION = 0.001
DEFAULT_MAX_SIDE = 2048  # pre-Phase-1 downscale cap (longest edge, px)
DECOMPRESSION_BOMB_PIXELS = 80_000_000

# Longest edge of the Phase 1 / Phase 2 mask previews returned to the UI
# (src/components/MaskInspectorModal.jsx). Every app-produced photo is
# exactly ALIGN_OUTPUT_WIDTH/HEIGHT = 1024x1024 (src/constants/constants.js)
# and DEFAULT_MAX_SIDE (2048) never shrinks it, so `work` below is always
# 1024x1024 in practice. 1024 / 256 = 4 exactly, so NEAREST decimation
# samples a perfectly regular lattice with no moire; 320 or 384 give
# non-integer ratios (3.2 / 2.67) and beat against the leaf's own veins.
# Chosen small deliberately: these are FLAT-COLOR label images, so a 256px
# preview upscaled ~1.3x to a phone-sized pane is visually indistinguishable
# from a native one — there is no quality reason to go larger, only cost.
MASK_PREVIEW_MAX_SIDE = 256

BACKGROUND_TOKENS = ("background", "bg")
HEALTHY_TOKENS = ("healthy",)

# Cosmetic mapping from the model's snake_case labels to the strings the
# UI already displays (see src/services/mockMLService.js's MOCK_DISEASES).
# Unknown labels fall back to a title-cased version of the raw label.
DISPLAY_NAMES = {
    "background": "Background",
    "healthy_leaf": "Healthy",
    "leaf_blast": "Leaf Blast",
    "brown_spot": "Brown Spot",
    "bacterial_blight": "Bacterial Leaf Blight",
}


def _display_name(label: str) -> str:
    return DISPLAY_NAMES.get(label, label.replace("_", " ").title())


# Phase-2 mask-preview palette (MaskInspectorModal.jsx). Flat display colors
# for the shipped 5-class checkpoint, keyed by LABEL — background is instead
# resolved by class id (see _class_palette) since a re-trained checkpoint
# could name it anything. These are display colors ONLY: they encode class
# identity, not severity, and are deliberately unrelated to the green->red
# SES ramp in src/utils/sesScale.js — a red mask region means "this class",
# never "this is severe".
MASK_PALETTE = {
    "healthy_leaf": "#22c55e",       # green
    "leaf_blast": "#3b82f6",         # blue
    "brown_spot": "#f97316",         # orange
    "bacterial_blight": "#e11d48",   # rose
}


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))  # noqa: E203


def _fallback_class_color(class_id: int) -> tuple[int, int, int]:
    """Deterministic color for a class the static MASK_PALETTE doesn't cover
    (e.g. a re-trained checkpoint's new class). Golden-ratio hue walk
    maximally spaces hues for any class count; a fixed high value/saturation
    keeps every fallback color distinct from the fixed background black and
    readable under color-vision deficiency."""
    hue = (class_id * 0.618033988749895) % 1.0
    r, g, b = colorsys.hsv_to_rgb(hue, 0.65, 0.90)
    return (round(r * 255), round(g * 255), round(b * 255))


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def select_device(preferred: str | torch.device | None = None) -> torch.device:
    """cuda > mps > cpu, with an explicit override and an env escape hatch."""
    if preferred is None:
        preferred = os.environ.get("SEGFORMER_DEVICE") or None
    if preferred is not None:
        return torch.device(preferred)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


# ── Image ingestion ──────────────────────────────────────────────────
def _to_pil(image: Any) -> Image.Image:
    """Accept a path, raw bytes, a file-like object, or a PIL Image.

    EXIF orientation is applied first, then mode is coerced to RGB.
    Phone cameras write the sensor buffer unrotated and set an EXIF
    Orientation tag instead; skipping this feeds a sideways leaf to a
    model that is not rotation-invariant, and the bbox/crop downstream
    would be wrong even if segmentation itself partially survives.
    """
    if isinstance(image, Image.Image):
        img = image
    elif isinstance(image, (str, Path)):
        img = Image.open(str(image))
    elif isinstance(image, (bytes, bytearray, memoryview)):
        img = Image.open(io.BytesIO(bytes(image)))
    elif hasattr(image, "read"):
        img = Image.open(image)
    else:
        raise TypeError(f"Unsupported image input type: {type(image)!r}")

    img.load()  # force decode now so a truncated upload fails here, not mid-forward

    w, h = img.size
    if w * h > DECOMPRESSION_BOMB_PIXELS:
        raise ValueError(f"Image too large to process safely: {w}x{h}")

    img = ImageOps.exif_transpose(img) or img
    if img.mode != "RGB":
        img = img.convert("RGB")
    return img


def _downscale(img: Image.Image, max_side: int | None) -> tuple[Image.Image, float]:
    """Cap the image's longest edge. Returns (image, scale = new/original).

    PDLA is a ratio of two pixel counts (disease / leaf), so an isotropic
    downscale by s multiplies both areas by s^2 and cancels out — to
    first order the severity number is scale-invariant. The only
    resolution loss this can introduce is sub-pixel lesions being
    smoothed away by the resize, which biases PDLA slightly downward,
    never upward. The Phase 1 processor squashes every input to 512x512
    regardless, so capping a 4000px photo at 2048px costs Phase 1
    nothing — it just saves memory and resize time. Phase 2 is more
    sensitive (it sees a crop), so keep this cap generous.
    """
    if max_side is None:
        return img, 1.0
    w, h = img.size
    long_side = max(w, h)
    if long_side <= max_side:
        return img, 1.0
    scale = max_side / float(long_side)
    new_size = (max(1, round(w * scale)), max(1, round(h * scale)))
    return img.resize(new_size, Image.BILINEAR), scale


def _encode_png_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _preview_size(w: int, h: int, max_side: int) -> tuple[int, int]:
    """Same longest-edge-cap math as `_downscale`, but on raw dimensions —
    used to size the Phase 1 / Phase 2 mask previews so both always come out
    with IDENTICAL dimensions regardless of which array is resized first."""
    long_side = max(w, h)
    if long_side <= max_side:
        return w, h
    scale = max_side / float(long_side)
    return max(1, round(w * scale)), max(1, round(h * scale))


# ── Leaf Focus Module (pure numpy, no model) ────────────────────────
def _mask_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    """Tight bbox of a boolean mask as (y0, y1, x0, x1), y1/x1 exclusive."""
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    y0, y1 = np.flatnonzero(rows)[[0, -1]]
    x0, x1 = np.flatnonzero(cols)[[0, -1]]
    return int(y0), int(y1) + 1, int(x0), int(x1) + 1


def _pad_bbox(
    bbox: tuple[int, int, int, int], height: int, width: int, fraction: float
) -> tuple[int, int, int, int]:
    """Expand per-axis by `fraction` of that axis' own extent, clamped to
    the image bounds. deployment_metadata.json's leaf_crop_padding_fraction
    (0.05) doesn't specify a basis; per-axis is the most conservative
    reading. If your training/eval script padded by a shared max(h, w)
    basis instead, change `span` here to match — a rice leaf is long and
    thin, so the two conventions diverge noticeably on the short axis.
    """
    y0, y1, x0, x1 = bbox
    pad_y = round(fraction * (y1 - y0))
    pad_x = round(fraction * (x1 - x0))
    return (
        max(0, y0 - pad_y),
        min(height, y1 + pad_y),
        max(0, x0 - pad_x),
        min(width, x1 + pad_x),
    )


class TwoStagePipeline:
    """Loads both SegFormer stages once and serves repeated `analyze()`
    calls. Construct a single instance per process (see `get_pipeline`)
    and share it — instances are safe to call from multiple threads."""

    def __init__(
        self,
        model_root: str | Path,
        device: str | torch.device | None = None,
        max_side: int | None = DEFAULT_MAX_SIDE,
    ) -> None:
        self.model_root = Path(model_root).expanduser().resolve()
        if not self.model_root.is_dir():
            raise FileNotFoundError(f"model_root does not exist: {self.model_root}")

        self.device = select_device(device)
        self.max_side = max_side
        # Serializes device work. A forward pass under inference_mode is
        # in principle reentrant, but (a) MPS's command-buffer submission
        # has had thread-safety issues under concurrent Python threads,
        # (b) two forwards on one accelerator don't run any faster than
        # sequential ones, and (c) this app posts one photo at a time.
        self._lock = threading.Lock()

        self.metadata = _read_json(self.model_root / "deployment_metadata.json")

        self.p1_processor, self.p1_model = self._load_stage(
            self.model_root / "phase1_leaf_isolation"
        )
        self.p2_processor, self.p2_model = self._load_stage(
            self.model_root / "phase2_disease_segmentation"
        )

        self._resolve_class_semantics()
        self._check_processor_geometry()
        self._warmup()

        logger.info(
            "TwoStagePipeline ready | device=%s | leaf_ids=%s | disease_ids=%s | labels=%s",
            self.device, self.leaf_class_ids, self.disease_class_ids, self.id2label,
        )

    # ── loading ──────────────────────────────────────────────────
    def _load_stage(self, path: Path):
        if not path.is_dir():
            raise FileNotFoundError(f"Missing model directory: {path}")

        # preprocessor_config.json ships a contradictory pair:
        #   "do_reduce_labels": false  AND  "reduce_labels": true (deprecated
        # alias). This only affects ground-truth label maps passed via
        # `segmentation_maps=`, which we never do — so it's inert for
        # inference — but pin it False explicitly so a future eval script
        # that reuses this processor can't silently shift every class id
        # down by one.
        try:
            processor = AutoImageProcessor.from_pretrained(path, do_reduce_labels=False)
        except TypeError:
            processor = AutoImageProcessor.from_pretrained(path)
        for attr in ("do_reduce_labels", "reduce_labels"):
            if hasattr(processor, attr):
                try:
                    setattr(processor, attr, False)
                except Exception:
                    logger.debug("Could not pin %s on %s", attr, type(processor).__name__)

        model = SegformerForSemanticSegmentation.from_pretrained(path)
        model.to(self.device)
        model.float()
        model.eval()
        model.requires_grad_(False)
        return processor, model

    def _check_processor_geometry(self) -> None:
        # config.json says image_size: 224 — a stale architecture default
        # inherited from the base checkpoint, not used at inference. The
        # processor's size dict (512x512) is what the models were
        # fine-tuned at and what actually governs; only warn on mismatch.
        expected = int(self.metadata.get("image_size", DEFAULT_IMAGE_SIZE))
        for name, proc in (("phase1", self.p1_processor), ("phase2", self.p2_processor)):
            size = getattr(proc, "size", None) or {}
            got = size.get("height") or size.get("shortest_edge")
            if got is not None and int(got) != expected:
                logger.warning("%s processor size %s != metadata image_size %s", name, got, expected)
        self.image_size = expected

    def _resolve_class_semantics(self) -> None:
        """Derive every class id from the configs + metadata — nothing
        hardcoded, so a re-trained checkpoint (e.g. 6 classes with Sheath
        Blight) drops in with zero code changes."""
        cfg_id2label = getattr(self.p2_model.config, "id2label", None) or {}
        id2label = {int(k): str(v) for k, v in cfg_id2label.items()}

        if not id2label or all(v.startswith("LABEL_") for v in id2label.values()):
            id2label = {int(k): str(v) for k, v in (self.metadata.get("id2label") or {}).items()}
        if not id2label:
            raise RuntimeError("Cannot resolve id2label for phase 2 from config or metadata.")

        n2 = int(self.p2_model.config.num_labels)
        if len(id2label) != n2:
            raise RuntimeError(
                f"id2label has {len(id2label)} entries but the phase-2 classifier "
                f"emits {n2} channels; refusing to guess the mapping."
            )

        self.id2label = id2label
        self.background_id = self._find_id(BACKGROUND_TOKENS, default=0)
        self.healthy_id = self._find_id(HEALTHY_TOKENS, default=None, exclude={self.background_id})

        # Phase 1 has no id2label at all (bare binary head). Treat every
        # non-background channel as leaf — {1} today, and still correct
        # if a future Phase 1 adds more foreground classes.
        n1 = int(self.p1_model.config.num_labels)
        if n1 < 2:
            raise RuntimeError(f"Phase 1 must emit >= 2 classes, got {n1}")
        self.leaf_class_ids = [i for i in range(n1) if i != self.background_id]

        meta_ids = self.metadata.get("disease_class_ids")
        derived = [
            i for i, lbl in id2label.items()
            if i != self.background_id and not any(tok in lbl.lower() for tok in HEALTHY_TOKENS)
        ]
        if isinstance(meta_ids, Sequence) and meta_ids and set(map(int, meta_ids)) <= set(id2label):
            disease_ids = sorted(int(i) for i in meta_ids)
            if set(disease_ids) != set(derived):
                logger.warning(
                    "deployment_metadata disease_class_ids=%s differs from name-derived %s; using metadata.",
                    disease_ids, sorted(derived),
                )
        else:
            logger.warning("disease_class_ids missing/stale in metadata; derived %s", sorted(derived))
            disease_ids = sorted(derived)
        if not disease_ids:
            raise RuntimeError("No disease classes could be resolved.")
        self.disease_class_ids = disease_ids

        # Mask-preview palette (MaskInspectorModal.jsx). Resolved from
        # id2label so a re-trained checkpoint's classes always get a
        # legible, distinct color with zero code changes here — see
        # MASK_PALETTE's docstring.
        self.mask_palette: dict[int, tuple[int, int, int]] = {}
        for cid, lbl in self.id2label.items():
            if cid == self.background_id:
                self.mask_palette[cid] = (0, 0, 0)
            elif lbl in MASK_PALETTE:
                self.mask_palette[cid] = _hex_to_rgb(MASK_PALETTE[lbl])
            else:
                self.mask_palette[cid] = _fallback_class_color(cid)

        # Flat 768-int table for PIL's `Image.putpalette` (256 entries x
        # RGB), unused entries left black.
        flat = [0] * 768
        for cid, (r, g, b) in self.mask_palette.items():
            flat[cid * 3 : cid * 3 + 3] = [r, g, b]
        self._mask_palette_flat = flat

        self.mask_palette_hex = {
            lbl: "#{:02x}{:02x}{:02x}".format(*self.mask_palette[cid])
            for cid, lbl in self.id2label.items()
        }

        self.padding_fraction = float(
            self.metadata.get("leaf_crop_padding_fraction", DEFAULT_PADDING_FRACTION)
        )
        self.min_disease_fraction = float(
            self.metadata.get("minimum_disease_fraction", DEFAULT_MIN_DISEASE_FRACTION)
        )
        # mask_threshold (127) is a training-time convention for
        # binarizing 8-bit PNG masks (>127 -> foreground). At inference we
        # argmax instead, equivalent to P(leaf) > 0.5 for a 2-class head
        # (127/255 = 0.498, differs only by rounding). Recorded for
        # provenance; deliberately unused below.
        self.mask_threshold = int(self.metadata.get("mask_threshold", 127))

    def _find_id(self, tokens: Iterable[str], default, exclude: set[int] | None = None):
        exclude = exclude or set()
        for idx, label in self.id2label.items():
            if idx not in exclude and any(tok in label.lower() for tok in tokens):
                return idx
        return default

    def _warmup(self) -> None:
        dummy = Image.new("RGB", (self.image_size, self.image_size), (24, 96, 24))
        try:
            # include_masks=False: the warmup dummy is a flat green square,
            # which per this file's leaf-plausibility probe table gets
            # masked edge-to-edge with high confidence — so without this it
            # really would pay the full mask-encode cost on every startup.
            self.analyze(dummy, include_masks=False)
        except Exception as exc:  # never let warmup block startup
            logger.warning("Warmup pass failed (continuing): %s", exc)

    # ── core forward ─────────────────────────────────────────────
    def _segment(self, processor, model, pil_image, target_hw):
        """Run one stage, returning (labels uint8 [H,W], winning_prob float32 [H,W])
        at `target_hw`.

        Shapes: pixel_values [1,3,512,512] -> logits [1,C,128,128]
        (stride-4 decode head) -> upsampled [1,C,H,W] -> probs -> argmax.
        """
        height, width = target_hw
        encoded = processor(images=pil_image, return_tensors="pt")
        pixel_values = encoded["pixel_values"].to(self.device, dtype=torch.float32)

        with self._lock, torch.inference_mode():
            logits = model(pixel_values=pixel_values).logits

            # THE critical step: SegFormer's decode head emits logits at
            # 1/4 of the input resolution. We upsample the CONTINUOUS
            # logits to the true image size and only then argmax.
            # Doing it the other way (argmax at 128x128, then
            # nearest-resize the label map) quantizes every mask boundary
            # to a 4x-coarse grid, which corrupts the pixel counts PDLA
            # is computed from — lesions are small and numerous, so their
            # perimeter/area ratio is high and this error dominates.
            logits = F.interpolate(
                logits.float(), size=(height, width), mode="bilinear", align_corners=False
            )
            probs = torch.softmax(logits, dim=1)
            del logits
            win_prob_t, labels_t = probs.max(dim=1)
            del probs

            labels = labels_t[0].to(torch.uint8).cpu().numpy()
            win_prob = win_prob_t[0].to(torch.float32).cpu().numpy()

        return labels, win_prob

    # ── public API ───────────────────────────────────────────────
    def analyze(self, image: Any, *, include_masks: bool = True) -> dict:
        """Run the full two-stage pipeline on one image.

        `image` may be a filesystem path, raw bytes, a file-like object,
        or a PIL Image. Returns a JSON-serializable dict whose top-level
        keys match the contract src/services/mockMLService.js already
        defines, plus a `diagnostics` block for thesis write-up.

        `include_masks` (default True) controls whether the Phase 1 / Phase
        2 mask previews (`masks` key, MaskInspectorModal.jsx) are built.
        Default True keeps backend/server.py's
        `run_in_threadpool(pipeline.analyze, raw)` call unchanged — Starlette
        forwards positional args only, so a False default would force a
        functools.partial/lambda there for no benefit. Keyword-only so it
        can never be passed positionally where `image` goes. `_warmup` below
        and backend/probe_fill.py pass include_masks=False since they only
        care about the numeric measurement.
        """
        original = _to_pil(image)
        orig_w, orig_h = original.size
        work, scale = _downscale(original, self.max_side)
        work_w, work_h = work.size

        # ── Phase 1: leaf isolation ──
        # p1_prob is kept (it used to be discarded) so the response can carry
        # a "does this even look like a leaf" signal. The only leaf check the
        # API had was leaf_pixels == 0, which fires solely when Phase 1
        # segments literally nothing — a photo of soil or a hand usually still
        # produces a partial mask and would sail through with a spurious PDLA.
        p1_labels, p1_prob = self._segment(self.p1_processor, self.p1_model, work, (work_h, work_w))
        leaf_mask = np.isin(p1_labels, self.leaf_class_ids)
        leaf_pixels = int(np.count_nonzero(leaf_mask))

        if leaf_pixels == 0:
            return self._no_leaf_result(orig_w, orig_h, work_w, work_h, scale)

        # ── Leaf Focus Module ──
        rgb = np.asarray(work, dtype=np.uint8)
        masked_rgb = rgb * leaf_mask[:, :, None]
        tight = _mask_bbox(leaf_mask)
        y0, y1, x0, x1 = _pad_bbox(tight, work_h, work_w, self.padding_fraction)

        crop_rgb = masked_rgb[y0:y1, x0:x1]
        crop_mask = leaf_mask[y0:y1, x0:x1]
        crop_h, crop_w = crop_mask.shape
        crop_pil = Image.fromarray(crop_rgb, mode="RGB")

        # Invariant: the crop is bbox(mask), padded and clamped, so it
        # contains every mask pixel by construction — the cropped leaf
        # count must equal the full-image count. Assert rather than
        # assume: this breaks the moment mask post-processing (largest
        # connected component, morphological opening) is inserted between
        # the count and the bbox.
        crop_leaf_pixels = int(np.count_nonzero(crop_mask))
        if crop_leaf_pixels != leaf_pixels:
            logger.error(
                "Leaf pixel count changed across the crop (%d -> %d); PDLA numerator/denominator "
                "are no longer in the same frame.", leaf_pixels, crop_leaf_pixels,
            )

        # ── Phase 2: disease segmentation ──
        p2_labels, p2_prob = self._segment(self.p2_processor, self.p2_model, crop_pil, (crop_h, crop_w))

        # Restrict to the Phase-1 leaf so background/padding can never be
        # counted as disease. Applied after argmax: a genuine leaf pixel
        # keeps its predicted class, everything outside is forced to
        # background. Consequence: disease_pixels <= leaf_pixels always,
        # so PDLA is bounded by 100% by construction.
        restricted = np.where(crop_mask, p2_labels, self.background_id).astype(np.uint8)

        class_pixels = {int(cid): int(np.count_nonzero(restricted == cid)) for cid in self.id2label}
        disease_pixels = int(sum(class_pixels[cid] for cid in self.disease_class_ids))
        disease_fraction = disease_pixels / leaf_pixels
        pdla_raw = 100.0 * disease_fraction

        detected = disease_fraction >= self.min_disease_fraction
        if detected:
            winner = max(
                self.disease_class_ids,
                key=lambda cid: (class_pixels[cid], self._mean_conf(p2_prob, restricted, cid), -cid),
            )
            severity = round(min(100.0, max(0.0, pdla_raw)), 2)
        else:
            # Sub-threshold speckle — report healthy, not a near-zero
            # severity, so it doesn't get treated as measured disease.
            winner = self.healthy_id if self.healthy_id is not None else self.background_id
            severity = 0.0

        confidence = self._confidence(p2_prob, restricted, winner, crop_mask)
        label = self.id2label.get(winner, "unknown")
        name = _display_name(label) if detected else "Healthy"

        # Leaf-plausibility signals. Both are only meaningful past the
        # leaf_pixels == 0 early return above, so leaf_mask is never empty
        # here and the mean is never over an empty slice.
        leaf_frame_fraction = leaf_pixels / float(work_w * work_h)
        leaf_mask_confidence = float(p1_prob[leaf_mask].mean())

        disease_labels = [self.id2label[c] for c in self.disease_class_ids]

        masks = None
        if include_masks:
            # A PNG-encode bug here must never turn a valid measurement
            # into a 500 — runAnalysis (src/App.jsx) would surface that as
            # "Analysis failed" and drop an otherwise-good photo out of the
            # plant's PDLA. The frontend already treats masks: null as
            # simply "no inspector button for this photo".
            try:
                masks = self._build_mask_previews(leaf_mask, restricted, (y0, y1, x0, x1), work_h, work_w)
            except Exception:
                logger.exception("Mask preview encoding failed; returning result without previews.")

        inv = 1.0 / scale if scale else 1.0
        return {
            # Contract consumed by src/services/mockMLService.js
            "diseaseDetected": bool(detected),
            "severity": float(severity),
            "diseaseName": name,
            "confidence": f"{confidence:.4f}",
            # Structured extras
            "status": "ok",
            "diseaseLabel": label if detected else "healthy_leaf",
            "diseaseClassId": int(winner),
            # Phase 1 / Phase 2 mask preview images for MaskInspectorModal.jsx
            # (src/components/). A display artifact, NOT diagnostic data —
            # None when include_masks=False or on encode failure. Kept as a
            # top-level sibling of `diagnostics` rather than nested inside
            # it: `diagnostics` is thesis write-up material read for pixel
            # counts, and this is ~10 KB of base64 that doesn't belong there.
            "masks": masks,
            "diagnostics": {
                "pdla_percent_raw": round(float(pdla_raw), 4),
                "pdla_formula": self.metadata.get(
                    "pdla_formula", "100 * disease_pixels / phase1_leaf_pixels"
                ),
                "leaf_pixels": leaf_pixels,
                "leaf_pixels_in_crop": crop_leaf_pixels,
                "disease_pixels": disease_pixels,
                "disease_fraction": round(float(disease_fraction), 6),
                "minimum_disease_fraction": self.min_disease_fraction,
                "gated_as_healthy": bool(not detected and disease_pixels > 0),
                "class_pixels": {self.id2label[c]: n for c, n in class_pixels.items()},
                # Which class_pixels keys count as disease, and how to name
                # them. Sent per-response rather than hardcoded client-side so
                # a re-trained Phase 2 with different classes still drops in
                # without a front-end change.
                "disease_labels": disease_labels,
                "disease_display_names": {lbl: _display_name(lbl) for lbl in disease_labels},
                # Leaf plausibility. Thresholds deliberately live in the front
                # end (src/constants/constants.js) so they can be tuned without
                # restarting a process that loads two SegFormers.
                "leaf_frame_fraction": round(leaf_frame_fraction, 6),
                "leaf_mask_confidence": round(leaf_mask_confidence, 4),
                "confidence_definition": (
                    "mean softmax posterior of the reported class over the leaf "
                    "pixels predicted as that class"
                ),
                # Reported in ORIGINAL image coordinates so the UI can
                # overlay the crop box on the file the user actually
                # uploaded, not the internally-downscaled working copy.
                "crop_bbox_xyxy": [
                    round(x0 * inv), round(y0 * inv), round(x1 * inv), round(y1 * inv)
                ],
                "original_size_wh": [orig_w, orig_h],
                "downscale_factor": round(float(scale), 6),
                "device": str(self.device),
            },
        }

    # ── confidence ───────────────────────────────────────────────
    @staticmethod
    def _mean_conf(win_prob: np.ndarray, labels: np.ndarray, class_id: int) -> float:
        sel = labels == class_id
        if not sel.any():
            return 0.0
        return float(win_prob[sel].mean())

    def _confidence(self, win_prob, labels, winner, crop_mask) -> float:
        """Confidence := mean softmax posterior of the reported class,
        taken over exactly the leaf pixels the model assigned to that
        class. Chosen over alternatives because it (a) is read straight
        off the softmax with no calibration or free parameters, (b)
        degrades honestly — a lesion the model is torn on yields ~0.5,
        not 0.99, and (c) mean-over-all-pixels is dominated by the vast,
        trivially-easy background area and pins near 1.0 uninformatively.
        This is a mean posterior over pixels, NOT a calibrated
        probability that the diagnosis is correct — state that caveat
        wherever this number is surfaced.
        """
        sel = labels == winner
        if sel.any():
            return float(win_prob[sel].mean())
        # Reachable only when the disease gate forced "healthy" but Phase
        # 2 labeled nothing as healthy (e.g. a few sub-threshold lesion
        # pixels on an otherwise background-predicted leaf). Fall back to
        # the mean posterior over the leaf so this never divides by zero
        # / means over an empty slice (which would produce NaN -> invalid
        # JSON -> a poisoned IDW grid).
        if crop_mask.any():
            return float(win_prob[crop_mask].mean())
        return 0.0

    # ── mask previews (MaskInspectorModal.jsx) ──────────────────────
    def _build_mask_previews(
        self,
        leaf_mask: np.ndarray,
        restricted: np.ndarray,
        bbox: tuple[int, int, int, int],
        work_h: int,
        work_w: int,
    ) -> dict:
        """Encode the Phase 1 leaf mask and Phase 2 disease mask as small
        PNG data URLs, co-registered onto the same WORK-space pixel grid as
        the original photo the user aligned. `restricted` (id2label ids,
        CROP space, background-masked — see `analyze()`) is pasted back into
        a full WORK-space canvas so all three panes the UI shows share one
        coordinate system and overlay 1:1; the original crop offsets are
        used directly rather than the `crop_bbox_xyxy` reported in
        `diagnostics`, which is rescaled to ORIGINAL coordinates and rounded
        for that different purpose and would drift a pixel per edge here.

        NEAREST is not a quality choice — it is required for correctness.
        Class ids are NOMINAL, not ordinal: any interpolating resize
        (bilinear/bicubic/lanczos) averages ids, e.g. blending id 2
        (leaf_blast) with id 4 (bacterial_blight) produces id 3
        (brown_spot) along every lesion boundary — a diagnosis the model
        never made, painted directly onto the one view whose entire purpose
        is showing what it actually predicted.

        Coordinate note: pane 1 (the aligned photo the caller already has
        as `image.thumbnail`) is only pixel-identical to this WORK array
        because every photo reaching /api/analyze is a Canvas2D crop from
        cropToStencil.js carrying no EXIF tag, so `_to_pil`'s
        exif_transpose is a no-op and `work` == the client's blob. That is
        a property of the mandatory alignment step, not a guarantee this
        method makes on its own — it would silently stop holding for any
        caller that posts a raw camera file directly.
        """
        y0, y1, x0, x1 = bbox
        size = _preview_size(work_w, work_h, MASK_PREVIEW_MAX_SIDE)

        leaf_png = Image.fromarray(np.where(leaf_mask, 255, 0).astype(np.uint8), mode="L")
        leaf_png = leaf_png.resize(size, Image.NEAREST).convert("1", dither=Image.Dither.NONE)

        full_labels = np.full((work_h, work_w), self.background_id, dtype=np.uint8)
        full_labels[y0:y1, x0:x1] = restricted
        disease_png = Image.fromarray(full_labels, mode="P")
        disease_png.putpalette(self._mask_palette_flat)
        disease_png = disease_png.resize(size, Image.NEAREST)

        class_order = sorted(self.id2label)
        return {
            "leaf": _encode_png_data_url(leaf_png),
            "disease": _encode_png_data_url(disease_png),
            "size_wh": [size[0], size[1]],
            "source_size_wh": [work_w, work_h],
            "class_order": [self.id2label[c] for c in class_order],
            "palette": dict(self.mask_palette_hex),
            "class_names": {lbl: _display_name(lbl) for lbl in self.mask_palette_hex},
            "leaf_color": "#ffffff",
        }

    def _no_leaf_result(self, ow, oh, ww, wh, scale) -> dict:
        """Phase 1 found nothing. Distinct status so the UI can ask for a
        retake instead of recording a 0% sample — a false 0 would drag
        the IDW surface down over what may be a real hotspot."""
        return {
            "diseaseDetected": False,
            "severity": 0.0,
            "diseaseName": "No Leaf Detected",
            "confidence": "0.0000",
            "status": "no_leaf_detected",
            "diseaseLabel": None,
            "diseaseClassId": None,
            # None, not an empty object or an all-black image: on this path
            # there is no crop and no measurement at all, matching the
            # neighboring None fields above — see the "same key set on both
            # paths" contract in this dict's own comments.
            "masks": None,
            "diagnostics": {
                "leaf_pixels": 0,
                "disease_pixels": 0,
                # Same key set as the ok path where it costs nothing, so a
                # client aggregating over a mixed batch can't trip over a
                # missing key. Consumers must still branch on `status` — the
                # zeroes here mean "no measurement", not "measured zero".
                "class_pixels": {},
                "disease_labels": [self.id2label[c] for c in self.disease_class_ids],
                "leaf_frame_fraction": 0.0,
                "leaf_mask_confidence": 0.0,
                "message": "Phase 1 segmented no leaf pixels; PDLA is undefined (zero denominator).",
                "original_size_wh": [ow, oh],
                "analysis_size_wh": [ww, wh],
                "downscale_factor": round(float(scale), 6),
                "device": str(self.device),
            },
        }


# ── Process-wide singleton ──────────────────────────────────────────
_PIPELINE: TwoStagePipeline | None = None
_PIPELINE_LOCK = threading.Lock()


def get_pipeline(model_root: str | Path | None = None, **kwargs) -> TwoStagePipeline:
    """Double-checked-locking singleton — under uvicorn's threadpool, a
    naive lazy-init can be entered by several threads at once and load
    ~104 MB of weights more than once."""
    global _PIPELINE
    if _PIPELINE is None:
        with _PIPELINE_LOCK:
            if _PIPELINE is None:
                root = model_root or os.environ.get("SEGFORMER_MODEL_ROOT", "segfomer_model")
                _PIPELINE = TwoStagePipeline(root, **kwargs)
    return _PIPELINE


if __name__ == "__main__":
    # CLI smoke test: python -m backend.inference <image_path> [model_root]
    import sys

    logging.basicConfig(level=logging.INFO)
    if len(sys.argv) < 2:
        print("Usage: python -m backend.inference <image_path> [model_root]", file=sys.stderr)
        raise SystemExit(1)

    image_path = sys.argv[1]
    root = sys.argv[2] if len(sys.argv) > 2 else "segfomer_model"
    pipeline = TwoStagePipeline(root)
    result = pipeline.analyze(image_path)
    print(json.dumps(result, indent=2))
