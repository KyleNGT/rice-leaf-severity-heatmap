import { useEffect, useRef, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { renderSesGridToDataUrl } from '../utils/heatmapRaster';

/**
 * ============================================================
 * HeatmapOverlay — Canvas-based SES Heatmap
 * ============================================================
 * Renders one continuous-SES grid (General or a single disease — the
 * caller picks which; see App.jsx's sesLayers/heatmapLayer) as a canvas
 * image overlay, clipped to the field boundary polygon using Canvas clip().
 *
 * Uses L.ImageOverlay with a dynamically generated data URL. The actual
 * rasterization lives in heatmapRaster.js, shared with the PDF export's
 * offscreen figure renderer.
 */
export default function HeatmapOverlay({ grid, cols, rows, bbox, boundary, opacity }) {
  const map = useMap();
  const overlayRef = useRef(null);

  const imageUrl = useMemo(
    () => renderSesGridToDataUrl({ grid, cols, rows, bbox, boundary }),
    [grid, cols, rows, bbox, boundary]
  );

  // Manage the Leaflet overlay
  useEffect(() => {
    if (!imageUrl || !map || !bbox) return;

    const [minLng, minLat, maxLng, maxLat] = bbox;
    const bounds = L.latLngBounds(
      [minLat, minLng],
      [maxLat, maxLng]
    );

    // Remove previous overlay
    if (overlayRef.current) {
      map.removeLayer(overlayRef.current);
    }

    const overlay = L.imageOverlay(imageUrl, bounds, {
      opacity: opacity ?? 0.65,
      interactive: false,
    });

    overlay.addTo(map);
    overlayRef.current = overlay;

    return () => {
      if (overlayRef.current) {
        map.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
    };
  }, [imageUrl, map, bbox, opacity]);

  // Update opacity in real time without re-creating the overlay
  useEffect(() => {
    if (overlayRef.current && opacity !== undefined) {
      overlayRef.current.setOpacity(opacity);
    }
  }, [opacity]);

  return null; // Leaflet manages the DOM
}
