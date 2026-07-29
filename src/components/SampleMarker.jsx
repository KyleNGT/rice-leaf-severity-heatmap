import { useMemo } from 'react';
import { CircleMarker, Popup, Tooltip } from 'react-leaflet';
import { severityToColor } from '../utils/idwInterpolation';

const COMPACT_THUMBNAIL_LIMIT = 4;

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
        <span className="popup-disease">{sample.diseaseName}</span>
        <span className="popup-severity" style={{ color }}>
          Severity: {sample.severity.toFixed(1)}%
        </span>
        <span className="popup-meta">
          Pooled from {usable} of {total} {total === 1 ? 'photo' : 'photos'}
          {spread && usable > 1
            ? ` · ${spread.min.toFixed(1)}–${spread.max.toFixed(1)}% per photo`
            : ''}
        </span>
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
 * Renders a single plant sample as a circle marker, colored by its severity
 * percentage (green → red). The severity shown is pooled across every usable
 * photo taken at that plant, so the card also reports how many photos back
 * it and how much they disagreed — a node built from one blurry shot and one
 * built from eight should not look alike.
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
export default function SampleMarker({ sample, index, isSelected = false, onSelect = null }) {
  const color = severityToColor(sample.severity);

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

  return (
    <CircleMarker
      center={[sample.lat, sample.lng]}
      radius={isSelected ? 13 : 10}
      pathOptions={{
        color: isSelected ? '#111827' : '#ffffff',
        weight: isSelected ? 4 : 2,
        fillColor: color,
        fillOpacity: 0.9,
      }}
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
    </CircleMarker>
  );
}
