import { useMemo } from 'react';
import { Marker, Popup, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { sesToColor, sampleSesForLayer, pdlaToSes } from '../utils/sesScale';
import { HEATMAP_LAYER_GENERAL } from '../constants/constants';

const COMPACT_THUMBNAIL_LIMIT = 4;

/**
 * Per-disease SES breakdown for a plant — General (MAX() of every disease's
 * SES, see sesGrid.js) plus one row per disease this checkpoint reports, so
 * a node's popup carries the same layers the heatmap toggle offers. Renders
 * nothing before any sample has ever carried diseaseLabels (defensive only —
 * every sample committed by this build always has them).
 */
function DiseaseSesTable({ sample }) {
  const labels = sample.diseaseLabels ?? [];
  if (labels.length === 0) return null;

  const generalSes = Math.floor(sampleSesForLayer(sample, HEATMAP_LAYER_GENERAL));

  return (
    <div className="popup-ses-table">
      <div className="popup-ses-row popup-ses-row--general">
        <span>General threat</span>
        <span>SES {generalSes}</span>
      </div>
      {labels.map((label) => {
        const pdla = sample.diseaseSeverity?.[label] ?? 0;
        const ses = pdlaToSes(pdla, label);
        return (
          <div className="popup-ses-row" key={label}>
            <span>{sample.diseaseDisplayNames?.[label] ?? label}</span>
            <span>
              {pdla.toFixed(1)}% · SES {ses}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ============================================================
 * SampleSummary — Shared plant detail body (popup + tooltip)
 * ============================================================
 * One source of truth for "what does this plant's card say", rendered by
 * whichever overlay SampleMarker picks below. `compact` trims it for the
 * Heatmap-step hover tooltip, which is `pointer-events: none` (so its
 * thumbnail strip can never be scrolled — showing all ten would just get
 * clipped) and drops the coordinates line, since the sidebar it hands off
 * to already leads with coordinates for the same plant.
 */
function SampleSummary({ sample, index, color, compact = false }) {
  const photos = sample.images ?? [];
  const usable = sample.usableImageCount ?? photos.length;
  const total = sample.imageCount ?? photos.length;
  const spread = sample.pdlaSpread;
  const shownPhotos = compact ? photos.slice(0, COMPACT_THUMBNAIL_LIMIT) : photos;
  const hiddenCount = photos.length - shownPhotos.length;

  return (
    <div className={`popup-content ${compact ? 'is-compact' : ''}`}>
      {shownPhotos.length > 0 ? (
        <div className="popup-thumbnails">
          {shownPhotos.map((photo) => (
            <img
              key={photo.id}
              src={photo.thumbnail}
              alt=""
              className={`popup-thumbnail ${photo.usable ? '' : 'is-unused'}`}
            />
          ))}
          {hiddenCount > 0 && <span className="popup-thumbnail-more">+{hiddenCount}</span>}
        </div>
      ) : (
        sample.thumbnail && <img src={sample.thumbnail} alt="" className="popup-thumbnail" />
      )}
      <div className="popup-info">
        <span className="popup-label">Plant #{index + 1}</span>
        <span className="popup-disease">
          {sample.diseaseFindings
            ? sample.diseaseFindings.length === 0
              ? 'Healthy'
              : sample.diseaseFindings.map((f) => f.displayName).join(', ')
            : sample.diseaseName}
        </span>
        <span className="popup-severity" style={{ color }}>
          Severity: {sample.severity.toFixed(1)}%
        </span>
        <span className="popup-meta">
          Pooled from {usable} of {total} {total === 1 ? 'photo' : 'photos'}
          {spread && usable > 1
            ? ` · ${spread.min.toFixed(1)}–${spread.max.toFixed(1)}% per photo`
            : ''}
        </span>
        <DiseaseSesTable sample={sample} />
        {!compact && (
          <span className="popup-coords">
            {sample.lat.toFixed(6)}, {sample.lng.toFixed(6)}
          </span>
        )}
        {compact && <span className="popup-hint">Tap for full photo detail</span>}
      </div>
    </div>
  );
}

/**
 * ============================================================
 * SampleMarker — Color-coded sample node on the map
 * ============================================================
 * Renders a single plant sample as a circle marker, colored by its SES on
 * the ACTIVE heatmap layer (`activeLayer` — General or one disease; see
 * sesScale.js's sampleSesForLayer), so a node's color always agrees with the
 * surface cell underneath it. Before a heatmap exists (Boundary/Sampling
 * steps, `activeLayer` null), it falls back to the plant's own General SES.
 * The popup/tooltip still reports the pooled PDLA % and disease name
 * regardless of layer, plus a per-disease SES breakdown — see
 * DiseaseSesTable above — so a node built from one blurry shot and one built
 * from eight should not look alike, and switching layers on the map doesn't
 * hide any of a plant's other readings.
 *
 * Two overlay modes, chosen by whether `onSelect` is supplied:
 *
 *   - No `onSelect` (Boundary / Sampling steps): a Leaflet `<Popup>`, opened
 *     by tapping the node — unchanged from before this node became
 *     clickable elsewhere. Touch users have no hover, so this is the only
 *     way they can ever read a node's detail in those steps.
 *   - `onSelect` supplied (Heatmap step, once the Sample History sidebar
 *     exists to hand detail off to): a `<Tooltip>` instead. A `<Popup>`
 *     would fight the click — Leaflet binds its own click-to-open handler
 *     to the layer, so tapping a node would both open a popup AND select it
 *     in the sidebar, two redundant "detail" surfaces at once. `<Tooltip>`
 *     opens on hover (a quick look) and leaves the click free for
 *     `onSelect`, which is exactly the "hover = quick look, click = full
 *     detail" split this mode is for.
 *
 *     Leaflet tooltips still bind `click` internally (to open themselves,
 *     same handler as `mouseover`) — harmless on desktop since `mouseover`
 *     already opened it, but on touch there's no `mouseout` to ever close
 *     it, so a tap would leave the card stranded over the map after the
 *     sidebar takes over. `onSelect` below closes it explicitly first.
 */
export default function SampleMarker({
  sample,
  index,
  isSelected = false,
  onSelect = null,
  activeLayer = null,
}) {
  const layerKey = activeLayer ?? HEATMAP_LAYER_GENERAL;
  const color = sesToColor(sampleSesForLayer(sample, layerKey));

  // Leaflet churns its internal on/off bookkeeping on every eventHandlers
  // identity change — with the opacity slider re-rendering App on every drag
  // frame and up to 50 markers on the field, an inline object literal here
  // would rebind all of them each frame. Memoized so it's stable across
  // renders that don't actually change who's selectable.
  const eventHandlers = useMemo(() => {
    if (!onSelect) return undefined;
    return {
      click: (e) => {
        e.target.closeTooltip();
        onSelect(sample.id);
      },
    };
  }, [onSelect, sample.id]);

  // Create a divIcon to embed the number
  const markerIcon = L.divIcon({
    html: `<div style="display:flex;align-items:center;justify-content:center;width:${isSelected ? 26 : 20}px;height:${isSelected ? 26 : 20}px;border-radius:50%;background:${color};border:${isSelected ? '4px solid #111827' : '2px solid #ffffff'};color:#ffffff;font-size:${isSelected ? 14 : 11}px;font-weight:700;line-height:1;box-shadow:0 2px 4px rgba(0,0,0,0.2);">${index + 1}</div>`,
    iconSize: [isSelected ? 26 : 20, isSelected ? 26 : 20],
    iconAnchor: [isSelected ? 13 : 10, isSelected ? 13 : 10],
    className: '',
  });

  return (
    <Marker
      position={[sample.lat, sample.lng]}
      icon={markerIcon}
      eventHandlers={eventHandlers}
    >
      {onSelect ? (
        <Tooltip className="sample-tooltip" direction="top" offset={[0, -14]} opacity={1}>
          <SampleSummary sample={sample} index={index} color={color} compact />
        </Tooltip>
      ) : (
        <Popup className="sample-popup" closeButton={false}>
          <SampleSummary sample={sample} index={index} color={color} />
        </Popup>
      )}
    </Marker>
  );
}
