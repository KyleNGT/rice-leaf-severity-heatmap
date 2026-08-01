import { useState, useCallback, useMemo, useRef } from 'react';
import * as turf from '@turf/turf';
import MapView from './components/MapView';
import StepperBar from './components/StepperBar';
import SamplePanel from './components/SamplePanel';
import SampleSheet from './components/SampleSheet';
import ActionPanel from './components/ActionPanel';
import ColorLegend from './components/ColorLegend';
import LoadingOverlay from './components/LoadingOverlay';
import ImageAlignmentModal from './components/ImageAlignmentModal';
import MaskInspectorModal from './components/MaskInspectorModal';
import SampleHistorySidebar from './components/SampleHistorySidebar';
import { useExifGps } from './hooks/useExifGps';
import { useDeviceLocation } from './hooks/useDeviceLocation';
import { useIsMobileViewport } from './hooks/useIsMobileViewport';
import { useAlignmentQueue } from './hooks/useAlignmentQueue';
import { analyzePlantImage } from './services/mockMLService';
import { computeIDW } from './utils/idwInterpolation';
import { summarizePlant, isUsableImage } from './utils/aggregateSample';
import { makeThumbnails } from './utils/makeThumbnail';
import { pdlaGridToSes, maxSesGrid } from './utils/sesGrid';
import {
  STEPS,
  HEATMAP_DEFAULT_OPACITY,
  HEATMAP_LAYER_GENERAL,
  MAX_SAMPLES,
  MIN_SAMPLES,
  MAX_IMAGES_PER_SAMPLE,
} from './constants/constants';
import './App.css';

let imageSeq = 0;

/** Synthetic IDW channel used ONLY when no sample has any disease reading
 * (a field that reads entirely Healthy). computeIDW needs at least one
 * channel to run at all; every sample contributes 0 on it (via the same
 * `diseaseSeverity[key] ?? 0` fallback every real channel uses), so the
 * resulting grid is a flat 0 everywhere inside the boundary — exactly the
 * flat SES-0 General surface a healthy field should render as. It never
 * appears in availableLayers; see the heatmapData.diseaseKeys check below. */
const NO_DISEASE_CHANNEL = '__none__';

/** A freshly-picked photo, before its analysis comes back. */
function newDraftImage(file, source) {
  imageSeq += 1;
  return {
    // Stable id — this, not File identity, is what reconciles async results
    // back onto the right photo now that several are in flight at once.
    id: `img-${Date.now()}-${imageSeq}`,
    file, // retained so a failed photo can be retried without re-picking it
    thumbnail: URL.createObjectURL(file),
    source,
    analyzing: true,
    result: null,
    error: '',
    dismissedWarning: false,
  };
}

/**
 * ============================================================
 * App — Root State Machine
 * ============================================================
 * Orchestrates the 3-step workflow:
 *   1. BOUNDARY  — Draw field polygon
 *   2. SAMPLING  — Capture/upload plant images (max 50)
 *   3. HEATMAP   — IDW computation + canvas overlay
 */
