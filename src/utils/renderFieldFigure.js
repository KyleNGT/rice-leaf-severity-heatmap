import { sesToColor, sampleSesForLayer } from './sesScale';
import { renderSesGridToCanvas } from './heatmapRaster';
import { ESRI_TILE_URL, ESRI_ATTRIBUTION, ESRI_MAX_NATIVE_ZOOM } from '../constants/constants';

/**
 * ============================================================
 * renderFieldFigure — Offscreen map figure for the PDF report
 * ============================================================
 * Composites Esri satellite tiles + one SES heatmap layer + the field
 * boundary + numbered sample pins into a single PNG, entirely offscreen —
 * there is no Leaflet map ref available from App.jsx (see CLAUDE.md), and
 * screenshotting the live map would tie the export to whatever the user
 * happened to be looking at. Esri's tile endpoint sends
 * `Access-Control-Allow-Origin: *` (verified against the live server),
 * which is what makes `crossOrigin: 'anonymous'` tiles paintable onto a
 * canvas that can still be read back with `toDataURL()`.
 *
 * Vector elements (boundary, pins) are placed in true Web Mercator, matching
 * the tiles exactly. The heatmap raster itself comes from heatmapRaster.js,
 * which paints in LINEAR lat/lng space — the same simplification
 * `L.imageOverlay` already relies on for the on-screen map (it stretches
 * that linear raster into a Mercator-projected rectangle). At the field
 * sizes this app targets (tens to a few hundred meters), the chord error
 * between linear and true Mercator latitude is on the order of 1e-3 px —
 * imperceptible — so drawing the raster stretched into the Mercator bbox
 * rect reproduces the on-screen appearance with no visible seam.
 *
 * Never throws and never rejects: any failure (network, CORS taint, a
 * degenerate boundary) still returns a usable PNG, at minimum a plain
 * background with the heatmap/boundary/pins burned in — an offline export
 * must still produce a report.
 */

const TILE_SIZE = 256;
/** Mercator's own latitude limit — y diverges at the poles. Matches
 * Leaflet's EPSG3857 bounds, so anything Leaflet can render projects
 * identically here. */
const MAX_MERC_LAT = 85.0511287798066;

/** Below this span (~5.5 m), treat the boundary as a point and pad it out
 * so a degenerate polygon still produces a figure instead of dividing by
 * zero in the zoom/frame solve. */
const MIN_SPAN_DEG = 5e-5;

/** Hard cap on tiles fetched for one figure — this app's fields are small
 * (a handful of tiles at most), so this only guards against a pathological
 * boundary ever firing hundreds of requests. */
const MAX_TILES = 64;

const TILE_CONCURRENCY = 6;
const TILE_TIMEOUT_MS = 4000;
/** Whole-mosaic wall-clock budget — bounds how long the Export button can
 * hang waiting on tiles before falling back to a plain background. Shared
 * across every zoom step-down attempt below, not per-attempt, so a field
 * stuck retrying can't multiply the export's total wait time. */
const TILE_BUDGET_MS = 8000;

const BACKGROUND_FILL = '#e5e7eb'; // --border-subtle, reads as "no imagery"

/**
 * Esri serves a real, decodable JPEG for a coordinate with no imagery at the
 * requested zoom — a flat grey "Map data not yet available" placeholder —
 * rather than a 404. `loadTile` can't tell it apart from a real tile (both
 * resolve with `naturalWidth > 0`), so a naive clamp to ESRI_MAX_NATIVE_ZOOM
 * (which is only a global rule of thumb — real coverage varies by region,
 * see the constant's own doc comment) can end up compositing this
 * placeholder as if it were satellite imagery: technically "drawn", but
 * reads to the user as "satellite imagery unavailable" all the same.
 *
 * Measured against the live tile server: the placeholder is essentially a
 * single flat grey fill (~204,204,204) covering ~94% of the tile, the rest
 * being small white caption text — a signature real aerial imagery (varied
 * colors, structures, vegetation) practically never produces. Sampling a
 * downscaled grid and checking what fraction of pixels are near-neutral and
 * in that narrow grey band is enough to tell the two apart.
 */
