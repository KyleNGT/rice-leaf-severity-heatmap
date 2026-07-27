import { CircleMarker, Popup } from 'react-leaflet';
import { severityToColor } from '../utils/idwInterpolation';

/**
 * ============================================================
 * SampleMarker — Color-coded sample node on the map
 * ============================================================
 * Renders a single plant sample as a circle marker, colored
 * by its severity percentage (green → red).
 *
 * The severity shown is pooled across every usable photo taken
 * at that plant, so the popup also reports how many photos
 * back it and how much they disagreed — a node built from one
 * blurry shot and one built from eight should not look alike.
 */
export default function SampleMarker({ sample, index }) {
  const color = severityToColor(sample.severity);
  const photos = sample.images ?? [];
  const usable = sample.usableImageCount ?? photos.length;
  const total = sample.imageCount ?? photos.length;
  const spread = sample.pdlaSpread;

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
          {photos.length > 0 ? (
            <div className="popup-thumbnails">
              {photos.map((photo) => (
                <img
                  key={photo.id}
                  src={photo.thumbnail}
                  alt=""
                  className={`popup-thumbnail ${photo.usable ? '' : 'is-unused'}`}
                />
              ))}
            </div>
          ) : (
            sample.thumbnail && (
              <img src={sample.thumbnail} alt="" className="popup-thumbnail" />
            )
          )}
          <div className="popup-info">
            <span className="popup-label">Plant #{index + 1}</span>
            <span className="popup-disease">{sample.diseaseName}</span>
            <span
              className="popup-severity"
              style={{ color }}
            >
              Severity: {sample.severity.toFixed(1)}%
            </span>
            <span className="popup-meta">
              Pooled from {usable} of {total} {total === 1 ? 'photo' : 'photos'}
              {spread && usable > 1
                ? ` · ${spread.min.toFixed(1)}–${spread.max.toFixed(1)}% per photo`
                : ''}
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
