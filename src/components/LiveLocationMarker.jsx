import { useMemo } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';

/**
 * ============================================================
 * LiveLocationMarker — "You Are Here" Dot
 * ============================================================
 * Purely navigational — never feeds into a plant's recorded
 * coordinates (see CLAUDE.md's Sample Acquisition Methods /
 * location-provenance rules, which this deliberately sits outside of).
 *
 * Renders via react-leaflet's default markerPane, same as SampleMarker
 * and DraftMarker — per CLAUDE.md's Map Rotation section, leaflet-rotate
 * keeps markerPane inside norotatePane, so this marker stays upright and
 * correctly anchored regardless of the map's current bearing with no
 * extra pane handling needed.
 */

function buildIcon() {
  return new L.DivIcon({
    className: 'live-location-icon',
    html: '<div class="live-location-dot"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export default function LiveLocationMarker({ position }) {
  const icon = useMemo(() => buildIcon(), []);

  if (!position) return null;

  return (
    <Marker
      position={[position.lat, position.lng]}
      icon={icon}
      interactive={false}
      keyboard={false}
    />
  );
}
