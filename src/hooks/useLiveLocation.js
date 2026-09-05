import { useEffect, useRef, useState } from 'react';
import { GEO_TIMEOUT_MS, LIVE_LOCATION_MAX_AGE_MS } from '../constants/constants';

/**
 * ============================================================
 * useLiveLocation — Continuous GPS Tracking for the "You Are
 * Here" Marker
 * ============================================================
 * `watchPosition` sibling to useDeviceLocation.js's one-shot
 * `getCurrentPosition` (used there for a single camera-capture
 * fix). This one stays open for as long as `enabled` is true,
 * re-resolving every time the device moves, so a marker can
 * track the farmer walking the field. Purely navigational —
 * nothing here ever writes into a plant's recorded coordinates.
 *
 * Requires a secure context (HTTPS or localhost) same as the
 * live in-app camera (see cameraSupport.js) — over the LAN
 * `http://` address used for phone testing against the dev
 * server, `isSupported` is false and no watch is ever started.
 *
 * Returns { position, error, isSupported }:
 *   position — { lat, lng, accuracy, timestamp } or null
 *   error    — a user-facing message string, or null
 */
export function useLiveLocation(enabled) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const watchIdRef = useRef(null);

  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.geolocation &&
    window.isSecureContext === true;

  useEffect(() => {
    if (!enabled || !isSupported) {
      setPosition(null);
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
      },
      (err) => {
        const messages = {
          1: 'Location permission denied.',
          2: 'Location unavailable.',
          3: 'Location request timed out.',
        };
        setError(messages[err.code] || 'Could not get location.');
      },
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: LIVE_LOCATION_MAX_AGE_MS }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setPosition(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isSupported]);

  return { position, error, isSupported };
}
