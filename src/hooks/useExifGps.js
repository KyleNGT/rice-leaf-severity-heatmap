import { useCallback } from 'react';
import ExifReader from 'exifreader';

/**
 * ============================================================
 * useExifGps — Extract GPS coordinates from image EXIF data
 * ============================================================
 * Uses the `exifreader` library to parse EXIF metadata.
 * GPS coordinates are automatically converted from DMS
 * (Degrees / Minutes / Seconds) to decimal degrees.
 *
 * Returns a function `extractGps(file)` that resolves to:
 *   { lat, lng, hasGps: true }   — if GPS data is found
 *   { hasGps: false }            — if not (triggers manual pin)
 */
export function useExifGps() {
  const extractGps = useCallback(async (file) => {
    try {
      const tags = await ExifReader.load(file);

      const latTag = tags['GPSLatitude'];
      const lngTag = tags['GPSLongitude'];
      const latRef = tags['GPSLatitudeRef'];
      const lngRef = tags['GPSLongitudeRef'];

      if (!latTag || !lngTag) {
        return { hasGps: false };
      }

      // ExifReader provides .description as a decimal string
      let lat = parseFloat(latTag.description);
      let lng = parseFloat(lngTag.description);

      if (isNaN(lat) || isNaN(lng)) {
        return { hasGps: false };
      }

      // Apply hemisphere reference (S / W are negative)
      if (latRef && latRef.value && latRef.value[0] === 'S') {
        lat = -Math.abs(lat);
      }
      if (lngRef && lngRef.value && lngRef.value[0] === 'W') {
        lng = -Math.abs(lng);
      }

      return { lat, lng, hasGps: true };
    } catch (err) {
      console.warn('EXIF extraction failed:', err);
      return { hasGps: false };
    }
  }, []);

  return { extractGps };
}