const PLACEHOLDER_SAMPLE_SIZE = 32;
const PLACEHOLDER_GREY_MIN = 195;
const PLACEHOLDER_GREY_MAX = 215;
const PLACEHOLDER_CHROMA_TOL = 6;
const PLACEHOLDER_PIXEL_FRACTION = 0.8;
/** If at least half of a zoom level's loaded tiles are the placeholder,
 * that level isn't usable — step the whole mosaic down one zoom (same
 * upscale-the-last-real-tile trick the live map does via maxNativeZoom,
 * just walked down further until real coverage is found) rather than
 * accepting a mosaic that's mostly "unavailable" grey. */
const PLACEHOLDER_TILE_FRACTION_THRESHOLD = 0.5;
/** Esri's global World Imagery base mosaic has real (if coarse) coverage
 * everywhere by this level — an absolute floor so a pathological run of
 * placeholders can't step the zoom down forever. */
const PLACEHOLDER_FLOOR_ZOOM = 8;

function worldX(lng, worldSize) {
  return ((lng + 180) / 360) * worldSize;
}

function worldY(lat, worldSize) {
  const clamped = Math.max(-MAX_MERC_LAT, Math.min(MAX_MERC_LAT, lat));
  const phi = (clamped * Math.PI) / 180;
  const s = Math.sin(phi);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize;
}

/**
 * Chooses a zoom level and a projector function that fits the boundary ring
 * into the content box (the figure minus margins), centered, aspect
 * preserved, in true Web Mercator.
 */
function buildFrame({ ring, width, height, margin, maxZoom }) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (maxLng - minLng < MIN_SPAN_DEG) {
    const c = (minLng + maxLng) / 2;
    minLng = c - MIN_SPAN_DEG / 2;
    maxLng = c + MIN_SPAN_DEG / 2;
  }
  if (maxLat - minLat < MIN_SPAN_DEG) {
    const c = (minLat + maxLat) / 2;
    minLat = c - MIN_SPAN_DEG / 2;
    maxLat = c + MIN_SPAN_DEG / 2;
  }

  const contentW = Math.max(1, width - 2 * margin);
  const contentH = Math.max(1, height - 2 * margin);

  // Boundary extent as a fraction of the whole Mercator world — zoom-free,
  // so picking z is a closed-form step rather than a search.
  const fx = (maxLng - minLng) / 360;
  const fy = worldY(minLat, 1) - worldY(maxLat, 1);

  // Smallest integer zoom whose native tile pixels are at least as dense as
  // the output. ceil (not round) so tiles are downscaled, never upscaled,
  // when a choice is available — downscaling stays sharp. Clamped to
  // ESRI_MAX_NATIVE_ZOOM: past that Esri serves a placeholder, not imagery.
  const needWorldPx = Math.max(contentW / fx, contentH / fy);
  const z = Math.max(0, Math.min(maxZoom, Math.ceil(Math.log2(needWorldPx / TILE_SIZE))));
  const worldSize = TILE_SIZE * 2 ** z;

  const wx0 = worldX(minLng, worldSize);
  const wx1 = worldX(maxLng, worldSize);
  const wy0 = worldY(maxLat, worldSize); // north edge → smaller Y
  const wy1 = worldY(minLat, worldSize);

  // Fit the boundary rect into the content box, aspect preserved, centered.
  const k = Math.min(contentW / (wx1 - wx0), contentH / (wy1 - wy0));
  const offsetX = margin + (contentW - (wx1 - wx0) * k) / 2;
  const offsetY = margin + (contentH - (wy1 - wy0) * k) / 2;

  const project = (lng, lat) => [
    (worldX(lng, worldSize) - wx0) * k + offsetX,
    (worldY(lat, worldSize) - wy0) * k + offsetY,
  ];

  return { z, k, worldSize, wx0, wy0, offsetX, offsetY, project };
}

