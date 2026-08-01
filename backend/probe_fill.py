"""
============================================================
probe_fill.py — Alignment-crop void fill/cap probe (Phase A)
============================================================
Standalone measurement script, NOT imported by the app or the server.
Backs a decision that must NOT be guessed: when the alignment modal's
framing rectangle extends past the source photo (see the coverage gate
in ImageAlignmentModal.jsx / getCropOverflowFraction in
cropToStencil.js), what should the uncovered area be painted with before
the crop reaches Phase 1 — and how much of it can be tolerated?

Two questions, two parts, both against the SAME real pipeline
(get_pipeline in this file's backend.inference), never a re-implemented
approximation of it:

  Part 1 — LEAK. Does a candidate fill get read as "leaf" by Phase 1?
  Take a real aligned photo whose leaf sits well clear of the border,
  paint a ring at the border with each candidate, and diff
  diagnostics.leaf_pixels against the unpadded baseline. A safe fill
  leaks ~0 pixels. The six-row synthetic probe table already in
  CLAUDE.md predicts flat, uniform fills will leak badly (blue sky ->
  0.9997 leaf_frame_fraction, grey concrete -> 0.295) while textured
  fills should not (textured soil -> 0.003) — this part checks that
  prediction against the real checkpoint instead of trusting it.

  Part 2 — CAP. Using Part 1's winning fill, how far can void go before
  severity drifts from the void=0 reference? Simulates "the user zoomed
  out past the edge" by shrinking the photo's own leaf content to occupy
  (1 - void) of a 1024x1024 canvas and padding the rest.

Both parts call pipeline.analyze() through the public API — no reaching
into private methods — so what this script measures is exactly what
`/api/analyze` would return for these composites.

Usage:
    backend/.venv/bin/python backend/probe_fill.py <photo-dir> [model_root]

<photo-dir> must hold REAL aligned field crops (already run through the
app's alignment step; ideally 1024x1024, the shape cropAlignedImage
produces) with the leaf clearly inside the frame, not touching the
border. Synthetic images are not a substitute for this measurement —
see the note in CLAUDE.md attached to the existing probe table about
exactly that limitation.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.inference import get_pipeline, _to_pil  # noqa: E402

# ── Tunables ──────────────────────────────────────────────────────────
VOID_FRACTIONS = [0.0, 0.20, 0.30, 0.35, 0.40, 0.45, 0.50]
RING_FRACTION = 0.20  # Part 1: max per-side ring width, as a fraction of min(H, W)
BORDER_SAFETY_MARGIN = 0.03  # small buffer subtracted from each side's raw margin before capping, so the ring never sits pixel-adjacent to the leaf bbox
MIN_RING_AREA_FRACTION = 0.04  # skip a photo if the total paintable ring area falls under this fraction of the frame
IMAGE_GLOBS = ("*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG")

SOIL_BROWN_RGB = (92, 71, 53)  # matches the "textured soil" probe row's rough hue in CLAUDE.md
NOISE_MEAN_RGB = (90, 70, 50)
NOISE_STD = 18
MIRROR_BLUR_RADIUS = 12


def _fill_flat_black(canvas: np.ndarray, void_mask: np.ndarray) -> None:
    canvas[void_mask] = (0, 0, 0)


def _fill_flat_soil(canvas: np.ndarray, void_mask: np.ndarray) -> None:
    canvas[void_mask] = SOIL_BROWN_RGB


def _fill_soil_noise(canvas: np.ndarray, void_mask: np.ndarray) -> None:
    rng = np.random.default_rng(0)
    noise = rng.normal(loc=NOISE_MEAN_RGB, scale=NOISE_STD, size=(*void_mask.shape, 3))
    canvas[void_mask] = np.clip(noise[void_mask], 0, 255).astype(np.uint8)


def _mirror_pad_to_size(valid_rgb: np.ndarray, valid_rect, H: int, W: int) -> np.ndarray:
    y0, y1, x0, x1 = valid_rect
    pad = ((y0, H - y1), (x0, W - x1), (0, 0))
    try:
        return np.pad(valid_rgb, pad, mode="reflect")
    except ValueError:
        # np.pad's 'reflect' can't pad past (dim - 1) on a single call when
        # the valid region is small relative to the void (large void
        # fractions in Part 2). 'symmetric' has no such limit and looks
        # visually near-identical for this purpose (still self-content,
        # not flat) — fall back rather than fail the run.
        return np.pad(valid_rgb, pad, mode="symmetric")


def _fill_mirror_blur(canvas: np.ndarray, void_mask: np.ndarray, valid_rgb: np.ndarray, valid_rect, H: int, W: int) -> None:
    padded = _mirror_pad_to_size(valid_rgb, valid_rect, H, W)
    blurred = np.asarray(Image.fromarray(padded).filter(ImageFilter.GaussianBlur(radius=MIRROR_BLUR_RADIUS)))
    canvas[void_mask] = blurred[void_mask]


FILLS = {
    "flat_black": lambda canvas, void_mask, valid_rgb, valid_rect, H, W: _fill_flat_black(canvas, void_mask),
    "flat_soil_brown": lambda canvas, void_mask, valid_rgb, valid_rect, H, W: _fill_flat_soil(canvas, void_mask),
    "soil_noise": lambda canvas, void_mask, valid_rgb, valid_rect, H, W: _fill_soil_noise(canvas, void_mask),
    "mirror_blur": _fill_mirror_blur,
}


def compose_with_fill(H: int, W: int, valid_rgb: np.ndarray, valid_rect, fill_name: str) -> np.ndarray:
    """Build an HxWx3 uint8 canvas: `valid_rgb` placed at `valid_rect`
    (y0, y1, x0, x1), everything else painted by `fill_name`. Used by both
    parts — Part 1's "ring around the whole photo" and Part 2's "border
    around a shrunk, centered photo" are the same shape of problem: one
    centered valid rectangle, one fill outside it.
    """
    y0, y1, x0, x1 = valid_rect
    canvas = np.zeros((H, W, 3), dtype=np.uint8)
    canvas[y0:y1, x0:x1] = valid_rgb
    void_mask = np.ones((H, W), dtype=bool)
    void_mask[y0:y1, x0:x1] = False
    FILLS[fill_name](canvas, void_mask, valid_rgb, valid_rect, H, W)
    return canvas


def iter_photos(photo_dir: Path):
    seen = set()
    for pattern in IMAGE_GLOBS:
        for p in sorted(photo_dir.glob(pattern)):
            if p not in seen:
                seen.add(p)
                yield p


def run_part1(pipeline, photos: list[Path]) -> dict[str, list[float]]:
    """Returns {fill_name: [leak_fraction_of_ring_area, ...]} across photos."""
    print("\n=== Part 1 — fill leak (lower |leak| is better; target ~0) ===\n")
    leaks: dict[str, list[float]] = {name: [] for name in FILLS}
    used = 0

    for path in photos:
        # _to_pil (not Image.open().convert("RGB")) so this matches the
        # EXIF-orientation-corrected coordinate space pipeline.analyze()
        # uses internally for crop_bbox_xyxy — otherwise a phone photo's
        # EXIF Orientation tag (rotate 90 for display, sensor buffer stored
        # unrotated) puts the ring in one coordinate space and paints it
        # onto another, landing on real leaf content instead of background.
        pil = _to_pil(path)
        arr = np.array(pil)
        H, W = arr.shape[:2]

        baseline = pipeline.analyze(pil, include_masks=False)
        if baseline.get("status") != "ok":
            print(f"  skip {path.name}: baseline status={baseline.get('status')!r}")
            continue
        bbox = baseline["diagnostics"]["crop_bbox_xyxy"]  # [x0, y0, x1, y1]
        bx0, by0, bx1, by1 = bbox
        L0 = baseline["diagnostics"]["leaf_pixels"]

        # Real photos routinely have ~0 margin on top/bottom (the leaf runs
        # edge to edge there per the app's own framing guidance) — a fixed
        # four-sided ring would skip nearly every real photo for being "too
        # close to the border" on a side where that's correct framing, not a
        # bad photo. Use whatever margin each side actually has instead,
        # capped at RING_FRACTION of the short side, and only skip if the
        # total paintable area that leaves is negligible.
        min_dim = min(H, W)
        ring_cap = round(RING_FRACTION * min_dim)
        safety_px = round(BORDER_SAFETY_MARGIN * min_dim)

        top_ring = min(max(0, by0 - safety_px), ring_cap)
        bottom_ring = min(max(0, (H - by1) - safety_px), ring_cap)
        left_ring = min(max(0, bx0 - safety_px), ring_cap)
        right_ring = min(max(0, (W - bx1) - safety_px), ring_cap)

        valid_rect = (top_ring, H - bottom_ring, left_ring, W - right_ring)
        valid_rgb = arr[top_ring : H - bottom_ring, left_ring : W - right_ring]
        ring_area = H * W - valid_rgb.shape[0] * valid_rgb.shape[1]

        if ring_area / (H * W) < MIN_RING_AREA_FRACTION:
            print(f"  skip {path.name}: paintable margin too thin on every side ({ring_area / (H * W):.1%} of frame)")
            continue

        used += 1
        row = [f"{path.name:<28} baseline L0={L0}"]
        for fill_name in FILLS:
            composed = compose_with_fill(H, W, valid_rgb, valid_rect, fill_name)
            result = pipeline.analyze(Image.fromarray(composed), include_masks=False)
            L1 = result["diagnostics"].get("leaf_pixels", 0)
            leak = L1 - L0
            leak_frac = leak / ring_area if ring_area else float("nan")
            leaks[fill_name].append(leak_frac)
            row.append(f"{fill_name}={leak_frac:+.4f}")
        print("  " + "  ".join(row))

    if used == 0:
        print("\n  No usable photos (leaf too close to the border in all of them). "
              "Re-crop or supply photos with more background margin.")
        return leaks

    print(f"\n  ({used}/{len(photos)} photos usable)\n")
    print(f"  {'fill':<18} {'mean leak frac':>16} {'max |leak frac|':>18}")
    for name, vals in leaks.items():
        if not vals:
            print(f"  {name:<18} {'n/a':>16} {'n/a':>18}")
            continue
        mean = sum(vals) / len(vals)
        worst = max(abs(v) for v in vals)
        print(f"  {name:<18} {mean:>16.4f} {worst:>18.4f}")

    return leaks


def pick_winner(leaks: dict[str, list[float]]) -> str | None:
    scored = [
        (name, max(abs(v) for v in vals))
        for name, vals in leaks.items()
        if vals
    ]
    if not scored:
        return None
    scored.sort(key=lambda t: t[1])
    return scored[0][0]


def run_part2(pipeline, photos: list[Path], fill_name: str) -> None:
    print(f"\n=== Part 2 — void cap, using fill = {fill_name!r} ===\n")
    print(f"  {'photo':<28} " + " ".join(f"void={v:<5.0%}" for v in VOID_FRACTIONS))

    drift_by_void: dict[float, list[float]] = {v: [] for v in VOID_FRACTIONS}
    frame_frac_by_void: dict[float, list[float]] = {v: [] for v in VOID_FRACTIONS}

    for path in photos:
        # _to_pil (not Image.open().convert("RGB")) so this matches the
        # EXIF-orientation-corrected coordinate space pipeline.analyze()
        # uses internally for crop_bbox_xyxy — otherwise a phone photo's
        # EXIF Orientation tag (rotate 90 for display, sensor buffer stored
        # unrotated) puts the ring in one coordinate space and paints it
        # onto another, landing on real leaf content instead of background.
        pil = _to_pil(path)
        arr = np.array(pil)
        H, W = arr.shape[:2]

        severities = []
        frame_fracs = []
        for v in VOID_FRACTIONS:
            if v == 0.0:
                composed = arr
            else:
                scale = (1.0 - v) ** 0.5
                new_h, new_w = max(1, round(H * scale)), max(1, round(W * scale))
                resized = np.array(pil.resize((new_w, new_h), Image.LANCZOS))
                y0 = (H - new_h) // 2
                x0 = (W - new_w) // 2
                valid_rect = (y0, y0 + new_h, x0, x0 + new_w)
                composed = compose_with_fill(H, W, resized, valid_rect, fill_name)

            result = pipeline.analyze(Image.fromarray(composed), include_masks=False)
            diag = result["diagnostics"]
            severities.append(result.get("severity"))
            frame_fracs.append(diag.get("leaf_frame_fraction"))

        ref = severities[0]
        row = [f"{path.name:<28}"]
        for v, sev, ff in zip(VOID_FRACTIONS, severities, frame_fracs):
            drift = None if (sev is None or ref is None) else sev - ref
            if drift is not None:
                drift_by_void[v].append(drift)
            if ff is not None:
                frame_frac_by_void[v].append(ff)
            row.append(f"pdla={sev:>5.1f}(Δ{drift:+.1f}) ff={ff:.3f}" if drift is not None else "n/a")
        print("  " + "  ".join(row))

    print(f"\n  {'void':>6}  {'mean Δpdla':>10}  {'max |Δpdla|':>12}  {'mean leaf_frame_fraction':>26}")
    for v in VOID_FRACTIONS:
        d = drift_by_void[v]
        f = frame_frac_by_void[v]
        mean_d = sum(d) / len(d) if d else float("nan")
        max_d = max(abs(x) for x in d) if d else float("nan")
        mean_f = sum(f) / len(f) if f else float("nan")
        print(f"  {v:>6.0%}  {mean_d:>10.2f}  {max_d:>12.2f}  {mean_f:>26.4f}")

    print(
        "\n  Read the cap off this table, don't hardcode a threshold here: pick the "
        "largest void fraction where mean/max |Δpdla| is still within noise and "
        "leaf_frame_fraction stays clear of MIN_LEAF_FRAME_FRACTION (0.02, "
        "constants.js). Feed that into ALIGN_MAX_OVERFLOW_FRACTION; a fraction a "
        "bit below it into ALIGN_WARN_OVERFLOW_FRACTION."
    )


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)

    photo_dir = Path(sys.argv[1])
    model_root = sys.argv[2] if len(sys.argv) > 2 else None
    if not photo_dir.is_dir():
        print(f"Not a directory: {photo_dir}", file=sys.stderr)
        raise SystemExit(1)

    photos = list(iter_photos(photo_dir))
    if not photos:
        print(f"No images found in {photo_dir} (looked for {', '.join(IMAGE_GLOBS)})", file=sys.stderr)
        raise SystemExit(1)

    print(f"Loading pipeline (model_root={model_root or 'default'}) ...")
    pipeline = get_pipeline(model_root) if model_root else get_pipeline()

    leaks = run_part1(pipeline, photos)
    winner = pick_winner(leaks)
    if winner is None:
        print("\nPart 1 produced no usable measurements — cannot proceed to Part 2. "
              "Supply photos whose leaf sits clear of the border.")
        raise SystemExit(1)

    print(f"\nPart 1 winner (lowest worst-case leak): {winner!r}")
    run_part2(pipeline, photos, winner)


if __name__ == "__main__":
    main()
