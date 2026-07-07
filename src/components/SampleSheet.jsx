import { useCallback, useRef, useState } from 'react';
import SamplePanel from './SamplePanel';

// Total pointer movement (px) below which a handle interaction counts as a
// tap (toggle expand/collapse) rather than a drag.
const TAP_THRESHOLD_PX = 8;

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
 *
 * The sheet's `top` is pinned via CSS (see .sheet in App.css) to
 * the same header-clearance formula used elsewhere in the app,
 * so its fully expanded top edge can never render behind the
 * fixed header — this is what fixes the navbar-overlap bug for
 * mobile Step 2.
 */
export default function SampleSheet(props) {
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragPx, setDragPx] = useState(null);

  const sheetRef = useRef(null);
  const handleRef = useRef(null);
  // Mutable drag bookkeeping — avoids stale-closure issues in the
  // pointerup handler; React state above is only for rendering.
  const dragState = useRef(null);

  const handlePointerDown = useCallback(
    (e) => {
      const sheet = sheetRef.current;
      const handle = handleRef.current;
      if (!sheet || !handle) return;

      const maxTranslate =
        sheet.getBoundingClientRect().height - handle.getBoundingClientRect().height;

      dragState.current = {
        startY: e.clientY,
        startTranslate: expanded ? 0 : maxTranslate,
        maxTranslate,
        moved: 0,
        lastTranslate: expanded ? 0 : maxTranslate,
      };

      handle.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [expanded]
  );

  const handlePointerMove = useCallback((e) => {
    const drag = dragState.current;
    if (!drag) return;

    const delta = e.clientY - drag.startY;
    drag.moved = Math.max(drag.moved, Math.abs(delta));

    const clamped = Math.min(Math.max(drag.startTranslate + delta, 0), drag.maxTranslate);
    drag.lastTranslate = clamped;
    setDragPx(clamped);
  }, []);

  const handlePointerUp = useCallback(() => {
    const drag = dragState.current;
    dragState.current = null;
    setDragging(false);
    setDragPx(null);

    if (!drag) return;

    if (drag.moved < TAP_THRESHOLD_PX) {
      // Tap on the handle — toggle either direction
      setExpanded((prev) => !prev);
      return;
    }

    // Drag released — snap to whichever resting position is closer
    setExpanded(drag.lastTranslate < drag.maxTranslate / 2);
  }, []);

  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleExpanded();
      }
    },
    [toggleExpanded]
  );

  // Only override with an inline transform while actively dragging, so
  // the finger is tracked 1:1 with no transition lag. Once released, the
  // inline style is cleared and the `sheet--expanded` class (with its
  // CSS transition) takes over to animate the final snap.
  const dragStyle =
    dragging && dragPx != null ? { transform: `translateY(${dragPx}px)`, transition: 'none' } : undefined;

  return (
    <div
      ref={sheetRef}
      className={`sheet ${expanded ? 'sheet--expanded' : ''} ${dragging ? 'sheet--dragging' : ''}`}
      style={dragStyle}
    >
      <div
        ref={handleRef}
        className="sheet-handle-row"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label="Add Plant Sample — drag or tap to expand"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <span className="sheet-handle-bar" aria-hidden="true" />
        <span className="sheet-title">Add Plant Sample</span>
      </div>

      <div className="sheet-content">
        <SamplePanel bare {...props} />
      </div>
    </div>
  );
}
