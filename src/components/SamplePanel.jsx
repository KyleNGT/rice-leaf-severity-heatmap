import { useRef, useState } from 'react';

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
 * Two states:
 *   - No draft: title + hint + Camera/Gallery buttons.
 *   - Draft active: a compact photo thumbnail (tap to view full
 *     size), a side-by-side Lat/Long row (pre-filled from EXIF GPS
 *     when available) with helper/warning text directly beneath,
 *     the mock ML analysis as inline Status/Severity/Confidence
 *     pills, an "Add Sample" button to commit the draft, then
 *     Camera/Gallery again to start the next one.
 *
 * `bare`: when true, skip the outer .upload-panel/.upload-card
 * wrapper and the title — the parent (SampleSheet) supplies both.
 */
export default function SamplePanel({
  draft,
  onImageSelected,
  onCoordChange,
  onAddSample,
  canAddSample,
  coordWarning,
  disabled,
  isMaxed,
  bare = false,
}) {
  const cameraRef = useRef(null);
  const uploadRef = useRef(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const sourcesDisabled = disabled || isMaxed;
  const confidencePct =
    draft?.confidence != null ? Math.round(parseFloat(draft.confidence) * 100) : null;

  const handleFileChange = (source) => (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageSelected(file, source);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const locationSourceLabel = {
    gps: 'From GPS',
    exif: 'From photo',
    manual: 'Manual',
  }[draft?.locationSource];

  const sourceButtons = (
    <div className="upload-sources">
      <button
        type="button"
        className="upload-source-btn"
        onClick={() => cameraRef.current?.click()}
        disabled={sourcesDisabled}
      >
        <span aria-hidden="true">📷</span>
        <span>Camera</span>
      </button>
      <button
        type="button"
        className="upload-source-btn"
        onClick={() => uploadRef.current?.click()}
        disabled={sourcesDisabled}
      >
        <span aria-hidden="true">🖼️</span>
        <span>Gallery</span>
      </button>
    </div>
  );

  const content = (
    <>
      {/* Hidden file inputs */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange('camera')}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange('gallery')}
      />

      {!draft && (
        <>
          <p className="upload-hint">Choose how to add a photo:</p>
          {sourceButtons}
        </>
      )}

      {draft && (
        <>
          <button
            type="button"
            className="upload-photo-btn"
            onClick={() => setLightboxOpen(true)}
            aria-label="View full-size photo"
          >
            <img className="upload-photo" src={draft.thumbnail} alt="Uploaded rice leaf sample" />
            <span className="upload-photo-expand" aria-hidden="true">
              ⤢
            </span>
          </button>

          {draft.locating && (
            <p className="upload-analysis-loading">📍 Getting your location…</p>
          )}

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

          {draft.locationError && (
            <p className="upload-warning">⚠ {draft.locationError}</p>
          )}

          {coordWarning && <p className="upload-warning">⚠ {coordWarning}</p>}

          {draft.analyzing ? (
            <p className="upload-analysis-loading">Analyzing leaf image…</p>
          ) : (
            <div className="upload-metrics">
              <div className="upload-metric">
                <span className="upload-metric-label">Status</span>
                <span className="upload-metric-value">{draft.diseaseName}</span>
              </div>
              <div className="upload-metric">
                <span className="upload-metric-label">Severity</span>
                <span className="upload-metric-value">{draft.severity}%</span>
              </div>
              {confidencePct != null && (
                <div className="upload-metric">
                  <span className="upload-metric-label">Confidence</span>
                  <span className="upload-metric-value">{confidencePct}%</span>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            className="upload-btn-add"
            disabled={!canAddSample}
            onClick={onAddSample}
          >
            + Add Sample
          </button>

          <p className="upload-divider">Add Another Photo</p>
          {sourceButtons}
        </>
      )}
    </>
  );

  const lightbox = draft && lightboxOpen && (
    <div className="upload-lightbox" onClick={() => setLightboxOpen(false)}>
      <img src={draft.thumbnail} alt="Uploaded rice leaf sample, full size" />
      <button
        type="button"
        className="upload-lightbox-close"
        onClick={() => setLightboxOpen(false)}
        aria-label="Close full-size photo"
      >
        ✕
      </button>
    </div>
  );

  if (bare) {
    return (
      <>
        {content}
        {lightbox}
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
    </div>
  );
}
