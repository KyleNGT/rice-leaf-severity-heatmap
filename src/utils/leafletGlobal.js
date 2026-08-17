// leaflet-rotate's ESM sources reference a bare global `L` and never import
// leaflet themselves. Leaflet's ESM build doesn't set window.L, so we do.
// This lives in its own module because static imports are hoisted — importing
// leaflet-rotate in the same file would evaluate it before this assignment.
import L from 'leaflet';

if (typeof window !== 'undefined' && !window.L) {
  window.L = L;
}

export default L;
