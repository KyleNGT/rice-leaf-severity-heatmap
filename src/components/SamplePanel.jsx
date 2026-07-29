import { useRef, useState } from 'react';
import { leafQualityWarning } from '../utils/aggregateSample';
import { MAX_IMAGES_PER_SAMPLE } from '../constants/constants';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';

/**
 * ============================================================
 * SamplePanel — Plant Sample Form (shared by desktop + mobile)
 * ============================================================
 * On desktop this occupies one half of the Sampling-step
 * workspace split (see .workspace--split in App.css). On mobile
 * it's rendered `bare` inside the SampleSheet bottom sheet
 * (see SampleSheet.jsx), which supplies its own card chrome and
 * sticky "Add Plant Sample" title in the drag handle.
 *
 * One card stages one PLANT, built from up to
 * MAX_IMAGES_PER_SAMPLE photos — a rice leaf is long enough to
 * need several frames, and field sampling covers several leaves
 * per plant.
 *
 * Two states:
 *   - No draft: hint + Camera/Gallery buttons.
 *   - Draft active: a scrolling strip of photo tiles (each with
 *     its own severity, warning, retry and remove), a labeled
 *     "+ Add another leaf photo" Camera/Gallery pair (styled as a
 *     distinct "add" affordance so it isn't mistaken for starting
 *     a new plant), the pooled plant-level result, a side-by-side
 *     Lat/Long row, and a Discard Plant / Save Plant action row
 *     (destructive red vs. primary emerald).
 *
 * Camera/Gallery taps open their file input directly, but that's not the
 * end of the road: App.jsx queues whatever's picked for ImageAlignmentModal
 * (rendered there, not here) — the mandatory crop step every photo passes
 * through, against one static framing rectangle, before it becomes a draft
 * image. See useAlignmentQueue.js.
 *
 * `bare`: when true, skip the outer .upload-panel/.upload-card
 * wrapper and the title — the parent (SampleSheet) supplies both.
 */
