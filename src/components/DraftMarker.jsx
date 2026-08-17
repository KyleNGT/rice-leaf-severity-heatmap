import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Marker } from 'react-leaflet';
import { sesToColor, sampleSesForLayer } from '../utils/sesScale';
import { HEATMAP_LAYER_GENERAL, DRAFT_MARKER_PENDING_COLOR } from '../constants/constants';

/**
 * ============================================================
 * DraftMarker — Live Preview Pin for an Uncommitted Sample
 * ============================================================
 * While a photo is being staged in SamplePanel (before "Add
 * Sample" is pressed), this renders a preview pin at the
 * lat/lng currently typed into the card's coordinate fields.
 * It re-renders live as those fields change and disappears once
 * the draft is committed or cleared.
 *
 * The pin's fill tracks severity via the SAME sampleSesForLayer →
 * sesToColor chain SampleMarker.jsx uses for committed nodes, so a
 * plant's color never changes when it flips from draft to committed.
 * Always resolved against the General layer (draft pins only ever
 * exist during the Sampling step, where MapView already masks
 * SampleMarker's own activeLayer to null → General too).
 *
 * While `summary.severity` is null — no usable photo yet, whether
 * because analysis is still running or every photo so far failed —
 * the pin shows DRAFT_MARKER_PENDING_COLOR (grey) rather than
 * SES_COLORS[0] (green): a genuinely healthy plant legitimately
 * measures 0% and must read as green, so "unknown" can never share
 * that color.
 */

function buildDraftPinIcon(color, playDrop) {
  return new L.DivIcon({
    className: 'draft-marker-icon',
    html: `<div class="pin-marker${playDrop ? ' pin-marker--drop' : ''}">
    <svg width="32" height="42" viewBox="0 0 32 42" fill="none">
      <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 26 16 26s16-14 16-26C32 7.2 24.8 0 16 0z" fill="${color}"/>
      <circle cx="16" cy="16" r="8" fill="white"/>
      <circle cx="16" cy="16" r="5.5" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="3 2.5"/>
    </svg>
  </div>`,
    iconSize: [32, 42],
    iconAnchor: [16, 42],
  });
}

export default function DraftMarker({ draft, summary }) {
  const lat = parseFloat(draft?.lat);
  const lng = parseFloat(draft?.lng);
  const hasValidCoords = Number.isFinite(lat) && Number.isFinite(lng);

  // Bumped exactly once per NEW draft's first appearance (an invalid→valid
  // coordinate transition). This — not a color comparison — is what the icon
  // memo below keys its "is this a brand new pin" check on: two consecutive
  // drafts can both start out pending/grey, and a plain equality check on
  // color alone can't tell that apart from the same pin re-rendering.
  const [dropSeq, setDropSeq] = useState(0);
  const prevHasCoordsRef = useRef(hasValidCoords);

  useEffect(() => {
    if (hasValidCoords && !prevHasCoordsRef.current) {
      setDropSeq((s) => s + 1);
    }
    prevHasCoordsRef.current = hasValidCoords;
  }, [hasValidCoords]);

  const color =
    summary && summary.severity !== null
      ? sesToColor(sampleSesForLayer(summary, HEATMAP_LAYER_GENERAL))
      : DRAFT_MARKER_PENDING_COLOR;

  // Rebuilds only when the color changes or a new pin has begun — not on
  // every render — because .pin-marker--drop's CSS animation (App.css,
  // pinDrop) replays whenever a freshly built divIcon mounts; baking
  // `playDrop` in unconditionally would bounce the pin on every analysis
  // result, not just its first appearance.
  const lastAnimatedSeqRef = useRef(-1);
  const icon = useMemo(() => {
    const playDrop = lastAnimatedSeqRef.current !== dropSeq;
    lastAnimatedSeqRef.current = dropSeq;
    return buildDraftPinIcon(color, playDrop);
  }, [color, dropSeq]);

  if (!hasValidCoords) return null;

  return <Marker position={[lat, lng]} icon={icon} />;
}
