import { useRef } from 'react';
import { MAX_SAMPLES } from '../constants/constants';

/**
 * ============================================================
 * SamplePanel — Camera / Upload Interface
 * ============================================================
 * Bottom drawer with two actions:
 *   📷 Take Photo — Opens device camera
 *   📁 Upload Photo — Opens gallery
 *
 * Both trigger the parent's onImageSelected callback with
 * the File object and a source indicator.
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

  const handleFileChange = (e, source) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageSelected(file, source);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  return (
    <div className="sample-panel">
      <div className="sample-counter">
        <span className="counter-icon">🌾</span>
        <span className="counter-text">
          Samples: <strong>{sampleCount}</strong> / {MAX_SAMPLES}
        </span>
        {isMaxed && (
          <span className="counter-maxed">Maximum reached</span>
        )}
      </div>

      <div className="sample-actions">
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

        <button
          className="btn btn-capture"
          onClick={() => cameraRef.current?.click()}
          disabled={disabled || isMaxed}
        >
          <span className="btn-icon">📷</span>
          <span>Take Photo</span>
        </button>

        <button
          className="btn btn-upload"
          onClick={() => uploadRef.current?.click()}
          disabled={disabled || isMaxed}
        >
          <span className="btn-icon">📁</span>
          <span>Upload Photo</span>
        </button>
      </div>

      <button
        className="btn btn-accent btn-full"
        disabled={sampleCount < 2}
        onClick={onGenerateHeatmap}
      >
        {sampleCount < 2
          ? `Need at least 2 samples (${sampleCount}/2)`
          : `🗺️ Generate Heatmap (${sampleCount} samples)`}
      </button>
    </div>
  );
}
