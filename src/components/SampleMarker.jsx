import { CircleMarker, Popup } from 'react-leaflet';
import { severityToColor } from '../utils/idwInterpolation';

/**
 * ============================================================
 * SampleMarker — Color-coded sample node on the map
 * ============================================================
 * Renders a single plant sample as a circle marker, colored
 * by its severity percentage (green → red).
 */
export default function SampleMarker({ sample, index }) {
  const color = severityToColor(sample.severity);

  return (
    <CircleMarker
      center={[sample.lat, sample.lng]}
      radius={10}
      pathOptions={{
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      }}
    >
      <Popup className="sample-popup" closeButton={false}>
        <div className="popup-content">
          {sample.thumbnail && (
            <img
              src={sample.thumbnail}
              alt={`Sample ${index + 1}`}
              className="popup-thumbnail"
            />
          )}
          <div className="popup-info">
            <span className="popup-label">Sample #{index + 1}</span>
            <span className="popup-disease">{sample.diseaseName}</span>
            <span
              className="popup-severity"
              style={{ color }}
            >
              Severity: {sample.severity}%
            </span>
            <span className="popup-coords">
              {sample.lat.toFixed(6)}, {sample.lng.toFixed(6)}
            </span>
          </div>
        </div>
      </Popup>
    </CircleMarker>
  );
}
