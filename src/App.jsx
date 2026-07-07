import { useState, useCallback, useRef } from 'react';
import * as turf from '@turf/turf';
import MapView from './components/MapView';
import StepperBar from './components/StepperBar';
import SamplePanel from './components/SamplePanel';
import ActionPanel from './components/ActionPanel';
import ColorLegend from './components/ColorLegend';
import LoadingOverlay from './components/LoadingOverlay';
import { useExifGps } from './hooks/useExifGps';
import { useIsMobileViewport } from './hooks/useIsMobileViewport';
import { analyzePlantImage } from './services/mockMLService';
import { computeIDW } from './utils/idwInterpolation';
import { STEPS, HEATMAP_DEFAULT_OPACITY } from './constants/constants';
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

  // ── Manual Pin State ───────────────────────────────────────
  const [manualPinMode, setManualPinMode] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);

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
  const handleImageSelected = useCallback(
    async (file, _source) => {
      // 1. Create thumbnail for popup display
      const thumbnail = URL.createObjectURL(file);

      // 2. Extract GPS from EXIF
      const gps = await extractGps(file);

      if (gps.hasGps) {
        // Validate point is inside boundary
        const point = turf.point([gps.lng, gps.lat]);
        const isInside = turf.booleanPointInPolygon(point, boundary);

        if (!isInside) {
          // If GPS is outside boundary, fall back to manual pin
          setPendingImage({ file, thumbnail });
          setManualPinMode(true);
          return;
        }

        // Process directly with extracted GPS
        await processNewSample(file, thumbnail, gps.lat, gps.lng);
      } else {
        // No GPS data — trigger manual pin placement
        setPendingImage({ file, thumbnail });
        setManualPinMode(true);
      }
    },
    [boundary, extractGps]
  );

  // ── Manual Pin Handlers ────────────────────────────────────
  const handleManualPinConfirm = useCallback(
    async (coords) => {
      setManualPinMode(false);
      if (pendingImage) {
        await processNewSample(
          pendingImage.file,
          pendingImage.thumbnail,
          coords.lat,
          coords.lng
        );
        setPendingImage(null);
      }
    },
    [pendingImage]
  );

  const handleManualPinCancel = useCallback(() => {
    setManualPinMode(false);
    setPendingImage(null);
  }, []);

  // ── Sample Processing ──────────────────────────────────────
  async function processNewSample(file, thumbnail, lat, lng) {
    setIsProcessing(true);
    setLoadingMessage('Analyzing leaf image...');

    try {
      const result = await analyzePlantImage(file);

      const newSample = {
        id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        lat,
        lng,
        severity: result.severity,
        diseaseDetected: result.diseaseDetected,
        diseaseName: result.diseaseName,
        confidence: result.confidence,
        thumbnail,
      };

      setSamples((prev) => [...prev, newSample]);
    } catch (err) {
      console.error('Sample processing failed:', err);
    } finally {
      setIsProcessing(false);
      setLoadingMessage('');
    }
  }

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
    setManualPinMode(false);
    setPendingImage(null);
    // Force a full page reload to reset Leaflet + Geoman state cleanly
    window.location.reload();
  }, []);

  // ── Derived Flags ───────────────────────────────────────────
  const isSamplingSplit = currentStep === STEPS.SAMPLING && !manualPinMode;

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
          panel during Sampling (row on desktop, column on mobile) */}
      <div className={`workspace ${isSamplingSplit ? 'workspace--split' : ''}`}>
        {/* Upload panel — visible during sampling step, occupies its half */}
        {isSamplingSplit && (
          <SamplePanel
            sampleCount={samples.length}
            onImageSelected={handleImageSelected}
            onGenerateHeatmap={handleGenerateHeatmap}
            disabled={isProcessing}
          />
        )}

        {/* Map panel — always the same wrapper nesting so <MapView>'s
            persistent <MapContainer> is never remounted; the "boxed
            card" look (title + inset map) is applied purely via CSS
            scoped under .workspace--split, so Steps 1 & 3 stay
            full-screen and pixel-identical to before. */}
        <div className="map-panel">
          <div className="map-card">
            {isSamplingSplit && <h3 className="map-title">Your Field</h3>}
            <div className="map-box">
              <MapView
                currentStep={currentStep}
                boundary={boundary}
                onBoundaryCreated={handleBoundaryCreated}
                samples={samples}
                heatmapData={heatmapData}
                heatmapOpacity={heatmapOpacity}
                manualPinMode={manualPinMode}
                onManualPinConfirm={handleManualPinConfirm}
                onManualPinCancel={handleManualPinCancel}
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
            </div>
          </div>
        </div>
      </div>

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
