import { useState, useCallback } from 'react';
import { useMapEvents, Marker } from 'react-leaflet';
import L from 'leaflet';
import * as turf from '@turf/turf';

/**
 * ============================================================
 * ManualPinModal — Tap-to-Place Fallback for Missing GPS
 * ============================================================
 * When an uploaded image lacks EXIF GPS data, this component
 * enters a "tap-to-place" mode. The user taps inside the
 * boundary polygon to set the sample location.
 *
 * Validates that the pin is inside the field boundary via
 * turf.booleanPointInPolygon().
 */

// Custom draggable pin icon
const pinIcon = new L.DivIcon({
  className: 'manual-pin-icon',
  html: `<div class="pin-marker">
    <svg width="32" height="42" viewBox="0 0 32 42" fill="none">
      <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 26 16 26s16-14 16-26C32 7.2 24.8 0 16 0z" fill="#f97316"/>
      <circle cx="16" cy="16" r="8" fill="white"/>
    </svg>
  </div>`,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
});

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click: (e) => onMapClick(e.latlng),
  });
  return null;
}

export default function ManualPinModal({ boundary, onConfirm, onCancel }) {
  const [pinPosition, setPinPosition] = useState(null);
  const [error, setError] = useState('');

  const handleMapClick = useCallback(
    (latlng) => {
      if (!boundary) return;

      const point = turf.point([latlng.lng, latlng.lat]);
      const isInside = turf.booleanPointInPolygon(point, boundary);

      if (!isInside) {
        setError('Pin must be placed inside the field boundary.');
        return;
      }

      setError('');
      setPinPosition(latlng);
    },
    [boundary]
  );

  const handleConfirm = () => {
    if (pinPosition) {
      onConfirm({ lat: pinPosition.lat, lng: pinPosition.lng });
    }
  };

  return (
    <>
      <MapClickHandler onMapClick={handleMapClick} />

      {pinPosition && (
        <Marker
          position={pinPosition}
          icon={pinIcon}
          draggable={true}
          eventHandlers={{
            dragend: (e) => {
              const latlng = e.target.getLatLng();
              const point = turf.point([latlng.lng, latlng.lat]);
              const isInside = turf.booleanPointInPolygon(point, boundary);

              if (!isInside) {
                setError('Pin must be inside the field boundary.');
                e.target.setLatLng(pinPosition); // Revert
              } else {
                setError('');
                setPinPosition(latlng);
              }
            },
          }}
        />
      )}

      <div className="manual-pin-panel">
        <div className="manual-pin-card">
          <div className="manual-pin-header">
            <span className="manual-pin-icon-emoji">📍</span>
            <h3>Set Sample Location</h3>
          </div>
          <p className="manual-pin-hint">
            This photo has no GPS data. Tap on the map inside your field
            boundary to place the sample pin.
          </p>

          {error && <p className="manual-pin-error">{error}</p>}

          {pinPosition && (
            <p className="manual-pin-coords">
              📌 {pinPosition.lat.toFixed(6)}, {pinPosition.lng.toFixed(6)}
            </p>
          )}

          <div className="manual-pin-actions">
            <button
              className="btn btn-secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={!pinPosition}
            >
              Confirm Location
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
