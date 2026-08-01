import { jsPDF } from 'jspdf';
import * as turf from '@turf/turf';
import {
  HEATMAP_LAYER_GENERAL,
  SES_COLORS,
} from '../constants/constants';
import { sesToColor, pdlaToSes, pdlaToSesContinuous, sesBandTable } from './sesScale';
import renderFieldFigure from './renderFieldFigure';

/**
 * ============================================================
 * exportFieldReport — jsPDF document builder
 * ============================================================
 * Builds a self-contained PDF record of one survey session: a cover page,
 * one page per plant (every photo, in aligned → Phase 1 → Phase 2 order,
 * then the pooled plant summary and coordinates), then one page per
 * heatmap layer that exists in the field. See CLAUDE.md's "PDF Report
 * Export" section for the page structure and why the figures are
 * composited offscreen rather than screenshotted from Leaflet.
 *
 * Every number and caption is pulled from the same fields and formatted
 * with the same conventions the on-screen UI already uses (SamplePanel,
 * SampleHistorySidebar, DiseaseFindingsList, MaskInspectorModal,
 * ColorLegend) — this file does not invent a second source of truth for
 * any of them, it only lays them out on a page.
 */

// ── Page geometry (A4 portrait, points) ─────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;
const CONTENT_BOTTOM = PAGE_H - MARGIN;

// ── Design tokens (mirrors App.css's :root custom properties) ──
const COLOR_TEXT = '#212222';
const COLOR_TEXT_SECONDARY = '#6b7280';
const COLOR_TEXT_MUTED = '#9ca3af';
const COLOR_BORDER = '#e5e7eb';
const COLOR_EMERALD = '#046307';
const COLOR_RED = '#ed5d54';

const FONT = 'helvetica';

const LOCATION_SOURCE_LABEL = { gps: 'GPS', exif: 'From photo', manual: 'Manual' };

