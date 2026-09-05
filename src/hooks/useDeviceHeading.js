import { useEffect, useRef, useState } from 'react';
import { LIVE_LOCATION_HEADING_DEADBAND_DEG } from '../constants/constants';

/**
 * ============================================================
 * useDeviceHeading — Compass Direction for the Live Location Cone
 * ============================================================
 * No prior compass/orientation code exists in this codebase — this is a
 * net-new integration. Three-tier source cascade, most accurate first:
 *
 *   1. iOS Safari: `deviceorientation` event's non-standard
 *      `webkitCompassHeading` — already degrees clockwise from true north.
 *   2. Android Chrome: `deviceorientationabsolute` event's `alpha` —
 *      degrees counter-clockwise from north, so heading = 360 - alpha.
 *   3. Fallback: `gpsHeading` (course over ground from
 *      navigator.geolocation, passed in by the caller) — null while
 *      stationary, which is correct: standing still, there is no course.
 *
 * A small deadband drops sub-threshold jitter so the marker doesn't
 * re-render on compass noise while the phone is simply sitting still.
 *
 * iOS gates DeviceOrientationEvent behind a permission prompt that MUST
 * be requested from within a user-gesture handler (a useEffect call
 * throws) — see needsPermission/requestPermission below, meant to be
 * wired to a button tap (MapLocateControl).
 */
export function useDeviceHeading(enabled, gpsHeading) {
  const [heading, setHeading] = useState(null);
  const [granted, setGranted] = useState(false);
  const lastAppliedRef = useRef(null);

  const needsPermission =
    enabled &&
    !granted &&
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';

  const requestPermission = async () => {
    if (typeof DeviceOrientationEvent === 'undefined' || typeof DeviceOrientationEvent.requestPermission !== 'function') {
      return;
    }
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result === 'granted') setGranted(true);
    } catch {
      // Denied or unsupported — heading falls back to gpsHeading below.
    }
  };

  useEffect(() => {
    if (!enabled) {
      setHeading(null);
      lastAppliedRef.current = null;
      return;
    }
    // iOS requires the explicit permission grant before events fire at all.
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function' && !granted) {
      return;
    }

    let usingAbsolute = false;

    const applyHeading = (value) => {
      if (value === null || Number.isNaN(value)) return;
      if (lastAppliedRef.current !== null) {
        const delta = Math.abs(value - lastAppliedRef.current);
        const wrapped = Math.min(delta, 360 - delta);
        if (wrapped < LIVE_LOCATION_HEADING_DEADBAND_DEG) return;
      }
      lastAppliedRef.current = value;
      setHeading(value);
    };

    const onAbsolute = (event) => {
      if (event.alpha === null) return;
      usingAbsolute = true;
      applyHeading((360 - event.alpha) % 360);
    };

    const onOrientation = (event) => {
      if (usingAbsolute) return; // absolute event, when it fires, wins
      if (typeof event.webkitCompassHeading === 'number') {
        applyHeading(event.webkitCompassHeading);
      }
    };

    window.addEventListener('deviceorientationabsolute', onAbsolute);
    window.addEventListener('deviceorientation', onOrientation);

    return () => {
      window.removeEventListener('deviceorientationabsolute', onAbsolute);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [enabled, granted]);

  // No compass source has reported yet — fall back to GPS course over
  // ground rather than showing no cone at all whenever the farmer is
  // actively walking (heading is meaningful even without a magnetometer).
  const effectiveHeading = heading !== null ? heading : gpsHeading;

  return { heading: effectiveHeading, needsPermission, requestPermission };
}
