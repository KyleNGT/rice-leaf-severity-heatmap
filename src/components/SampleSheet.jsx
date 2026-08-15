import SamplePanel from './SamplePanel';
import { useTrayDrag } from '../hooks/useTrayDrag';

/**
 * ============================================================
 * SampleSheet — Mobile Bottom Sheet (Step 2 — Sampling)
 * ============================================================
 * Google-Maps-style draggable tray that floats over the
 * full-bleed map on mobile (see App.jsx `isMobileSampling`).
 * Wraps <SamplePanel bare> with its own chrome: a sticky drag
 * handle that always shows "Add Plant Sample" (collapsed or
 * expanded) and a scrollable content area below it.
 *
 * Collapsed by default so the map is the primary view on entry.
 * Expand/collapse via:
 *   - Tap the handle (toggles either direction).
 *   - Drag the handle up/down — tracks the finger 1:1 while
 *     dragging, then snaps to whichever resting position is
 *     closer on release.
 * Drag/tap/snap mechanics live in useTrayDrag, shared with
 * HeatmapTray (Step 3).
 *
 * The sheet's `top` is pinned via CSS (see .sheet in App.css) to
 * the same header-clearance formula used elsewhere in the app,
 * so its fully expanded top edge can never render behind the
 * fixed header — this is what fixes the navbar-overlap bug for
 * mobile Step 2.
 */
export default function SampleSheet(props) {
  const { expanded, dragging, containerRef, handleRef, dragStyle, handleProps } = useTrayDrag({
    initialExpanded: false,
  });

  return (
    <div
      ref={containerRef}
      className={`sheet ${expanded ? 'sheet--expanded' : ''} ${dragging ? 'sheet--dragging' : ''}`}
      style={dragStyle}
    >
      <div
        ref={handleRef}
        className="sheet-handle-row"
        aria-label="Add Plant Sample — drag or tap to expand"
        {...handleProps}
      >
        <span className="sheet-handle-bar" aria-hidden="true" />
        <span className="sheet-title">Add Plant Sample</span>
        <span className={`sheet-chevron ${expanded ? 'sheet-chevron--expanded' : ''}`} aria-hidden="true" />
      </div>

      <div className="sheet-content">
        <SamplePanel bare {...props} />
      </div>
    </div>
  );
}
