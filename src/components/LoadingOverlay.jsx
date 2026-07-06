/**
 * ============================================================
 * LoadingOverlay — Full-screen spinner with contextual message
 * ============================================================
 * Used during mock ML processing and IDW computation.
 */
export default function LoadingOverlay({ message, progress }) {
  return (
    <div className="loading-overlay">
      <div className="loading-card">
        <div className="loading-spinner" />
        <p className="loading-message">{message || 'Processing...'}</p>
        {progress !== undefined && progress !== null && (
          <div className="loading-progress-wrapper">
            <div className="loading-progress-bar">
              <div
                className="loading-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="loading-progress-text">{progress}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