function enumerateTiles(frame, width, height) {
  const { z, k, wx0, wy0, offsetX, offsetY } = frame;

  // Invert project() at the canvas corners → the world-px rect the whole
  // output covers (margins included, so imagery reaches the paper edge).
  const viewX0 = wx0 - offsetX / k;
  const viewY0 = wy0 - offsetY / k;
  const viewX1 = viewX0 + width / k;
  const viewY1 = viewY0 + height / k;

  const n = 1 << z;
  const tx0 = Math.floor(viewX0 / TILE_SIZE);
  const tx1 = Math.floor((viewX1 - 1e-9) / TILE_SIZE);
  const ty0 = Math.max(0, Math.floor(viewY0 / TILE_SIZE));
  const ty1 = Math.min(n - 1, Math.floor((viewY1 - 1e-9) / TILE_SIZE));

  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_TILES) return [];

  const size = TILE_SIZE * k;
  const tiles = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      tiles.push({
        z,
        x: ((tx % n) + n) % n, // antimeridian wrap for the URL...
        y: ty,
        dx: (tx * TILE_SIZE - wx0) * k + offsetX, // ...unwrapped for placement
        dy: (ty * TILE_SIZE - wy0) * k + offsetY,
        size,
      });
    }
  }
  return tiles;
}

/** Esri's REST tile scheme is /{z}/{y}/{x} — NOT the /{z}/{x}/{y} order most
 * slippy-tile servers use. Named replacement, deliberately not positional,
 * so this can't silently regress to fetching the wrong tile. */
function tileUrl(t) {
  return ESRI_TILE_URL.replace('{z}', t.z).replace('{y}', t.y).replace('{x}', t.x);
}

/** Never rejects. Resolves the decoded image, or null on any failure. */
function loadTile(src, timeoutMs) {
  return new Promise((resolve) => {
    if (timeoutMs <= 0) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => finish(img.naturalWidth > 0 ? img : null);
    img.onerror = () => finish(null);
    img.src = src;
  });
}

async function loadTiles(tiles, deadline) {
  const out = new Array(tiles.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= tiles.length) return;
      const left = deadline - Date.now();
      if (left <= 0) return; // budget exhausted — remaining tiles stay null
      out[i] = await loadTile(tileUrl(tiles[i]), Math.min(TILE_TIMEOUT_MS, left));
    }
  };
  await Promise.all(Array.from({ length: Math.min(TILE_CONCURRENCY, tiles.length) }, worker));
  return out;
}

/** Downscales the tile into a small sample grid and checks what fraction of
 * pixels match Esri's "Map data not yet available" flat-grey signature. */
function isPlaceholderTile(img) {
  try {
    const c = document.createElement('canvas');
    c.width = PLACEHOLDER_SAMPLE_SIZE;
    c.height = PLACEHOLDER_SAMPLE_SIZE;
    const sctx = c.getContext('2d');
    sctx.drawImage(img, 0, 0, PLACEHOLDER_SAMPLE_SIZE, PLACEHOLDER_SAMPLE_SIZE);
    const { data } = sctx.getImageData(0, 0, PLACEHOLDER_SAMPLE_SIZE, PLACEHOLDER_SAMPLE_SIZE);
    let neutral = 0;
    const total = PLACEHOLDER_SAMPLE_SIZE * PLACEHOLDER_SAMPLE_SIZE;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (spread <= PLACEHOLDER_CHROMA_TOL && r >= PLACEHOLDER_GREY_MIN && r <= PLACEHOLDER_GREY_MAX) {
        neutral++;
      }
    }
    return neutral / total >= PLACEHOLDER_PIXEL_FRACTION;
  } catch {
    // Tainted sample canvas or other failure — don't let detection itself
    // break the render; just accept the tile as-is.
    return false;
  }
}

