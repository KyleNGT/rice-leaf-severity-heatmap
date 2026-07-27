import { useState, useCallback, useMemo, useRef } from 'react';
import * as turf from '@turf/turf';
import MapView from './components/MapView';
import StepperBar from './components/StepperBar';
import SamplePanel from './components/SamplePanel';
import SampleSheet from './components/SampleSheet';
import ActionPanel from './components/ActionPanel';
import ColorLegend from './components/ColorLegend';
import LoadingOverlay from './components/LoadingOverlay';
import { useExifGps } from './hooks/useExifGps';
import { useDeviceLocation } from './hooks/useDeviceLocation';
import { useIsMobileViewport } from './hooks/useIsMobileViewport';
import { analyzePlantImage } from './services/mockMLService';
import { computeIDW } from './utils/idwInterpolation';
import { summarizePlant, isUsableImage } from './utils/aggregateSample';
import { makeThumbnails } from './utils/makeThumbnail';
import {
  STEPS,
  HEATMAP_DEFAULT_OPACITY,
  MAX_SAMPLES,
  MAX_IMAGES_PER_SAMPLE,
} from './constants/constants';
import './App.css';

let imageSeq = 0;

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

  // ── Map Fullscreen State ────────────────────────────────────
  const [mapFullscreen, setMapFullscreen] = useState(false);

  // ── Heatmap State ──────────────────────────────────────────
  const [heatmapData, setHeatmapData] = useState(null);
  const [heatmapOpacity, setHeatmapOpacity] = useState(HEATMAP_DEFAULT_OPACITY);

  // ── Boundary Drawing UI State ──────────────────────────────
  const [drawingAction, setDrawingAction] = useState(null); // 'draw' | 'edit' | 'clear' | null
  const [drawingState, setDrawingState] = useState({ isDrawing: false, vertexCount: 0 });

  // ── Hooks ──────────────────────────────────────────────────
  const { extractGps } = useExifGps();
  const { getLocation } = useDeviceLocation();
  const isMobile = useIsMobileViewport();
  const mobileDrawerRef = useRef(null);
  const desktopDrawerRef = useRef(null);

  // ── Mobile Center-Anchored Drawing Handlers ────────────────
  const handlePlacePoint = useCallback(() => mobileDrawerRef.current?.placePoint(), []);
  const handleUndoPoint = useCallback(() => mobileDrawerRef.current?.undoLast(), []);
  const handleFinishShape = useCallback(() => mobileDrawerRef.current?.finishShape(), []);

  // ── Desktop Drawing Handlers ────────────────────────────────
  const handleUndoVertex = useCallback(() => desktopDrawerRef.current?.undoLastVertex(), []);

  // ── Boundary Handler ───────────────────────────────────────
  const handleBoundaryCreated = useCallback((geoJSON) => {
    setBoundary(geoJSON);
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
  // Photos APPEND to the current plant draft (creating one if there isn't
  // yet), each analyzed independently. The plant only enters `samples` when
  // the user taps "Save Plant"; canAddSample requires at least one usable
  // photo and a non-null pooled severity, so a plant whose photos all failed
  // can never reach the interpolation grid.
  //
  // Location is resolved ONCE PER PLANT, not per photo — the farmer walks
  // around a single plant taking several shots, and re-fixing GPS each time
  // would jitter the pin. It branches by `source`:
  //   - 'camera' (live capture): NEVER read EXIF — iOS WebKit strips GPS
  //     from camera-captured photos anyway — so fetch a live fix via
  //     navigator.geolocation (useDeviceLocation) instead.
  //   - 'gallery' (deferred upload): NEVER call navigator.geolocation — the
  //     device's current position has no relation to where a previously-taken
  //     photo was shot (e.g. uploading from the office later). Best-effort
  //     EXIF GPS instead.
  // Either way, coordinates already set are never overwritten, and a manual
  // edit is never overridden. Both paths fall back to the lat/lng fields.
  const handleImagesSelected = useCallback(
    async (fileList, source) => {
      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;

      const isCamera = source === 'camera';
      const candidates = files.map((file) => newDraftImage(file, source));

      // Decided synchronously against the live draft, so the code below
      // knows exactly which photos it took on.
      const prev = draftRef.current;
      const existing = prev?.images ?? [];
      const room = Math.max(0, MAX_IMAGES_PER_SAMPLE - existing.length);
      const accepted = candidates.slice(0, room);

      // Photos beyond MAX_IMAGES_PER_SAMPLE never enter state — release
      // their blobs rather than leaking them for the session.
      for (const candidate of candidates.slice(accepted.length)) {
        URL.revokeObjectURL(candidate.thumbnail);
      }
      if (accepted.length === 0) return;

      const shouldLocate =
        isCamera &&
        !prev?.locating &&
        prev?.locationSource !== 'manual' &&
        !(prev?.lat || prev?.lng);

      applyDraft(
        prev
          ? {
              ...prev,
              images: [...existing, ...accepted],
              locating: prev.locating || shouldLocate,
            }
          : {
              images: accepted,
              lat: '',
              lng: '',
              locating: shouldLocate,
              locationSource: null,
              locationError: '',
              capturedAt: null,
            }
      );

      for (const candidate of accepted) {
        runAnalysis(candidate.id, candidate.file);
      }

      if (shouldLocate) {
        try {
          const pos = await getLocation();
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
        } catch (err) {
          applyDraft((current) =>
            current ? { ...current, locating: false, locationError: err.message } : current
          );
        }
        return;
      }

      if (!isCamera) {
        const gps = await extractGps(files[0]);
        if (!gps.hasGps) return;

        applyDraft((current) => {
          if (!current) return current;
          // Fill only a blank plant. A coordinate already set — by GPS, by an
          // earlier photo's EXIF, or by hand — stays put.
          if (current.locationSource === 'manual' || current.lat || current.lng) return current;

          return {
            ...current,
            lat: gps.lat.toFixed(6),
            lng: gps.lng.toFixed(6),
            locationSource: 'exif',
            locationError: '',
          };
        });
      }
    },
    [applyDraft, extractGps, getLocation, runAnalysis]
  );

  // ── Per-Photo Actions ───────────────────────────────────────
  const handleRemoveDraftImage = useCallback(
    (imageId) => {
      const target = draftRef.current?.images.find((image) => image.id === imageId);
      if (!target) return;

      URL.revokeObjectURL(target.thumbnail);

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
          severity: image.result?.status === 'ok' ? image.result.severity : null,
          diseaseName: image.result?.status === 'ok' ? image.result.diseaseName : null,
          confidence: image.result?.confidence ?? null,
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

      setSamples((prev) => [...prev, newSample]);
      applyDraft(null);
    } finally {
      committingRef.current = false;
    }
  }, [applyDraft, draftSample, draftSummary, draftValidity, samples.length]);

  // ── Heatmap Generation ─────────────────────────────────────
  const handleGenerateHeatmap = useCallback(async () => {
    if (samples.length < 2 || !boundary) return;

    setIsProcessing(true);
    setLoadingMessage('Computing disease pressure map...');
    setLoadingProgress(0);
    setCurrentStep(STEPS.HEATMAP);

    try {
      const result = await computeIDW(samples, boundary, (progress) => {
        setLoadingProgress(progress);
      });

      setHeatmapData(result);
    } catch (err) {
      console.error('IDW computation failed:', err);
    } finally {
      setIsProcessing(false);
      setLoadingMessage('');
      setLoadingProgress(null);
    }
  }, [samples, boundary]);

  // ── Resume Sampling ────────────────────────────────────────
  // Return to Step 2 keeping boundary + existing samples. Clear the
  // heatmap so the map is clean for new sampling; the user regenerates
  // it (over the fuller sample set) with the existing Generate button.
  const handleResumeSampling = useCallback(() => {
    setHeatmapData(null);
    setCurrentStep(STEPS.SAMPLING);
  }, []);

  // ── Reset ──────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setCurrentStep(STEPS.BOUNDARY);
    setBoundary(null);
    setSamples([]);
    setHeatmapData(null);
    setHeatmapOpacity(HEATMAP_DEFAULT_OPACITY);
    applyDraft(null);
    setMapFullscreen(false);
    // Force a full page reload to reset Leaflet + Geoman state cleanly
    window.location.reload();
  }, [applyDraft]);

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
                heatmapData={heatmapData}
                heatmapOpacity={heatmapOpacity}
                draftSample={draftSample}
                mapFullscreen={mapFullscreen}
                drawingAction={drawingAction}
                onDrawingActionChange={setDrawingAction}
                onDrawingStateChange={setDrawingState}
                mobileDrawerRef={mobileDrawerRef}
                desktopDrawerRef={desktopDrawerRef}
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
                  disabled={samples.length < 2}
                  onClick={handleGenerateHeatmap}
                >
                  {samples.length < 2
                    ? `Need at least 2 plants (${samples.length}/2)`
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
              disabled={samples.length < 2}
              onClick={handleGenerateHeatmap}
            >
              {samples.length < 2
                ? `Need at least 2 plants (${samples.length}/2)`
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
        drawingAction={drawingAction}
        onDrawingActionChange={setDrawingAction}
        drawingState={drawingState}
        onPlacePoint={handlePlacePoint}
        onUndoPoint={handleUndoPoint}
        onFinishShape={handleFinishShape}
        onUndoVertex={handleUndoVertex}
      />

      {/* Color legend — visible when heatmap is shown */}
      {currentStep === STEPS.HEATMAP && heatmapData && <ColorLegend />}

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
