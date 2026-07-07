import L from 'leaflet';
import { Marker } from 'react-leaflet';

/**
 * ============================================================
 * DraftMarker — Live Preview Pin for an Uncommitted Sample
 * ============================================================
 * While a photo is being staged in SamplePanel (before "Add
 * Sample" is pressed), this renders a preview pin at the
 * lat/lng currently typed into the card's coordinate fields.
 * It re-renders live as those fields change and disappears once
 * the draft is committed or cleared.
 */

// Reuses the orange pin styling previously used by ManualPinModal.
const draftPinIcon = new L.DivIcon({
  className: 'draft-marker-icon',
  html: `<div class="pin-marker">
    <svg width="32" height="42" viewBox="0 0 32 42" fill="none">
      <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 26 16 26s16-14 16-26C32 7.2 24.8 0 16 0z" fill="#f97316"/>
      <circle cx="16" cy="16" r="8" fill="white"/>
    </svg>
  </div>`,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
});

export default function DraftMarker({ draft }) {
  if (!draft) return null;

  const lat = parseFloat(draft.lat);
  const lng = parseFloat(draft.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return <Marker position={[lat, lng]} icon={draftPinIcon} />;
}