export default function SamplePanel({
  draft,
  summary,
  onImagesSelected,
  onCoordChange,
  onAddSample,
  onRemoveImage,
  onRetryImage,
  onDismissImageWarning,
  onDiscardDraft,
  canAddSample,
  coordWarning,
  disabled,
  isMaxed,
  isImagesMaxed,
  bare = false,
}) {
  const cameraRef = useRef(null);
  const uploadRef = useRef(null);
  const isMobile = useIsMobileViewport();
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const sourcesDisabled = disabled || isMaxed || isImagesMaxed;
  const images = draft?.images ?? [];

  const handleFileChange = (source) => (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onImagesSelected(files, source);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const locationSourceLabel = {
    gps: 'From GPS',
    exif: 'From photo',
    manual: 'Manual',
  }[draft?.locationSource];

  const sourceButtons = (variant) => (
    <div className={`upload-sources${variant === 'add' ? ' upload-sources--add' : ''}`}>
      {isMobile && (
        <button
          type="button"
          className="upload-source-btn"
          onClick={() => cameraRef.current?.click()}
          disabled={sourcesDisabled}
        >
          <span>Camera</span>
        </button>
      )}
      <button
        type="button"
        className="upload-source-btn"
        onClick={() => uploadRef.current?.click()}
        disabled={sourcesDisabled}
      >
        <span>{isMobile ? 'Gallery' : 'Upload Photos'}</span>
      </button>
    </div>
  );

  // One tile per photo. Everything about a photo's fate — still working,
  // failed, quality-flagged, or counted — is legible from its own tile, so
  // the farmer can see which shot to retake without reading a summary.
  const photoTile = (image, index) => {
    const warning = image.analyzing || image.error ? '' : leafQualityWarning(image.result);
    const flagged = !!warning && !image.dismissedWarning;
    const severity = image.result?.status === 'ok' ? image.result.severity : null;

    let stateClass = 'is-ok';
    if (image.analyzing) stateClass = 'is-analyzing';
    else if (image.error) stateClass = 'is-failed';
    else if (flagged) stateClass = 'is-flagged';

    return (
      <li key={image.id} className={`upload-photo-tile ${stateClass}`}>
        <button
          type="button"
          className="upload-photo-tile-view"
          onClick={() => setLightboxSrc(image.thumbnail)}
          aria-label={`View photo ${index + 1} full size`}
        >
          <img className="upload-photo" src={image.thumbnail} alt={`Rice leaf photo ${index + 1}`} />
          <span className="upload-photo-tile-badge">
            {image.analyzing
              ? '…'
              : image.error
                ? '⚠'
                : flagged
                  ? '⚠'
                  : severity != null
                    ? `${severity.toFixed(1)}%`
                    : '—'}
          </span>
        </button>

        <button
          type="button"
          className="upload-photo-tile-remove"
          onClick={() => onRemoveImage(image.id)}
          aria-label={`Remove photo ${index + 1}`}
        >
          ✕
        </button>

        {(image.error || flagged) && (
          <div className="upload-photo-tile-note">
            <p className="upload-warning">⚠ {image.error || warning}</p>
            <div className="upload-photo-tile-actions">
              {image.error && (
                <button
                  type="button"
                  className="upload-mini-btn"
                  onClick={() => onRetryImage(image.id)}
                >
                  Try again
                </button>
              )}
              {flagged && (
                <button
                  type="button"
                  className="upload-mini-btn"
                  onClick={() => onDismissImageWarning(image.id)}
                >
                  Use anyway
                </button>
              )}
            </div>
          </div>
        )}
      </li>
    );
  };

  // Pooled result for the whole plant. Deliberately shows no aggregate
  // confidence — see the note in App.jsx's handleAddSample.
  const plantSummary = summary && (
    <div className="upload-plant-summary">
      <div className="upload-metrics">
        <div className="upload-metric">
          <span className="upload-metric-label">Status</span>
          <span className="upload-metric-value">
            {summary.severity == null ? '—' : summary.diseaseName}
          </span>
        </div>
        <div className="upload-metric">
          <span className="upload-metric-label">Severity</span>
          <span className="upload-metric-value">
            {summary.severity == null ? '—' : `${summary.severity.toFixed(1)}%`}
          </span>
        </div>
        <div className="upload-metric">
          <span className="upload-metric-label">Photos used</span>
          <span className="upload-metric-value">
            {summary.usableCount} / {summary.totalCount}
          </span>
        </div>
      </div>

      {summary.analyzingCount > 0 && (
        <p className="upload-analysis-loading">
          Analyzing {summary.analyzingCount} of {summary.totalCount} photos…
        </p>
      )}

      {summary.analyzingCount === 0 && summary.usableCount === 0 && (
        <p className="upload-warning">
          ⚠ None of these photos could be analyzed. Retake at least one to save this plant.
        </p>
      )}

      {summary.analyzingCount === 0 &&
        summary.usableCount > 0 &&
        summary.totalCount > summary.usableCount && (
          <p className="upload-summary-note">
            {summary.totalCount - summary.usableCount} of {summary.totalCount} photos were left out
            of this result.
          </p>
        )}

      {summary.usableCount > 0 && (
        <p className="upload-summary-note">
          Severity is pooled across the leaf area in {summary.usableCount}{' '}
          {summary.usableCount === 1 ? 'photo' : 'photos'}
          {summary.pdlaSpread && summary.usableCount > 1
            ? ` · per photo ${summary.pdlaSpread.min.toFixed(1)}–${summary.pdlaSpread.max.toFixed(1)}%`
            : ''}
          {summary.confidenceRange
            ? ` · confidence ${summary.confidenceRange[0].toFixed(2)}–${summary.confidenceRange[1].toFixed(2)}`
            : ''}
        </p>
      )}
    </div>
  );

  const content = (
    <>
      {/* Hidden file inputs. Camera is single-shot by nature and desktop-only
          browsers ignore capture="environment" anyway, so it's mobile-only;
          Gallery takes several at once so a plant's photos can be picked in
          one go, and is the only source on desktop. */}
      {isMobile && (
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleFileChange('camera')}
        />
      )}
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange('gallery')}
      />

      {!draft && (
        <>
          <p className="upload-hint">
            {isMobile ? 'Take photos' : 'Upload photos'} of several leaves from one plant. A
            long leaf may need more than one photo.
          </p>
          {sourceButtons()}
        </>
      )}

      {draft && (
        <>
          <div className="upload-photo-header">
            <span className="upload-label">
              Photos of this plant ({images.length}/{MAX_IMAGES_PER_SAMPLE})
            </span>
          </div>

          <ul className="upload-photo-strip">{images.map(photoTile)}</ul>

          {isImagesMaxed ? (
            <p className="upload-summary-note">
              Photo limit reached for this plant. Save it and start the next one.
            </p>
          ) : (
            <div className="upload-add-leaf">
              <span className="upload-add-leaf-label">+ Add another leaf photo</span>
              {sourceButtons('add')}
            </div>
          )}

          {plantSummary}

          {draft.locating && <p className="upload-analysis-loading">📍 Getting your location…</p>}

          <div className="upload-coords">
            <div className="upload-field">
              <label className="upload-label" htmlFor="draft-lat">
                Latitude
              </label>
              <input
                id="draft-lat"
                className="upload-input"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 15.470000"
                value={draft.lat}
                disabled={draft.locating}
                onChange={(e) => onCoordChange('lat', e.target.value)}
              />
            </div>

            <div className="upload-field">
              <label className="upload-label" htmlFor="draft-lng">
                Longitude
              </label>
              <input
                id="draft-lng"
                className="upload-input"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 120.590000"
                value={draft.lng}
                disabled={draft.locating}
                onChange={(e) => onCoordChange('lng', e.target.value)}
              />
            </div>
          </div>

          {locationSourceLabel && !draft.locating && (
            <p className="upload-location-source">📍 {locationSourceLabel}</p>
          )}

          {draft.locationError && <p className="upload-warning">⚠ {draft.locationError}</p>}

          {coordWarning && <p className="upload-warning">⚠ {coordWarning}</p>}

          <div className="upload-actions-row">
            <button
              type="button"
              className="upload-btn-discard"
              onClick={() => setConfirmingDiscard(true)}
            >
              Discard Plant
            </button>
            <button
              type="button"
              className="upload-btn-add"
              disabled={!canAddSample}
              onClick={onAddSample}
            >
              + Save Plant
            </button>
          </div>
        </>
      )}
    </>
  );

  const lightbox = lightboxSrc && (
    <div className="upload-lightbox" onClick={() => setLightboxSrc(null)}>
      <img src={lightboxSrc} alt="Rice leaf photo, full size" />
      <button
        type="button"
        className="upload-lightbox-close"
        onClick={() => setLightboxSrc(null)}
        aria-label="Close full-size photo"
      >
        ✕
      </button>
    </div>
  );

  const discardConfirm = confirmingDiscard && draft && (
    <div className="upload-confirm-overlay" onClick={() => setConfirmingDiscard(false)}>
      <div
        className="upload-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="discard-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="discard-confirm-title" className="upload-confirm-title">
          Discard this plant?
        </p>
        <p className="upload-confirm-body">
          {images.length} {images.length === 1 ? 'photo' : 'photos'} and this plant&apos;s
          location will be lost. This can&apos;t be undone.
        </p>
        <div className="upload-confirm-actions">
          <button
            type="button"
            className="upload-mini-btn"
            onClick={() => setConfirmingDiscard(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="upload-btn-discard-confirm"
            onClick={() => {
              setConfirmingDiscard(false);
              onDiscardDraft();
            }}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );

  if (bare) {
    return (
      <>
        {content}
        {lightbox}
        {discardConfirm}
      </>
    );
  }

  return (
    <div className="upload-panel">
      <div className="upload-card">
        <h3 className="upload-title">Add Plant Sample</h3>
        {content}
      </div>
      {lightbox}
      {discardConfirm}
    </div>
  );
}
