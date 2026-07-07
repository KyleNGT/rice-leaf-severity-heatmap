import { useRef } from 'react';

/**
 * ============================================================
 * SamplePanel — Plant Upload Panel (Step 2 split layout)
 * ============================================================
 * Occupies one half of the Sampling-step workspace split (left
 * on desktop, top on mobile — see .workspace--split in App.css).
 *
 * Two states:
 *   - No draft: title + hint + Camera/Gallery buttons.
 *   - Draft active: photo preview, editable Lat/Long fields
 *     (pre-filled from EXIF GPS when available), the mock ML
 *     analysis (status + severity), an "Add Sample" button to
 *     commit the draft, then Camera/Gallery again to start the
 *     next one.
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
}) {
  const cameraRef = useRef(null);
  const uploadRef = useRef(null);

  const sourcesDisabled = disabled || isMaxed;

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageSelected(file);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

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

  return (
    <div className="upload-panel">
      <div className="upload-card">
        <h3 className="upload-title">Add Plant Sample</h3>

        {/* Hidden file inputs */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {!draft && (
          <>
            <p className="upload-hint">Choose how to add a photo:</p>
            {sourceButtons}
          </>
        )}

        {draft && (
          <>
            <img className="upload-photo" src={draft.thumbnail} alt="Uploaded rice leaf sample" />

            <div className="upload-field-row">
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
                onChange={(e) => onCoordChange('lat', e.target.value)}
              />
            </div>

            <div className="upload-field-row">
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
                onChange={(e) => onCoordChange('lng', e.target.value)}
              />
            </div>

            {coordWarning && <p className="upload-warning">⚠ {coordWarning}</p>}

            <div className="upload-analysis">
              {draft.analyzing ? (
                <span className="upload-analysis-loading">Analyzing leaf image…</span>
              ) : (
                <>
                  <span className="upload-analysis-row">
                    Status: <strong>{draft.diseaseName}</strong>
                  </span>
                  <span className="upload-analysis-row">
                    Severity: <strong>{draft.severity}%</strong>
                  </span>
                </>
              )}
            </div>

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
      </div>
    </div>
  );
}