export default function App() {
  // ── Workflow State ──────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(STEPS.BOUNDARY);

  // ── Boundary State ─────────────────────────────────────────
  const [boundary, setBoundary] = useState(null);

  // ── Sampling State ─────────────────────────────────────────
  const [samples, setSamples] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(null);

  // ── Draft Sample State ──────────────────────────────────────
  // An in-progress PLANT being staged in the SamplePanel before the user
  // commits it with "Save Plant". A node is one rice plant, not one photo:
  // a rice leaf is long enough to need several frames, and field practice
  // samples several leaves per plant.
  //
  //   { images: [newDraftImage(...)],
  //     lat, lng, locating, locationSource, locationError, capturedAt }
  //
  // Location is plant-level, resolved once (see handleImagesSelected) so a
  // later photo can't shift a pin the farmer is standing at. locationSource
  // is 'gps' | 'exif' | 'manual' | null.
  //
  // Per-photo failures live on the image, not here: a failed photo is
  // excluded from the pooled severity rather than blocking the plant. It
  // contributes zero to BOTH sides of the PDLA ratio, so the invariant that
  // a failed analysis can never inject a fabricated severity into the IDW
  // grid still holds — see isUsableImage in utils/aggregateSample.js.
  const [draftSample, setDraftSample] = useState(null);

  // Guards the await inside handleAddSample against a double-tap.
  const committingRef = useRef(false);

  // ── Mask Inspector State ────────────────────────────────────
  // A resolved SNAPSHOT ({ title, subtitle, originalSrc, masks }), not an
  // id: it serves both draft photos (draftSample.images[]) and committed
  // ones (samples[].images[]), which are different shapes in different
  // arrays — passing plain data means one lookup path and the modal knows
  // neither. Masks are immutable once analysis returns, so a snapshot
  // can't go stale. See MaskInspectorModal.jsx.
  const [maskViewer, setMaskViewer] = useState(null);
  const handleInspectMasks = useCallback((payload) => setMaskViewer(payload), []);
  const handleCloseMaskViewer = useCallback(() => setMaskViewer(null), []);

  // ── Map Fullscreen State ────────────────────────────────────
  const [mapFullscreen, setMapFullscreen] = useState(false);

  // ── Heatmap State ──────────────────────────────────────────
  // heatmapData carries the raw per-channel IDW result (PDLA % grids) plus
  // diseaseKeys (the channels actually interpolated) and displayNames.
  // heatmapLayer is which of those the user is currently viewing — General
  // (MAX() of every disease's SES) or one specific disease.
  const [heatmapData, setHeatmapData] = useState(null);
  const [heatmapLayer, setHeatmapLayer] = useState(HEATMAP_LAYER_GENERAL);
  const [heatmapOpacity, setHeatmapOpacity] = useState(HEATMAP_DEFAULT_OPACITY);

  // ── Map <-> Sample History Selection (Heatmap step) ─────────
  // One shared selection object for BOTH directions of the link between a
  // map node and its Sample History sidebar row — see MapView.jsx and
  // SampleHistorySidebar.jsx for how `origin` and `seq` are consumed.
  //   { id, origin: 'map' | 'sidebar', seq, lat?, lng? }
  const [selection, setSelection] = useState(null);

  // ── Boundary Drawing UI State ──────────────────────────────
  const [drawingAction, setDrawingAction] = useState(null); // 'draw' | 'edit' | 'clear' | null
  const [drawingState, setDrawingState] = useState({ isDrawing: false, vertexCount: 0 });

  // ── Hooks ──────────────────────────────────────────────────
  const { extractGps } = useExifGps();
  const { getLocation } = useDeviceLocation();
  const isMobile = useIsMobileViewport();
  const mobileDrawerRef = useRef(null);
  const desktopDrawerRef = useRef(null);

  // ── Alignment Queue State ───────────────────────────────────
  // Un-aligned photos never enter draftSample.images — they wait here until
  // ImageAlignmentModal confirms a crop. See useAlignmentQueue.js's header
  // for why this keeps aggregateSample.js/canAddSample untouched.
  const alignQueue = useAlignmentQueue();
  // Set at enqueue (a new batch of photos was just picked), cleared the
  // moment location resolution has been attempted for this batch — at most
  // once per batch, on whichever photo is confirmed first (see
  // handleAlignedPhoto). Independent of the queue itself so a skipped photo
  // can't consume it.
  const batchLocationPendingRef = useRef(false);
  // A camera batch's GPS fix is requested at enqueue time, not at first
  // confirm — alignment often takes longer than the fix itself, so this lets
  // the two overlap instead of making the farmer wait twice.
  const pendingGpsPromiseRef = useRef(null);

  // ── Mobile Center-Anchored Drawing Handlers ────────────────
  const handlePlacePoint = useCallback(() => mobileDrawerRef.current?.placePoint(), []);
  const handleUndoPoint = useCallback(() => mobileDrawerRef.current?.undoLast(), []);
  const handleFinishShape = useCallback(() => mobileDrawerRef.current?.finishShape(), []);

  // ── Desktop Drawing Handlers ────────────────────────────────
  const handleUndoVertex = useCallback(() => desktopDrawerRef.current?.undoLastVertex(), []);

  // ── Boundary Handler ───────────────────────────────────────
  // Defensive, not currently load-bearing: the only route back to the
  // boundary step is handleReset, which reloads the page, so today a
  // boundary edit can't actually reach a step with a live heatmapData. If
  // that ever changes, dropping the stale grid here (rather than
  // re-clipping it to a shape it wasn't computed for) matches how
  // handleResumeSampling already invalidates the heatmap.
  const handleBoundaryCreated = useCallback((geoJSON) => {
    setBoundary(geoJSON);
    setHeatmapData(null);
    setHeatmapLayer(HEATMAP_LAYER_GENERAL);
  }, []);

  // ── Step Navigation ────────────────────────────────────────
  const advanceToSampling = useCallback(() => {
    if (boundary) {
      setDrawingAction(null);
      setDrawingState({ isDrawing: false, vertexCount: 0 });
      setCurrentStep(STEPS.SAMPLING);
    }
  }, [boundary]);

  // ── Draft Mutation ──────────────────────────────────────────
  // Every write to the draft goes through applyDraft, and draftRef is the
  // synchronous source of truth for reading it back.
  //
  // Two reasons this isn't just setDraftSample(prev => ...):
  //   - Several analyses are in flight at once, each resolving in its own
  //     callback. A functional updater only sees `prev` when React chooses
  //     to invoke it, so the calling code cannot act on the result — and
  //     handleImagesSelected has to know, right now, which photos it
  //     accepted and whether it owes a geolocation fix.
  //   - StrictMode double-invokes updaters in dev. Keeping side effects
  //     (revoking object URLs) out of the updater and in plain code makes
  //     that a non-issue instead of a subtle one.
  const draftRef = useRef(null);

  const applyDraft = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(draftRef.current) : updater;
    draftRef.current = next;
    setDraftSample(next);
    return next;
  }, []);

  // Patch one photo by id. Photos removed mid-flight simply aren't found,
  // which is how a late analysis result for a discarded photo gets dropped.
  const updateDraftImage = useCallback(
    (imageId, patch) => {
      applyDraft((prev) => {
        if (!prev) return prev;
        const index = prev.images.findIndex((image) => image.id === imageId);
        if (index === -1) return prev;

        const images = [...prev.images];
        images[index] = { ...images[index], ...patch };
        return { ...prev, images };
      });
    },
    [applyDraft]
  );

  const runAnalysis = useCallback(
    (imageId, file) => {
      updateDraftImage(imageId, { analyzing: true, error: '', result: null });

      analyzePlantImage(file)
        .then((result) => {
          // A 200 OK with status: 'no_leaf_detected' is not a usable photo —
          // treat it like a failure rather than recording a false 0%, which
          // would drag the heatmap toward "healthy" over a possible hotspot.
          // The result is still stored so the UI can say what went wrong.
          if (result.status === 'no_leaf_detected') {
            updateDraftImage(imageId, {
              analyzing: false,
              result,
              error: 'No leaf detected in this photo. Try a closer, clearer shot.',
            });
            return;
          }

          updateDraftImage(imageId, { analyzing: false, result, error: '' });
        })
        .catch((err) => {
          console.error('Sample analysis failed:', err);
          updateDraftImage(imageId, {
            analyzing: false,
            result: null,
            error: err.message || 'Analysis failed.',
          });
        });
    },
    [updateDraftImage]
  );

  // ── Image Processing Pipeline ──────────────────────────────
  // Photos no longer go straight to newDraftImage/runAnalysis. Every photo —
  // camera or gallery — first queues for ImageAlignmentModal; only a
  // confirmed, cropped photo (handleAlignedPhoto, below) ever reaches the
  // draft. This function's only job is to seed that queue.
  //
  // Location is resolved ONCE PER PLANT, not per photo — the farmer walks
  // around a single plant taking several shots, and re-fixing GPS each time
  // would jitter the pin. It branches by `source`, same as before:
  //   - 'camera': NEVER read EXIF — iOS WebKit strips GPS from
  //     camera-captured photos anyway — so fetch a live fix via
  //     navigator.geolocation instead. Fired here, immediately, rather than
  //     after cropping — alignment usually takes longer than the fix, so the
  //     two overlap instead of making the farmer wait twice.
  //   - 'gallery': NEVER call navigator.geolocation — the device's current
  //     position has no relation to where a previously-taken photo was shot.
  //     Best-effort EXIF GPS instead, applied in handleAlignedPhoto once the
  //     first photo of the batch is actually confirmed (not just picked) —
  //     so skipping a photo in the aligner can't set the plant's location
  //     from a shot the farmer decided not to use.
  // Either way, coordinates already set are never overwritten, and a manual
  // edit is never overridden.
  const handleImagesSelected = useCallback(
    (fileList, source) => {
      // Defends against a late `onChange` firing on some Android pickers
      // while a queue from a previous tap is still open.
      if (alignQueue.isAligning) return;

      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;

      // Decided synchronously against the live draft, exactly as before —
      // just at selection time instead of after cropping, since capacity
      // doesn't change while the aligner is open.
      const prev = draftRef.current;
      const room = Math.max(0, MAX_IMAGES_PER_SAMPLE - (prev?.images.length ?? 0));
      const accepted = files.slice(0, room);
      if (accepted.length === 0) return;

      const isCamera = source === 'camera';
      const shouldLocate =
        isCamera &&
        !prev?.locating &&
        prev?.locationSource !== 'manual' &&
        !(prev?.lat || prev?.lng);

      batchLocationPendingRef.current = true;
      pendingGpsPromiseRef.current = shouldLocate ? getLocation() : null;

      alignQueue.enqueue(accepted, source);
    },
    [alignQueue, getLocation]
  );

  // ── Alignment Confirm / Cancel ──────────────────────────────
  // The counterpart to handleImagesSelected above: runs once per photo the
  // user confirms in ImageAlignmentModal, with the cropped File it produced.
  const handleAlignedPhoto = useCallback(
    (croppedFile, originalFile) => {
      const source = alignQueue.queue?.source;
      const img = newDraftImage(croppedFile, source);
      const isFirstOfBatch = batchLocationPendingRef.current;
      const willLocate = isFirstOfBatch && source === 'camera' && !!pendingGpsPromiseRef.current;

      const prev = draftRef.current;
      applyDraft(
        prev
          ? {
              ...prev,
              images: [...prev.images, img],
              locating: prev.locating || willLocate,
            }
          : {
              images: [img],
              lat: '',
              lng: '',
              locating: willLocate,
              locationSource: null,
              locationError: '',
              capturedAt: null,
            }
      );

      runAnalysis(img.id, croppedFile);

      if (isFirstOfBatch) {
        batchLocationPendingRef.current = false;

        if (source === 'camera' && pendingGpsPromiseRef.current) {
          const promise = pendingGpsPromiseRef.current;
          pendingGpsPromiseRef.current = null;
          promise
            .then((pos) => {
              applyDraft((current) =>
                current
                  ? {
                      ...current,
                      lat: pos.lat.toFixed(6),
                      lng: pos.lng.toFixed(6),
                      capturedAt: pos.timestamp,
                      locationSource: 'gps',
                      locating: false,
                      locationError: '',
                    }
                  : current
              );
            })
            .catch((err) => {
              applyDraft((current) =>
                current ? { ...current, locating: false, locationError: err.message } : current
              );
            });
        } else if (source !== 'camera') {
          // EXIF from the original — canvas re-encoding strips it from the
          // cropped file, so it can only ever be read here.
          extractGps(originalFile).then((gps) => {
            if (!gps.hasGps) return;
            applyDraft((current) => {
              if (!current) return current;
              // Fill only a blank plant. A coordinate already set — by GPS,
              // by an earlier photo's EXIF, or by hand — stays put.
              if (current.locationSource === 'manual' || current.lat || current.lng) {
                return current;
              }
              return {
                ...current,
                lat: gps.lat.toFixed(6),
                lng: gps.lng.toFixed(6),
                locationSource: 'exif',
                locationError: '',
              };
            });
          });
        }
      }

      alignQueue.advance();
    },
    [alignQueue, applyDraft, runAnalysis, extractGps]
  );

  const handleAlignCancel = useCallback(() => {
    batchLocationPendingRef.current = false;
    if (pendingGpsPromiseRef.current) {
      // Nothing will ever attach a handler to this promise now — swallow a
      // late rejection so it doesn't surface as an unhandled one.
      pendingGpsPromiseRef.current.catch(() => {});
      pendingGpsPromiseRef.current = null;
    }
    alignQueue.cancelAll();
  }, [alignQueue]);

  // ── Per-Photo Actions ───────────────────────────────────────
  const handleRemoveDraftImage = useCallback(
    (imageId) => {
      const target = draftRef.current?.images.find((image) => image.id === imageId);
      if (!target) return;

      URL.revokeObjectURL(target.thumbnail);
      // The mask inspector's originalSrc, when open on THIS photo, points at
      // the same object URL just revoked above — close it rather than leave
      // it showing a broken image.
      setMaskViewer(null);

      applyDraft((prev) => {
        const images = prev.images.filter((image) => image.id !== imageId);
        // Removing the last photo discards the plant entirely — an empty
        // draft has no meaning and would strand the coordinate fields.
        return images.length === 0 ? null : { ...prev, images };
      });
    },
    [applyDraft]
  );

  const handleRetryImage = useCallback(
    (imageId) => {
      const image = draftRef.current?.images.find((candidate) => candidate.id === imageId);
      // The File was retained at pick time, so a retry costs no re-selection.
      if (image) runAnalysis(imageId, image.file);
    },
    [runAnalysis]
  );

  const handleDismissImageWarning = useCallback(
    (imageId) => updateDraftImage(imageId, { dismissedWarning: true }),
    [updateDraftImage]
  );

  const handleDiscardDraft = useCallback(() => {
    draftRef.current?.images.forEach((image) => URL.revokeObjectURL(image.thumbnail));
    // Every object URL just revoked above is a candidate for the mask
    // inspector's originalSrc — close it rather than leave it dangling.
    setMaskViewer(null);
    applyDraft(null);
  }, [applyDraft]);

  // ── Draft Coordinate Editing ────────────────────────────────
  // A manual edit always wins as the provenance of record — even if
  // GPS or EXIF had prefilled the field, the user is now the source.
  const handleDraftCoordChange = useCallback(
    (field, value) => {
      applyDraft((prev) =>
        prev ? { ...prev, [field]: value, locationSource: 'manual', locationError: '' } : prev
      );
    },
    [applyDraft]
  );

  // ── TEMPORARY: Tap-to-Set Location (dev/testing only) ───────
  // Lets a map tap during Sampling set the draft's lat/lng directly,
  // skipping GPS/EXIF/manual typing, to place test plants faster. Gated by
  // ENABLE_TAP_TO_SET_LOCATION in MapView; remove this handler, the prop
  // passed to <MapView>, and that constant together when done testing.
  const handleMapTapLocation = useCallback(
    (lat, lng) => {
      applyDraft((prev) =>
        prev
          ? {
              ...prev,
              lat: lat.toFixed(6),
              lng: lng.toFixed(6),
              locationSource: 'manual',
              locationError: '',
            }
          : prev
      );
    },
    [applyDraft]
  );

  // ── Draft Validity (parsed coords + inside-boundary check) ──
  const draftValidity = useMemo(() => {
    if (!draftSample) return { hasCoords: false, isInside: false, isValid: false };

    const lat = parseFloat(draftSample.lat);
    const lng = parseFloat(draftSample.lng);
    const hasCoords =
      draftSample.lat !== '' &&
      draftSample.lng !== '' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng);

    if (!hasCoords || !boundary) {
      return { hasCoords, isInside: false, isValid: false };
    }

    const point = turf.point([lng, lat]);
    const isInside = turf.booleanPointInPolygon(point, boundary);

    return { hasCoords, isInside, isValid: isInside };
  }, [draftSample, boundary]);

  // ── Plant-Level Summary ─────────────────────────────────────
  // Pooled PDLA over every usable photo — see utils/aggregateSample.js for
  // why this is a ratio of summed pixel counts and not a mean of the
  // per-photo percentages.
  const draftSummary = useMemo(
    () => (draftSample ? summarizePlant(draftSample.images) : null),
    [draftSample]
  );

  // ── Commit Draft Sample ──────────────────────────────────────
  const handleAddSample = useCallback(async () => {
    // Mirrors canAddSample, which gates the button. Repeated here because
    // this handler, not the disabled attribute, is what actually protects
    // the invariant that only a measured plant reaches the grid.
    if (!draftSample || !draftSummary || !draftValidity.isValid) return;
    if (draftSample.locating) return;
    if (draftSummary.analyzingCount > 0 || draftSummary.usableCount === 0) return;
    if (draftSummary.severity === null) return;
    if (samples.length >= MAX_SAMPLES) return;
    // makeThumbnails awaits, leaving a window for a second tap.
    if (committingRef.current) return;
    committingRef.current = true;

    const draft = draftSample;

    try {
      const thumbs = await makeThumbnails(draft.images);

      const newSample = {
        id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        lat: parseFloat(draft.lat),
        lng: parseFloat(draft.lng),
        // lat/lng/severity stay flat numbers on purpose: idwInterpolation.js
        // projects exactly these three fields into the worker, so the whole
        // interpolation path is untouched by the move to multi-image plants.
        severity: draftSummary.severity,
        diseaseDetected: draftSummary.diseaseDetected,
        diseaseName: draftSummary.diseaseName,
        // Machine-readable pooled winner — kept alongside diseaseName
        // (display) now that the heatmap needs to key layers by label.
        diseaseLabel: draftSummary.diseaseLabel,
        // Per-disease PDLA % (gated independently — see aggregateSample.js),
        // plus the label list/display names, so idwInterpolation.js can
        // derive channels and the heatmap UI can name them without
        // re-deriving anything from raw classPixels at render time.
        diseaseSeverity: draftSummary.diseaseSeverity,
        diseaseLabels: draftSummary.diseaseLabels,
        diseaseDisplayNames: draftSummary.diseaseDisplayNames,
        // Every disease at least one photo was diagnosed with, each with its
        // own pooled PDLA % and photo count — a rice hill can carry more
        // than one disease across its tillers, so this is not collapsed to
        // diseaseName's single dominant label. See aggregateSample.js's
        // diseaseFindings.
        diseaseFindings: draftSummary.diseaseFindings,
        // No plant-level confidence is claimed. Each photo's confidence is a
        // mean posterior conditioned on THAT photo's winning class, which may
        // differ from the plant's, so combining them yields a number with no
        // referent. The per-photo range is kept for display instead.
        confidence: null,
        confidenceRange: draftSummary.confidenceRange,
        thumbnail: thumbs[0].thumbnail,
        images: draft.images.map((image, index) => ({
          id: image.id,
          thumbnail: thumbs[index].thumbnail,
          // Each photo's one diagnosis: its whole PDLA, labeled with its
          // dominant disease. See aggregateSample.js's photoDiagnosis — the
          // plant-level diseaseFindings above is these grouped and pooled.
          severity: image.result?.status === 'ok' ? image.result.severity : null,
          diseaseName: image.result?.status === 'ok' ? image.result.diseaseName : null,
          diseaseLabel: image.result?.status === 'ok' ? image.result.diseaseLabel : null,
          confidence: image.result?.confidence ?? null,
          // Phase-1/Phase-2 previews, already downscaled by the backend and
          // shipped as data URLs — no object URL, no revoke, no re-encode.
          // See CLAUDE.md's Mask Previews section.
          masks: image.result?.masks ?? null,
          usable: isUsableImage(image),
        })),
        imageCount: draftSummary.totalCount,
        usableImageCount: draftSummary.usableCount,
        // Retained for the write-up: the pooled counts behind the severity,
        // and how much the individual photos disagreed.
        leafPixels: draftSummary.leafPixels,
        diseasePixels: draftSummary.diseasePixels,
        classPixels: draftSummary.classPixels,
        pdlaSpread: draftSummary.pdlaSpread,
        locationSource: draft.locationSource,
        capturedAt: draft.capturedAt ?? null,
      };

      // Full-resolution blobs are only needed while the draft is open (the
      // lightbox reads them). Now that small data URLs are stored, release
      // them — otherwise 50 plants × up to 10 photos stay pinned in memory.
      draft.images.forEach((image, index) => {
        if (thumbs[index].downscaled) URL.revokeObjectURL(image.thumbnail);
      });
      // Any of the object URLs just revoked above could be the mask
      // inspector's originalSrc if it was left open through the save.
      setMaskViewer(null);

      setSamples((prev) => [...prev, newSample]);
      applyDraft(null);
    } finally {
      committingRef.current = false;
    }
  }, [applyDraft, draftSample, draftSummary, draftValidity, samples.length]);

  // ── Heatmap Generation ─────────────────────────────────────
  const handleGenerateHeatmap = useCallback(async () => {
    if (samples.length < MIN_SAMPLES || !boundary) return;

    setIsProcessing(true);
    setLoadingMessage('Computing disease pressure map...');
    setLoadingProgress(0);
    setCurrentStep(STEPS.HEATMAP);
    // A previous run's layer selection may name a disease this run doesn't
    // have (samples changed since); always land back on General.
    setHeatmapLayer(HEATMAP_LAYER_GENERAL);

    try {
      // Diseases actually present: at least one plant reads a nonzero
      // (post-gate) PDLA for it — see aggregateSample.js's diseaseSeverity.
      // A field that reads entirely Healthy still needs one channel to
      // interpolate at all; NO_DISEASE_CHANNEL covers that case.
      const present = new Set();
      let labelOrder = [];
      for (const s of samples) {
        if (labelOrder.length === 0 && s.diseaseLabels?.length) {
          labelOrder = s.diseaseLabels;
        }
        for (const [label, value] of Object.entries(s.diseaseSeverity ?? {})) {
          if (value > 0) present.add(label);
        }
      }
      const diseaseKeys = labelOrder.filter((label) => present.has(label));
      for (const label of present) {
        if (!diseaseKeys.includes(label)) diseaseKeys.push(label);
      }
      const channelKeys = diseaseKeys.length > 0 ? diseaseKeys : [NO_DISEASE_CHANNEL];

      const result = await computeIDW(samples, boundary, channelKeys, (progress) => {
        setLoadingProgress(progress);
      });

      // Display names pooled across every sample, so a disease seen on only
      // one plant still gets a real name in the layer toggle/legend.
      const displayNames = {};
      for (const s of samples) Object.assign(displayNames, s.diseaseDisplayNames ?? {});

      setHeatmapData({ ...result, diseaseKeys, displayNames });
    } catch (err) {
      console.error('IDW computation failed:', err);
    } finally {
      setIsProcessing(false);
      setLoadingMessage('');
      setLoadingProgress(null);
    }
  }, [samples, boundary]);

  // ── Layer Derivation (PDLA grids → SES grids) ───────────────
  // Pure post-processing of heatmapData — switching layers never touches the
  // worker, so it's instant. See sesGrid.js for why maxing the CONTINUOUS
  // per-disease SES grids is equivalent to the spec's Math.max() over
  // integer SES classes.
  const isHealthyOnlyHeatmap =
    heatmapData?.diseaseKeys.length === 1 && heatmapData.diseaseKeys[0] === NO_DISEASE_CHANNEL;

  const sesLayers = useMemo(() => {
    if (!heatmapData) return null;
    if (isHealthyOnlyHeatmap) {
      // The synthetic channel's raw PDLA grid is already all-0/-1 — SES of
      // PDLA 0 is 0 by definition, so it doubles as the SES grid directly.
      return { [HEATMAP_LAYER_GENERAL]: heatmapData.layers[NO_DISEASE_CHANNEL].grid };
    }

    const perDisease = {};
    const sesGrids = [];
    for (const key of heatmapData.diseaseKeys) {
      const grid = pdlaGridToSes(heatmapData.layers[key].grid, key);
      perDisease[key] = grid;
      sesGrids.push(grid);
    }

    return { [HEATMAP_LAYER_GENERAL]: maxSesGrid(sesGrids), ...perDisease };
  }, [heatmapData, isHealthyOnlyHeatmap]);

  // ── Layer Toggle Options ────────────────────────────────────
  const availableLayers = useMemo(() => {
    if (!heatmapData) return [];
    const layers = [{ key: HEATMAP_LAYER_GENERAL, name: 'General Threat' }];
    if (!isHealthyOnlyHeatmap) {
      for (const key of heatmapData.diseaseKeys) {
        layers.push({ key, name: heatmapData.displayNames[key] ?? key });
      }
    }
    return layers;
  }, [heatmapData, isHealthyOnlyHeatmap]);

  // ── Map <-> Sample History Selection ────────────────────────
  // Two entry points into the same `selection` state — see its declaration
  // above for the shape. Both bump `seq` off the previous value (not a
  // fixed increment) so a rapid double-click can't race two updates onto
  // the same seq — each setState sees the other's result.
  const handleSampleSelect = useCallback((sampleId) => {
    setSelection((prev) => ({ id: sampleId, origin: 'map', seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleFocusOnMap = useCallback((sample) => {
    setSelection((prev) => ({
      id: sample.id,
      lat: sample.lat,
      lng: sample.lng,
      origin: 'sidebar',
      seq: (prev?.seq ?? 0) + 1,
    }));
  }, []);

  // ── Resume Sampling ────────────────────────────────────────
  // Return to Step 2 keeping boundary + existing samples. Clear the
  // heatmap so the map is clean for new sampling; the user regenerates
  // it (over the fuller sample set) with the existing Generate button.
  const handleResumeSampling = useCallback(() => {
    setHeatmapData(null);
    setHeatmapLayer(HEATMAP_LAYER_GENERAL);
    setSelection(null);
    setCurrentStep(STEPS.SAMPLING);
  }, []);

  // ── Reset ──────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setCurrentStep(STEPS.BOUNDARY);
    setBoundary(null);
    setSamples([]);
    setHeatmapData(null);
    setHeatmapLayer(HEATMAP_LAYER_GENERAL);
    setHeatmapOpacity(HEATMAP_DEFAULT_OPACITY);
    setSelection(null);
    applyDraft(null);
    handleAlignCancel();
    setMapFullscreen(false);
    // Force a full page reload to reset Leaflet + Geoman state cleanly
    window.location.reload();
  }, [applyDraft, handleAlignCancel]);

  // ── Derived Flags ───────────────────────────────────────────
  // Desktop keeps the side-by-side boxed-card split (with its own
  // enlarge/fullscreen toggle). Mobile instead keeps the map plain
  // full-bleed (like Steps 1 & 3) and floats a draggable bottom sheet
  // over it — see SampleSheet.jsx — so `mapFullscreen`/enlarge never
  // apply on mobile in practice.
  const isDesktopSamplingSplit =
    currentStep === STEPS.SAMPLING && !isMobile && !mapFullscreen;
  const isMobileSampling = currentStep === STEPS.SAMPLING && isMobile;
  // A per-photo failure no longer blocks the plant — it's excluded from the
  // pooled severity instead. What IS still required: nothing mid-flight, and
  // at least one photo that actually produced a measurement.
  const canAddSample =
    !!draftSample &&
    !draftSample.locating &&
    !!draftSummary &&
    draftSummary.analyzingCount === 0 &&
    draftSummary.usableCount > 0 &&
    draftSummary.severity !== null &&
    draftValidity.isValid &&
    samples.length < MAX_SAMPLES;
  const isImagesMaxed = (draftSample?.images.length ?? 0) >= MAX_IMAGES_PER_SAMPLE;
  const coordWarning =
    draftSample && draftValidity.hasCoords && !draftValidity.isInside
      ? 'This point is outside your field boundary.'
      : '';

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Orientation lock — pure-CSS overlay, shown only via the
          `(max-height: 500px) and (orientation: landscape)` media query
          in App.css. Always rendered so there's no mount/unmount flicker
          on rotate; visibility is entirely the browser's media-query
          evaluation, not React state. */}
      <div className="orientation-lock" role="alert" aria-live="assertive">
        <svg
          className="orientation-lock-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="7" y="2" width="10" height="16" rx="2" />
          <line x1="11" y1="15" x2="13" y2="15" />
          <path d="M20 9v8a2 2 0 0 1-2 2h-3" strokeLinecap="round" />
          <path d="M17 16l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="orientation-lock-title">Rotate Your Device</p>
        <p className="orientation-lock-body">
          This app is designed for portrait mode. Please rotate your phone back to
          continue.
        </p>
      </div>

      {/* Header */}
      <header className="app-header">
        <h1 className="app-title">Rice Leaf Severity</h1>
        <StepperBar currentStep={currentStep} />
      </header>

      {/* Workspace — full-screen map normally; splits with the upload
          panel during Sampling on desktop only. On mobile the map stays
          full-bleed (like Steps 1 & 3) and a SampleSheet floats over it
          instead (see below). */}
      <div className={`workspace ${isDesktopSamplingSplit ? 'workspace--split' : ''}`}>
        {/* Upload panel — desktop only, occupies its half of the split */}
        {isDesktopSamplingSplit && (
          <SamplePanel
            draft={draftSample}
            summary={draftSummary}
            onImagesSelected={handleImagesSelected}
            onCoordChange={handleDraftCoordChange}
            onAddSample={handleAddSample}
            onRemoveImage={handleRemoveDraftImage}
            onRetryImage={handleRetryImage}
            onDismissImageWarning={handleDismissImageWarning}
            onDiscardDraft={handleDiscardDraft}
            onInspectMasks={handleInspectMasks}
            canAddSample={canAddSample}
            coordWarning={coordWarning}
            disabled={isProcessing}
            isMaxed={samples.length >= MAX_SAMPLES}
            isImagesMaxed={isImagesMaxed}
          />
        )}

        {/* Map panel — always the same wrapper nesting so <MapView>'s
            persistent <MapContainer> is never remounted; the "boxed
            card" look (title + inset map) is applied purely via CSS
            scoped under .workspace--split, so Steps 1 & 3 stay
            full-screen and pixel-identical to before. */}
        <div className="map-panel">
          <div className="map-card">
            {isDesktopSamplingSplit && <h3 className="map-title">Your Field</h3>}
            <div className="map-box">
              <MapView
                currentStep={currentStep}
                boundary={boundary}
                onBoundaryCreated={handleBoundaryCreated}
                samples={samples}
                heatmapGrid={heatmapData ? sesLayers?.[heatmapLayer] : null}
                heatmapCols={heatmapData?.cols}
                heatmapRows={heatmapData?.rows}
                heatmapBbox={heatmapData?.bbox}
                heatmapLayer={heatmapLayer}
                heatmapOpacity={heatmapOpacity}
                draftSample={draftSample}
                mapFullscreen={mapFullscreen}
                drawingAction={drawingAction}
                onDrawingActionChange={setDrawingAction}
                onDrawingStateChange={setDrawingState}
                mobileDrawerRef={mobileDrawerRef}
                desktopDrawerRef={desktopDrawerRef}
                selection={selection}
                onSampleSelect={handleSampleSelect}
                onMapTapLocation={handleMapTapLocation}
              />

              {/* Center-anchored crosshair — mobile boundary drawing only */}
              {currentStep === STEPS.BOUNDARY && isMobile && !boundary && (
                <div className="map-crosshair" aria-hidden="true">
                  <span className="map-crosshair-icon">📍</span>
                </div>
              )}

              {/* Enlarge — take the map fullscreen during sampling (desktop only) */}
              {isDesktopSamplingSplit && (
                <button
                  type="button"
                  className="map-enlarge-btn"
                  onClick={() => setMapFullscreen(true)}
                >
                  <span aria-hidden="true">⛶</span>
                  <span>Enlarge</span>
                </button>
              )}

              {/* Back — return from the fullscreen map takeover (desktop only) */}
              {!isMobile && mapFullscreen && currentStep === STEPS.SAMPLING && (
                <button
                  type="button"
                  className="map-back-btn"
                  onClick={() => setMapFullscreen(false)}
                >
                  <span aria-hidden="true">←</span>
                  <span>Back</span>
                </button>
              )}
            </div>

            {/* Sample counter + Generate Heatmap — under the map, in
                the "Your Field" card (desktop only; mobile's equivalent
                floats over the map — see .mobile-sample-actions below) */}
            {isDesktopSamplingSplit && (
              <div className="map-footer">
                <div className="upload-counter">
                  <span>
                    Plants: <span className="upload-counter-value">{samples.length}</span> /{' '}
                    {MAX_SAMPLES}
                  </span>
                  {samples.length >= MAX_SAMPLES && (
                    <span className="upload-counter-maxed">Maximum reached</span>
                  )}
                </div>

                <button
                  type="button"
                  className="upload-btn-generate"
                  disabled={samples.length < MIN_SAMPLES}
                  onClick={handleGenerateHeatmap}
                >
                  {samples.length < MIN_SAMPLES
                    ? `Need at least ${MIN_SAMPLES} plants (${samples.length}/${MIN_SAMPLES})`
                    : `Generate Heatmap (${samples.length} plants)`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile bottom sheet — floats over the full-bleed map during
          Sampling on mobile, replacing the desktop split entirely. */}
      {isMobileSampling && (
        <>
          <div className="mobile-sample-actions">
            <div className="upload-counter">
              <span>
                Plants: <span className="upload-counter-value">{samples.length}</span> /{' '}
                {MAX_SAMPLES}
              </span>
              {samples.length >= MAX_SAMPLES && (
                <span className="upload-counter-maxed">Maximum reached</span>
              )}
            </div>

            <button
              type="button"
              className="upload-btn-generate"
              disabled={samples.length < MIN_SAMPLES}
              onClick={handleGenerateHeatmap}
            >
              {samples.length < MIN_SAMPLES
                ? `Need at least ${MIN_SAMPLES} plants (${samples.length}/${MIN_SAMPLES})`
                : `Generate Heatmap (${samples.length} plants)`}
            </button>
          </div>

          <SampleSheet
            draft={draftSample}
            summary={draftSummary}
            onImagesSelected={handleImagesSelected}
            onCoordChange={handleDraftCoordChange}
            onAddSample={handleAddSample}
            onRemoveImage={handleRemoveDraftImage}
            onRetryImage={handleRetryImage}
            onDismissImageWarning={handleDismissImageWarning}
            onDiscardDraft={handleDiscardDraft}
            onInspectMasks={handleInspectMasks}
            canAddSample={canAddSample}
            coordWarning={coordWarning}
            disabled={isProcessing}
            isMaxed={samples.length >= MAX_SAMPLES}
            isImagesMaxed={isImagesMaxed}
          />
        </>
      )}

      {/* Action panel — always visible */}
      <ActionPanel
        currentStep={currentStep}
        boundary={boundary}
        onAdvanceStep={advanceToSampling}
        onReset={handleReset}
        onResumeSampling={handleResumeSampling}
        heatmapOpacity={heatmapOpacity}
        onOpacityChange={setHeatmapOpacity}
        heatmapData={heatmapData}
        availableLayers={availableLayers}
        heatmapLayer={heatmapLayer}
        onHeatmapLayerChange={setHeatmapLayer}
        drawingAction={drawingAction}
        onDrawingActionChange={setDrawingAction}
        drawingState={drawingState}
        onPlacePoint={handlePlacePoint}
        onUndoPoint={handleUndoPoint}
        onFinishShape={handleFinishShape}
        onUndoVertex={handleUndoVertex}
      />

      {/* Color legend — visible when heatmap is shown */}
      {currentStep === STEPS.HEATMAP && heatmapData && (
        <ColorLegend
          activeLayer={heatmapLayer}
          layerName={availableLayers.find((l) => l.key === heatmapLayer)?.name}
          availableLayers={availableLayers}
          onLayerChange={setHeatmapLayer}
        />
      )}

      {/* Sample history — hidden left sidebar, Heatmap step only */}
      {currentStep === STEPS.HEATMAP && (
        <SampleHistorySidebar
          samples={samples}
          selection={selection}
          onFocusOnMap={handleFocusOnMap}
          activeLayer={heatmapLayer}
          onInspectMasks={handleInspectMasks}
        />
      )}

      {/* Alignment modal — a direct child of .app, never nested inside
          <SampleSheet>: .sheet carries a CSS transform, which would make it
          the containing block for this modal's position:fixed root and drag
          it around with the sheet's translate. Covers both the desktop
          split and the mobile sheet identically, same as the map-fullscreen
          takeover does. */}
      {alignQueue.isAligning && (
        <ImageAlignmentModal
          file={alignQueue.currentFile}
          imageUrl={alignQueue.currentUrl}
          photoIndex={alignQueue.queue.index + 1}
          totalCount={alignQueue.queue.totalCount}
          onConfirm={(croppedFile) => handleAlignedPhoto(croppedFile, alignQueue.currentFile)}
          onSkip={alignQueue.skipCurrent}
          onCancel={handleAlignCancel}
        />
      )}

      {/* Mask inspector — a direct child of .app for the same reason as the
          alignment modal above: rendering it inside <SampleSheet> would put
          it under .sheet's CSS transform, which becomes the containing
          block for its position:fixed root and drags it around with the
          sheet instead of the viewport. Shared by both entry points
          (SamplePanel/SampleSheet's photo tiles, and
          SampleHistorySidebar's rows) via the same handleInspectMasks
          callback. */}
      {maskViewer && <MaskInspectorModal {...maskViewer} onClose={handleCloseMaskViewer} />}

      {/* Loading overlay */}
      {isProcessing && (
        <LoadingOverlay
          message={loadingMessage}
          progress={loadingProgress}
        />
      )}
    </div>
  );
}