function formatCapturedAt(capturedAt) {
  if (!capturedAt) return '';
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Same grouping rule SampleHistorySidebar uses for a plant's headline. */
function plantDiseaseSummary(sample) {
  const findings = sample.diseaseFindings;
  if (!findings) return sample.diseaseName ?? 'Healthy';
  if (findings.length === 0) return 'Healthy';
  return findings.map((f) => f.displayName).join(', ');
}

// ── Low-level layout helpers ─────────────────────────────────────

function addPage(doc) {
  doc.addPage();
  return MARGIN;
}

/** Ensures `needed` points of vertical space remain on the current page,
 * starting a new one first if not. Returns the (possibly reset) y. */
function ensureSpace(doc, y, needed) {
  if (y + needed > CONTENT_BOTTOM) return addPage(doc);
  return y;
}

function setText(doc, { size = 10, weight = 'normal', color = COLOR_TEXT } = {}) {
  doc.setFont(FONT, weight);
  doc.setFontSize(size);
  doc.setTextColor(color);
}

/** Wraps text to `maxWidth`, draws it, and returns the new y. */
function drawWrapped(doc, text, x, y, maxWidth, { lineHeight = 13 } = {}) {
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

function drawDivider(doc, y) {
  doc.setDrawColor(COLOR_BORDER);
  doc.setLineWidth(0.75);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  return y + 12;
}

/** Fits an already-loaded data-URL image into a maxW×maxH box, preserving
 * aspect ratio and centering it within the box, then draws it. Returns the
 * box's bottom y (not just the image's) so callers can lay out consistent
 * grids even when photos have slightly different aspect ratios. */
function drawFittedImage(doc, dataUrl, x, y, maxW, maxH) {
  doc.setDrawColor(COLOR_BORDER);
  doc.setLineWidth(0.75);
  doc.rect(x, y, maxW, maxH);
  if (!dataUrl) return y + maxH;
  try {
    const props = doc.getImageProperties(dataUrl);
    const scale = Math.min(maxW / props.width, maxH / props.height);
    const w = props.width * scale;
    const h = props.height * scale;
    doc.addImage(dataUrl, x + (maxW - w) / 2, y + (maxH - h) / 2, w, h);
  } catch {
    // Corrupt or undecodable image data — leave the placeholder frame
    // rather than aborting the whole report over one photo.
  }
  return y + maxH;
}

// ── Cover page ────────────────────────────────────────────────────

function drawCoverPage(doc, { samples, boundary, availableLayers }) {
  let y = MARGIN;

  doc.setFont(FONT, 'bold');
  doc.setFontSize(22);
  doc.setTextColor(COLOR_EMERALD);
  doc.text('Field Disease Pressure Report', MARGIN, y + 20);
  y += 34;

  setText(doc, { size: 10, color: COLOR_TEXT_SECONDARY });
  doc.text(
    new Date().toLocaleString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    MARGIN,
    y
  );
  y += 20;
  y = drawDivider(doc, y);

  // ── Field-level metrics ──
  const areaM2 = boundary ? turf.area(boundary) : 0;
  const areaHa = areaM2 / 10000;
  const totalPhotos = samples.reduce((sum, s) => sum + (s.imageCount ?? s.images?.length ?? 0), 0);
  const usablePhotos = samples.reduce((sum, s) => sum + (s.usableImageCount ?? 0), 0);

  const metrics = [
    ['Field area', `${areaM2.toFixed(0)} m² (${areaHa.toFixed(2)} ha)`],
    ['Plant samples', `${samples.length}`],
    ['Photos', `${usablePhotos} used / ${totalPhotos} total`],
  ];
  const colW = CONTENT_W / metrics.length;
  metrics.forEach(([label, value], i) => {
    const x = MARGIN + i * colW;
    setText(doc, { size: 9, color: COLOR_TEXT_SECONDARY });
    doc.text(label, x, y);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(15);
    doc.setTextColor(COLOR_TEXT);
    doc.text(value, x, y + 18);
  });
  y += 40;
  y = drawDivider(doc, y);

  // ── Field-wide disease breakdown ──
  doc.setFont(FONT, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(COLOR_TEXT);
  doc.text('Disease pressure across the field', MARGIN, y);
  y += 18;

  const diseaseLayers = availableLayers.filter((l) => l.key !== HEATMAP_LAYER_GENERAL);
  if (diseaseLayers.length === 0) {
    setText(doc, { size: 10, color: COLOR_TEXT_SECONDARY });
    doc.text('No disease was diagnosed in any sampled plant — the field reads entirely healthy.', MARGIN, y);
    y += 16;
  } else {
    for (const layer of diseaseLayers) {
      const affected = samples.filter((s) => (s.diseaseSeverity?.[layer.key] ?? 0) > 0);
      const avg =
        affected.length > 0
          ? affected.reduce((sum, s) => sum + s.diseaseSeverity[layer.key], 0) / affected.length
          : 0;
      const color = sesToColor(pdlaToSesContinuous(avg, layer.key));

      doc.setFillColor(color);
      doc.circle(MARGIN + 4, y - 3, 4, 'F');
      setText(doc, { size: 10.5, color: COLOR_TEXT });
      doc.text(
        `${layer.name} — ${affected.length} of ${samples.length} plants, average ${avg.toFixed(1)}% where present`,
        MARGIN + 14,
        y
      );
      y += 16;
    }
  }
  y += 6;
  y = drawDivider(doc, y);

  // ── Reading this report ──
  doc.setFont(FONT, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(COLOR_TEXT);
  doc.text('Reading this report', MARGIN, y);
  y += 18;

  const notes = [
    'Each plant page shows every photo taken of that plant, in three panes: the aligned photo, ' +
      'the Phase 1 leaf-segmentation mask, and the Phase 2 disease-classification mask, in that order.',
    'Mask previews are downscaled for display. Very small lesions may not be visible in a preview ' +
      'even though they were counted — every reported percentage is measured at full resolution, ' +
      'before any preview image is built.',
    'Per-photo confidence is a mean softmax posterior over pixels, not a calibrated probability that ' +
      'the diagnosis is correct.',
    'The General Threat heatmap layer is the highest disease class present at each point — it is not ' +
      'a percentage and should not be read as one.',
  ];
  setText(doc, { size: 9.5, color: COLOR_TEXT_SECONDARY });
  for (const note of notes) {
    y = ensureSpace(doc, y, 30);
    y = drawWrapped(doc, `• ${note}`, MARGIN, y, CONTENT_W, { lineHeight: 12.5 });
    y += 6;
  }

  // ── Phase 2 class legend, sourced from the model's own response ──
  const legendSource = samples
    .flatMap((s) => s.images ?? [])
    .find((img) => img?.masks?.class_order?.length);
  if (legendSource) {
    const { class_order: classOrder, palette, class_names: classNames } = legendSource.masks;
    y += 4;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(COLOR_TEXT);
    doc.text('Phase 2 mask legend', MARGIN, y);
    y += 14;

    let x = MARGIN;
    const rowH = 16;
    for (const label of classOrder) {
      const name = classNames?.[label] ?? label;
      const color = palette?.[label] ?? '#000000';
      setText(doc, { size: 9, color: COLOR_TEXT_SECONDARY });
      const textW = doc.getTextWidth(name);
      const chipW = 10 + 4 + textW + 16;
      if (x + chipW > PAGE_W - MARGIN) {
        x = MARGIN;
        y += rowH;
      }
      doc.setFillColor(color);
      doc.rect(x, y - 8, 10, 10, 'F');
      doc.text(name, x + 14, y);
      x += chipW;
    }
    y += rowH;
  }
}

// ── Per-plant pages ───────────────────────────────────────────────

function drawPhotoDiagnosisLine(doc, photo, y) {
  if (!photo.usable) {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8);
    const badgeW = doc.getTextWidth('EXCLUDED') + 12;
    doc.setFillColor(COLOR_RED);
    doc.roundedRect(MARGIN, y - 9, badgeW, 13, 3, 3, 'F');
    doc.setTextColor('#ffffff');
    doc.text('EXCLUDED', MARGIN + 6, y);

    setText(doc, { size: 9.5, color: COLOR_TEXT_SECONDARY });
    doc.text('Not counted', MARGIN + badgeW + 8, y);
    return y + 16;
  }

  const severityText = photo.severity != null ? `${photo.severity.toFixed(1)}%` : '—';
  const confText = photo.confidence != null ? ` · confidence ${parseFloat(photo.confidence).toFixed(2)}` : '';
  setText(doc, { size: 9.5, weight: 'bold', color: COLOR_TEXT });
  doc.text(`${photo.diseaseName ?? '—'} · ${severityText}`, MARGIN, y);
  const headW = doc.getTextWidth(`${photo.diseaseName ?? '—'} · ${severityText}`);
  setText(doc, { size: 9.5, color: COLOR_TEXT_SECONDARY });
  doc.text(confText, MARGIN + headW, y);
  return y + 16;
}

function drawPhotoRow(doc, sample, photo, index, y) {
  const gap = 8;
  const panes = photo.masks ? 3 : 1;
  // A lone aligned photo (no masks) gets a square box sized like one of the
  // three panes below, rather than stretching across the full content
  // width — every aligned photo is a square crop (ALIGN_OUTPUT_WIDTH ===
  // ALIGN_OUTPUT_HEIGHT), so a wide box would just letterbox it.
  const paneW = (CONTENT_W - gap * 2) / 3;
  const paneH = paneW;

  y = ensureSpace(doc, y, paneH + 46);

  setText(doc, { size: 10, weight: 'bold', color: COLOR_TEXT });
  doc.text(`Photo ${index + 1}`, MARGIN, y);
  y += 12;

  const captions = photo.masks
    ? ['Aligned photo', 'Phase 1 — leaf mask', 'Phase 2 — disease mask']
    : ['Aligned photo'];
  const images = photo.masks ? [photo.thumbnail, photo.masks.leaf, photo.masks.disease] : [photo.thumbnail];

  let x = MARGIN;
  const imgTop = y;
  for (let i = 0; i < panes; i++) {
    drawFittedImage(doc, images[i], x, imgTop, paneW, paneH);
    setText(doc, { size: 8, color: COLOR_TEXT_MUTED });
    doc.text(captions[i], x, imgTop + paneH + 10);
    x += paneW + gap;
  }
  y = imgTop + paneH + 20;

  y = drawPhotoDiagnosisLine(doc, photo, y);
  return y + 10;
}

function drawDiseaseFindingsRows(doc, findings, y) {
  for (const finding of findings) {
    y = ensureSpace(doc, y, 16);
    const ses = pdlaToSes(finding.pdla, finding.label);
    const color = sesToColor(pdlaToSesContinuous(finding.pdla, finding.label));
    doc.setFillColor(color);
    doc.circle(MARGIN + 4, y - 3, 4, 'F');

    setText(doc, { size: 10, color: COLOR_TEXT });
    const photoLabel = finding.photoCount === 1 ? 'photo' : 'photos';
    doc.text(`${finding.displayName} · ${finding.photoCount} ${photoLabel}`, MARGIN + 14, y);

    const valueText = `${finding.pdla.toFixed(1)}% · SES ${ses}`;
    const valueW = doc.getTextWidth(valueText);
    doc.text(valueText, PAGE_W - MARGIN - valueW, y);
    y += 15;
  }
  return y;
}

function drawPlantSummary(doc, sample, y) {
  y = ensureSpace(doc, y, 60);
  y = drawDivider(doc, y);

  const totalAffectedText = sample.severity == null ? '—' : `${sample.severity.toFixed(1)}%`;
  const diseasesFoundText =
    sample.diseaseFindings.length === 0 ? 'Healthy' : `${sample.diseaseFindings.length}`;
  const photosUsedText = `${sample.usableImageCount} / ${sample.imageCount}`;

  const metrics = [
    ['Total affected', totalAffectedText],
    ['Diseases found', diseasesFoundText],
    ['Photos used', photosUsedText],
  ];
  const colW = CONTENT_W / metrics.length;
  metrics.forEach(([label, value], i) => {
    const x = MARGIN + i * colW;
    setText(doc, { size: 9, color: COLOR_TEXT_SECONDARY });
    doc.text(label, x, y);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(16);
    doc.setTextColor(COLOR_TEXT);
    doc.text(value, x, y + 19);
  });
  y += 34;

  y = drawDiseaseFindingsRows(doc, sample.diseaseFindings, y);
  y += 4;

  if (sample.usableImageCount > 0) {
    const spreadText =
      sample.pdlaSpread && sample.usableImageCount > 1
        ? ` · per photo ${sample.pdlaSpread.min.toFixed(1)}–${sample.pdlaSpread.max.toFixed(1)}%`
        : '';
    const confText = sample.confidenceRange
      ? ` · confidence ${sample.confidenceRange[0].toFixed(2)}–${sample.confidenceRange[1].toFixed(2)}`
      : '';
    const photoWord = sample.usableImageCount === 1 ? 'photo' : 'photos';
    y = ensureSpace(doc, y, 14);
    setText(doc, { size: 8.5, color: COLOR_TEXT_MUTED });
    y = drawWrapped(
      doc,
      `Severity is pooled across the leaf area in ${sample.usableImageCount} ${photoWord}${spreadText}${confText}`,
      MARGIN,
      y,
      CONTENT_W,
      { lineHeight: 11 }
    );
  }

  return y + 6;
}

function drawPlantCoordinates(doc, sample, y) {
  y = ensureSpace(doc, y, 20);
  const locationLabel = LOCATION_SOURCE_LABEL[sample.locationSource] ?? '';
  const capturedLabel = formatCapturedAt(sample.capturedAt);
  const parts = [`${sample.lat.toFixed(6)}, ${sample.lng.toFixed(6)}`];
  if (locationLabel) parts.push(locationLabel);
  if (capturedLabel) parts.push(capturedLabel);

  setText(doc, { size: 9.5, color: COLOR_TEXT_SECONDARY });
  doc.setFont('courier', 'normal');
  doc.text(parts.join(' · '), MARGIN, y);
  return y + 16;
}

function drawPlantPage(doc, sample, index, startY) {
  let y = startY;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(COLOR_TEXT);
  doc.text(`Plant #${index + 1}`, MARGIN, y);
  setText(doc, { size: 10, color: COLOR_TEXT_SECONDARY });
  const headline = plantDiseaseSummary(sample);
  doc.text(headline, PAGE_W - MARGIN - doc.getTextWidth(headline), y);
  y += 20;
  y = drawDivider(doc, y);

  const images = sample.images ?? [];
  if (images.length === 0) {
    setText(doc, { size: 10, color: COLOR_TEXT_MUTED });
    doc.text('No photo detail retained.', MARGIN, y);
    y += 16;
  } else {
    images.forEach((photo, i) => {
      y = drawPhotoRow(doc, sample, photo, i, y);
    });
  }

  y = drawPlantSummary(doc, sample, y);
  y = drawPlantCoordinates(doc, sample, y);
}

// ── Heatmap layer pages ─────────────────────────────────────────

function drawLegend(doc, layerKey, y) {
  const gradW = CONTENT_W;
  const gradH = 14;
  const stops = SES_COLORS.length;
  const stepW = gradW / stops;
  for (let i = 0; i < stops; i++) {
    doc.setFillColor(SES_COLORS[i]);
    doc.rect(MARGIN + i * stepW, y, stepW + 0.5, gradH, 'F');
  }
  y += gradH + 12;

  setText(doc, { size: 8.5, color: COLOR_TEXT_MUTED });
  [0, 3, 6, 9].forEach((tick) => {
    const label = `SES ${tick}`;
    const x = MARGIN + (tick / 9) * gradW;
    const w = doc.getTextWidth(label);
    doc.text(label, Math.min(Math.max(x - w / 2, MARGIN), PAGE_W - MARGIN - w), y);
  });
  y += 16;

  if (layerKey === HEATMAP_LAYER_GENERAL) {
    setText(doc, { size: 9, color: COLOR_TEXT_SECONDARY });
    doc.text('Highest disease class present at each point — not a percentage.', MARGIN, y);
  } else {
    const band = sesBandTable(layerKey);
    const breakpoints = [`0%`, `${band[2].lo}%`, `${band[5].lo}%`, `>${band[8].lo}%`];
    setText(doc, { size: 8.5, color: COLOR_TEXT_MUTED });
    const colW = gradW / breakpoints.length;
    breakpoints.forEach((label, i) => {
      doc.text(label, MARGIN + i * colW, y);
    });
  }
  return y + 16;
}

async function drawHeatmapPage(doc, { layer, sesLayers, heatmapData, boundary, samples }) {
  let y = MARGIN;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(COLOR_TEXT);
  doc.text(`${layer.name} (SES)`, MARGIN, y);
  y += 22;

  const figureW = 1400;
  const figureH = 1050;
  const dataUrl = await renderFieldFigure({
    grid: sesLayers[layer.key],
    cols: heatmapData.cols,
    rows: heatmapData.rows,
    bbox: heatmapData.bbox,
    boundary,
    samples,
    layerKey: layer.key,
    width: figureW,
    height: figureH,
    opacity: 0.9,
  });

  const boxW = CONTENT_W;
  const boxH = boxW * (figureH / figureW);
  doc.addImage(dataUrl, 'PNG', MARGIN, y, boxW, boxH);
  doc.setDrawColor(COLOR_BORDER);
  doc.rect(MARGIN, y, boxW, boxH);
  y += boxH + 16;

  drawLegend(doc, layer.key, y);
}

// ── Entry point ───────────────────────────────────────────────────

/**
 * @param {{samples: Array, boundary: object, heatmapData: object,
 *   sesLayers: object, availableLayers: Array<{key:string,name:string}>,
 *   onProgress?: (percent:number)=>void}} args
 */
export async function exportFieldReport({
  samples,
  boundary,
  heatmapData,
  sesLayers,
  availableLayers,
  onProgress,
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const totalSteps = 1 + samples.length + (availableLayers?.length ?? 0);
  let step = 0;
  const reportProgress = () => {
    step += 1;
    onProgress?.(Math.round((step / totalSteps) * 100));
  };
  // Yield to the event loop between heavy steps so the mid-range Android
  // this app targets doesn't freeze mid-export.
  const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

  drawCoverPage(doc, { samples, boundary, availableLayers });
  reportProgress();
  await yieldToUi();

  for (let index = 0; index < samples.length; index++) {
    addPage(doc);
    drawPlantPage(doc, samples[index], index, MARGIN);
    reportProgress();
    // A 50-plant × 10-photo session decodes up to 500 images for aspect
    // fitting (drawFittedImage's getImageProperties). Yielding once per
    // plant, not once for the whole loop, is what keeps the mid-range
    // Android this app targets responsive through that.
    // eslint-disable-next-line no-await-in-loop
    await yieldToUi();
  }

  if (heatmapData && sesLayers && availableLayers?.length) {
    for (const layer of availableLayers) {
      addPage(doc);
      // eslint-disable-next-line no-await-in-loop
      await drawHeatmapPage(doc, { layer, sesLayers, heatmapData, boundary, samples });
      reportProgress();
      // eslint-disable-next-line no-await-in-loop
      await yieldToUi();
    }
  }

  const filename = `field-report-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