/**
 * Resolves the frame/tiles/images to paint, starting at `maxZoom` (already
 * ESRI_MAX_NATIVE_ZOOM) and walking the zoom down whenever what came back is
 * mostly Esri's "not yet available" placeholder — the same "stop asking for
 * detail that doesn't exist and upscale the last real level instead" trick
 * `maxNativeZoom` gives the live Leaflet map, just driven by actually
 * checking pixel content instead of a single hardcoded cutoff, since real
 * coverage varies by region and can fall short of that cutoff too.
 *
 * Bounded by one shared `deadline` (not reset per attempt) and by
 * PLACEHOLDER_FLOOR_ZOOM, so a field with no real coverage anywhere still
 * terminates and falls back to the existing "no imagery" background exactly
 * as before — this only ever makes the picked level *better or equal*.
 */
async function resolveMosaic({ ring, width, height, margin, maxZoom, deadline }) {
  let candidateZoom = maxZoom;
  let best = null;

  for (;;) {
    const frame = buildFrame({ ring, width, height, margin, maxZoom: candidateZoom });
    const tiles = enumerateTiles(frame, width, height);
    const images = await loadTiles(tiles, deadline);

    const loaded = images.filter(Boolean);
    const placeholderCount = loaded.filter(isPlaceholderTile).length;
    const placeholderFraction = loaded.length > 0 ? placeholderCount / loaded.length : 1;

    if (!best || loaded.length > 0) best = { frame, tiles, images };

    const goodEnough = loaded.length > 0 && placeholderFraction < PLACEHOLDER_TILE_FRACTION_THRESHOLD;
    if (goodEnough || frame.z <= PLACEHOLDER_FLOOR_ZOOM || Date.now() >= deadline) {
      return goodEnough ? { frame, tiles, images } : best;
    }

    // Re-deriving from the resolved z (not just decrementing the candidate)
    // skips straight past any lower candidates that would resolve to the
    // same z buildFrame already tried, once the field's own natural zoom is
    // below the cap.
    candidateZoom = frame.z - 1;
  }
}

