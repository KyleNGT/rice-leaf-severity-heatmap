import { useEffect, useRef, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { severityToColor } from '../utils/idwInterpolation';

/**
 * ============================================================
 * HeatmapOverlay — Canvas-based IDW Heatmap
 * ============================================================
 * Renders the computed IDW grid as a canvas image overlay,
 * clipped to the field boundary polygon using Canvas clip().
 *
 * Uses L.ImageOverlay with a dynamically generated data URL.
 */
export default function HeatmapOverlay({ grid, cols, rows, bbox, boundary, opacity }) {
  const map = useMap();
  const overlayRef = useRef(null);

  // Generate the heatmap canvas image
  const imageUrl = useMemo(() => {
    if (!grid || !cols || !rows || !bbox || !boundary) return null;

    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');

    const [minLng, minLat, maxLng, maxLat] = bbox;

    // Draw clipping path from the boundary polygon
    const coords = boundary.geometry.coordinates[0];
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < coords.length; i++) {
      const px = ((coords[i][0] - minLng) / (maxLng - minLng)) * cols;
      const py = ((maxLat - coords[i][1]) / (maxLat - minLat)) * rows;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.clip();

    // Paint each grid cell
    const gridData = grid instanceof Float32Array ? grid : new Float32Array(grid);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const value = gridData[idx];
        if (value < 0) continue; // Outside boundary

        ctx.fillStyle = severityToColor(value);
        ctx.fillRect(c, r, 1, 1);
      }
    }

    ctx.restore();

    return canvas.toDataURL('image/png');
  }, [grid, cols, rows, bbox, boundary]);

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
