import { useRef } from 'react';
import { MAX_SAMPLES } from '../constants/constants';

/**
 * ============================================================
 * SamplePanel — Plant Upload Panel (Step 2 split layout)
 * ============================================================
 * Occupies one half of the Sampling-step workspace split (left
 * on desktop, top on mobile — see .workspace--split in App.css).
 * Camera and Gallery are one tap each — both funnel through the
 * same onImageSelected(file, source) callback the app already
 * uses for EXIF-GPS extraction / manual-pin fallback.
 */
export default function SamplePanel({
  sampleCount,
  onImageSelected,
  onGenerateHeatmap,
  disabled,
}) {
  const cameraRef = useRef(null);
  const uploadRef = useRef(null);

  const isMaxed = sampleCount >= MAX_SAMPLES;
  const isDisabled = disabled || isMaxed;

  const handleFileChange = (e, source) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageSelected(file, source);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

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
          onChange={(e) => handleFileChange(e, 'camera')}
        />
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => handleFileChange(e, 'upload')}
        />

        <p className="upload-hint">Choose how to add a photo:</p>

        <div className="upload-sources">
          <button
            type="button"
            className="upload-source-btn"
            onClick={() => cameraRef.current?.click()}
            disabled={isDisabled}
          >
            <span aria-hidden="true">📷</span>
            <span>Camera</span>
          </button>
          <button
            type="button"
            className="upload-source-btn"
            onClick={() => uploadRef.current?.click()}
            disabled={isDisabled}
          >
            <span aria-hidden="true">🖼️</span>
            <span>Gallery</span>
          </button>
        </div>

        <div className="upload-counter">
          <span>
            Samples: <span className="upload-counter-value">{sampleCount}</span> / {MAX_SAMPLES}
          </span>
          {isMaxed && <span className="upload-counter-maxed">Maximum reached</span>}
        </div>

        <button
          type="button"
          className="upload-btn-generate"
          disabled={sampleCount < 2}
          onClick={onGenerateHeatmap}
        >
          {sampleCount < 2
            ? `Need at least 2 samples (${sampleCount}/2)`
            : `🗺️ Generate Heatmap (${sampleCount} samples)`}
        </button>
      </div>
    </div>
  );
}
