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
import { useIsMobileViewport } from './hooks/useIsMobileViewport';
import { analyzePlantImage } from './services/mockMLService';
import { computeIDW } from './utils/idwInterpolation';
import { STEPS, HEATMAP_DEFAULT_OPACITY, MAX_SAMPLES } from './constants/constants';
import './App.css';

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
  // { file, thumbnail, lat, lng, analyzing, severity, diseaseDetected,
  //   diseaseName, confidence } — an in-progress sample being edited
  // in the SamplePanel card before the user commits it with "Add Sample".
  const [draftSample, setDraftSample] = useState(null);

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
  const isMobile = useIsMobileViewport();
  const mobileDrawerRef = useRef(null);

  // ── Mobile Center-Anchored Drawing Handlers ────────────────
  const handlePlacePoint = useCallback(() => mobileDrawerRef.current?.placePoint(), []);
  const handleUndoPoint = useCallback(() => mobileDrawerRef.current?.undoLast(), []);
  const handleFinishShape = useCallback(() => mobileDrawerRef.current?.finishShape(), []);

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

  // ── Image Processing Pipeline ──────────────────────────────
  // Selecting a photo (camera or gallery) replaces any uncommitted
  // draft with a new one: thumbnail + EXIF-prefilled (or blank)
  // coordinates immediately, then the mock ML analysis merges in
  // once it resolves. The draft is only added to `samples` when the
  // user taps "Add Sample" in SamplePanel.
  const handleImageSelected = useCallback(
    async (file) => {
      const thumbnail = URL.createObjectURL(file);
      const gps = await extractGps(file);

      setDraftSample({
        file,
        thumbnail,
        lat: gps.hasGps ? gps.lat.toFixed(6) : '',
        lng: gps.hasGps ? gps.lng.toFixed(6) : '',
        analyzing: true,
        severity: null,
        diseaseDetected: null,
        diseaseName: null,
        confidence: null,
      });

      try {
        const result = await analyzePlantImage(file);
        setDraftSample((prev) =>
          // Bail if the draft was replaced/cleared while analyzing
          prev && prev.file === file
            ? {
                ...prev,
                analyzing: false,
                severity: result.severity,
                diseaseDetected: result.diseaseDetected,
                diseaseName: result.diseaseName,
                confidence: result.confidence,
              }
            : prev
        );
      } catch (err) {
        console.error('Sample analysis failed:', err);
        setDraftSample((prev) =>
          prev && prev.file === file ? { ...prev, analyzing: false } : prev
        );
      }
    },
    [extractGps]
  );

  // ── Draft Coordinate Editing ────────────────────────────────
  const handleDraftCoordChange = useCallback((field, value) => {
    setDraftSample((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

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

  // ── Commit Draft Sample ──────────────────────────────────────
  const handleAddSample = useCallback(() => {
    if (!draftSample || draftSample.analyzing || !draftValidity.isValid) return;
    if (samples.length >= MAX_SAMPLES) return;

    const newSample = {
      id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      lat: parseFloat(draftSample.lat),
      lng: parseFloat(draftSample.lng),
      severity: draftSample.severity,
      diseaseDetected: draftSample.diseaseDetected,
      diseaseName: draftSample.diseaseName,
      confidence: draftSample.confidence,
      thumbnail: draftSample.thumbnail,
    };

    setSamples((prev) => [...prev, newSample]);
    setDraftSample(null);
  }, [draftSample, draftValidity, samples.length]);

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

  // ── Reset ──────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setCurrentStep(STEPS.BOUNDARY);
    setBoundary(null);
    setSamples([]);
    setHeatmapData(null);
    setHeatmapOpacity(HEATMAP_DEFAULT_OPACITY);
    setDraftSample(null);
    setMapFullscreen(false);
    // Force a full page reload to reset Leaflet + Geoman state cleanly
    window.location.reload();
  }, []);

  // ── Derived Flags ───────────────────────────────────────────
  // Desktop keeps the side-by-side boxed-card split (with its own
  // enlarge/fullscreen toggle). Mobile instead keeps the map plain
  // full-bleed (like Steps 1 & 3) and floats a draggable bottom sheet
  // over it — see SampleSheet.jsx — so `mapFullscreen`/enlarge never
  // apply on mobile in practice.
  const isDesktopSamplingSplit =
    currentStep === STEPS.SAMPLING && !isMobile && !mapFullscreen;
  const isMobileSampling = currentStep === STEPS.SAMPLING && isMobile;
  const canAddSample =
    !!draftSample &&
    !draftSample.analyzing &&
    draftValidity.isValid &&
    samples.length < MAX_SAMPLES;
  const coordWarning =
    draftSample && draftValidity.hasCoords && !draftValidity.isInside
      ? 'This point is outside your field boundary.'
      : '';

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1 className="app-title">
          <span className="app-logo">🌾</span>
          Rice Leaf Severity
        </h1>
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
            onImageSelected={handleImageSelected}
            onCoordChange={handleDraftCoordChange}
            onAddSample={handleAddSample}
            canAddSample={canAddSample}
            coordWarning={coordWarning}
            disabled={isProcessing}
            isMaxed={samples.length >= MAX_SAMPLES}
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
                    Samples: <span className="upload-counter-value">{samples.length}</span> /{' '}
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
                    ? `Need at least 2 samples (${samples.length}/2)`
                    : `🗺️ Generate Heatmap (${samples.length} samples)`}
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
                Samples: <span className="upload-counter-value">{samples.length}</span> /{' '}
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
                ? `Need at least 2 samples (${samples.length}/2)`
                : `🗺️ Generate Heatmap (${samples.length} samples)`}
            </button>
          </div>

          <SampleSheet
            draft={draftSample}
            onImageSelected={handleImageSelected}
            onCoordChange={handleDraftCoordChange}
            onAddSample={handleAddSample}
            canAddSample={canAddSample}
            coordWarning={coordWarning}
            disabled={isProcessing}
            isMaxed={samples.length >= MAX_SAMPLES}
          />
        </>
      )}

      {/* Action panel — always visible */}
      <ActionPanel
        currentStep={currentStep}
        boundary={boundary}
        onAdvanceStep={advanceToSampling}
        onReset={handleReset}
        heatmapOpacity={heatmapOpacity}
        onOpacityChange={setHeatmapOpacity}
        heatmapData={heatmapData}
        drawingAction={drawingAction}
        onDrawingActionChange={setDrawingAction}
        drawingState={drawingState}
        onPlacePoint={handlePlacePoint}
        onUndoPoint={handleUndoPoint}
        onFinishShape={handleFinishShape}
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