function tracePolygon(ctx, ring, project) {
  ctx.beginPath();
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = project(ring[i][0], ring[i][1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawTiles(ctx, tiles, images) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  let drawn = 0;
  for (let i = 0; i < tiles.length; i++) {
    const img = images[i];
    if (!img) continue;
    const t = tiles[i];
    // +1px destination overlap: adjacent tiles are mathematically
    // contiguous, but each drawImage rasterizes its edge independently at
    // fractional dest coords and can leave a hairline seam otherwise.
    ctx.drawImage(img, t.dx, t.dy, t.size + 1, t.size + 1);
    drawn++;
  }
  return drawn;
}

function drawHeatmap(ctx, { grid, cols, rows, bbox, boundary, ring, project, opacity }) {
  const heatCanvas = renderSesGridToCanvas({ grid, cols, rows, bbox, boundary });
  if (!heatCanvas) return;

  const [hx0, hy0] = project(bbox[0], bbox[3]); // minLng, maxLat → top-left
  const [hx1, hy1] = project(bbox[2], bbox[1]); // maxLng, minLat → bottom-right

  ctx.save();
  tracePolygon(ctx, ring, project); // re-clip at OUTPUT resolution — the
  ctx.clip(); // raster's own internal clip is soft after smoothing.
  ctx.globalAlpha = opacity;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(heatCanvas, hx0, hy0, hx1 - hx0, hy1 - hy0);
  ctx.restore();
}

function drawBoundary(ctx, ring, project, width, height) {
  // Two-pass halo: a single white stroke vanishes on bright soil, a single
  // dark stroke vanishes on shadowed canopy or the plain fallback fill.
  const bw = Math.max(2, Math.round(Math.min(width, height) * 0.0035));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  tracePolygon(ctx, ring, project);
  ctx.lineWidth = bw + 3;
  ctx.strokeStyle = 'rgba(17, 24, 39, 0.55)';
  ctx.stroke();
  tracePolygon(ctx, ring, project);
  ctx.lineWidth = bw;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

function drawPins(ctx, samples, layerKey, project, width, height) {
  const r = Math.max(10, Math.min(28, Math.round(Math.min(width, height) * 0.018)));
  const fs = Math.round(r * 1.15);
  ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  samples.forEach((s, i) => {
    const [x, y] = project(s.lng, s.lat);
    const fill = sesToColor(sampleSesForLayer(s, layerKey));

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Optical centring: 'middle' baseline uses the em box, which sits low
    // for digits — center on the glyphs' own measured extent instead.
    const label = String(i + 1);
    const m = ctx.measureText(label);
    const cy = y + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;

    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(17, 24, 39, 0.6)'; // SES_COLORS spans lime→violet;
    ctx.strokeText(label, x, cy); // no single text color reads on all of it
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x, cy);
  });
}

/** ESRI_ATTRIBUTION is written for innerHTML (Leaflet's attribution
 * control), so it carries HTML entities. fillText() would print them
 * literally otherwise. */
const ATTRIBUTION_ENTITIES = { '&copy;': '©', '&mdash;': '—', '&amp;': '&', '&nbsp;': ' ' };
function decodeEntities(s) {
  return s.replace(/&[a-z]+;/g, (m) => ATTRIBUTION_ENTITIES[m] ?? m);
}

function drawAttribution(ctx, width, height, tilesDrawn) {
  const text = tilesDrawn > 0 ? decodeEntities(ESRI_ATTRIBUTION) : 'Satellite imagery unavailable';
  const fontSize = Math.max(11, Math.round(height * 0.011));
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const padding = 8;
  const textWidth = ctx.measureText(text).width;
  const boxW = textWidth + padding * 2;
  const boxH = fontSize + padding * 1.5;
  ctx.fillStyle = 'rgba(17, 24, 39, 0.6)';
  ctx.fillRect(width - boxW - padding, height - boxH - padding, boxW, boxH);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, width - padding * 2, height - padding * 1.25);
}

/**
 * @param {{grid: Float32Array, cols: number, rows: number, bbox: number[],
 *   boundary: object, samples: Array, layerKey: string, width?: number,
 *   height?: number, opacity?: number}} args
 * @returns {Promise<string>} PNG data URL. Never rejects — worst case
 *   returns a 1x1 transparent PNG.
 */
export default async function renderFieldFigure({
  grid,
  cols,
  rows,
  bbox,
  boundary,
  samples,
  layerKey,
  width = 1600,
  height = 1200,
  opacity = 0.9,
}) {
  try {
    const ring = boundary.geometry.coordinates[0];

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Margin must clear the largest pin radius so a sample sitting on the
    // boundary is never clipped in half, while still keeping the field
    // near the figure's edges.
    const provisionalR = Math.max(10, Math.min(28, Math.round(Math.min(width, height) * 0.018)));
    const margin = Math.max(16, Math.round(Math.min(width, height) * 0.03), provisionalR + 6);

    const deadline = Date.now() + TILE_BUDGET_MS;
    const { frame, tiles, images } = await resolveMosaic({
      ring,
      width,
      height,
      margin,
      maxZoom: ESRI_MAX_NATIVE_ZOOM,
      deadline,
    });

    const paint = (tileImages) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = BACKGROUND_FILL;
      ctx.fillRect(0, 0, width, height);
      const drawn = drawTiles(ctx, tiles, tileImages);
      drawHeatmap(ctx, { grid, cols, rows, bbox, boundary, ring, project: frame.project, opacity });
      drawBoundary(ctx, ring, frame.project, width, height);
      drawPins(ctx, samples ?? [], layerKey, frame.project, width, height);
      drawAttribution(ctx, width, height, drawn);
    };

    paint(images);
    try {
      return canvas.toDataURL('image/png');
    } catch {
      // Tainted despite the verified CORS header (proxy, opaque cache entry,
      // service worker). Repaint tile-free and re-encode rather than reject.
      paint(new Array(images.length).fill(null));
      return canvas.toDataURL('image/png');
    }
  } catch {
    // Absolute floor — a degenerate boundary or an unexpected canvas error
    // must still resolve to something, per this module's "never rejects"
    // contract.
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  }
}
