import { useCallback } from 'react';
import { GEO_TIMEOUT_MS } from '../constants/constants';

/**
 * ============================================================
 * useDeviceLocation — Live GPS Fix via navigator.geolocation
 * ============================================================
 * iOS WebKit strips EXIF (including GPS) from photos captured
 * through `<input capture="environment">`, so a live camera
 * capture can't rely on `useExifGps`. This hook fetches the
 * device's current position directly instead.
 *
 * Returns a function `getLocation()` that resolves to:
 *   { lat, lng, accuracy, timestamp }
 * or rejects with an Error carrying a user-facing message
 * (permission denied / unavailable / timed out).
 *
 * Only call this for the Camera capture flow — never for Gallery
 * uploads, where the device's current location has no relation to
 * where the photo was actually taken.
 */
export function useDeviceLocation() {
  const getLocation = useCallback(
    () =>
      new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Location is not supported on this device. Enter coordinates manually.'));
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              timestamp: pos.timestamp,
            });
          },
          (err) => {
            const messages = {
              1: 'Location permission denied. Enter coordinates manually below.',
              2: 'Location unavailable. Enter coordinates manually below.',
              3: 'Location request timed out. Enter coordinates manually below.',
            };
            reject(new Error(messages[err.code] || 'Could not get location. Enter coordinates manually.'));
          },
          { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 }
        );
      }),
    []
  );

  return { getLocation };
}
