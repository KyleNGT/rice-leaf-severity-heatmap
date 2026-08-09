import { useCallback, useRef, useState } from 'react';

// Total pointer movement (px) below which a handle interaction counts as a
// tap (toggle expand/collapse) rather than a drag.
const TAP_THRESHOLD_PX = 8;

/**
 * Google-Maps-style draggable-tray mechanics, shared by every bottom tray
 * in the app (SampleSheet, HeatmapTray). Collapse/expand resting positions
 * are pure CSS (the caller's stylesheet defines translateY(0) vs.
 * translateY(calc(100% - peek))) — this hook only measures the handle's
 * height at pointerdown for 1:1 finger tracking while dragging, then
 * either toggles (tap) or snaps to the nearer resting position (drag
 * release).
 */
export function useTrayDrag({ initialExpanded = false } = {}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [dragging, setDragging] = useState(false);
  const [dragPx, setDragPx] = useState(null);

  const containerRef = useRef(null);
  const handleRef = useRef(null);
  // Mutable drag bookkeeping — avoids stale-closure issues in the
  // pointerup handler; React state above is only for rendering.
  const dragState = useRef(null);

  const handlePointerDown = useCallback(
    (e) => {
      const container = containerRef.current;
      const handle = handleRef.current;
      if (!container || !handle) return;

      const maxTranslate =
        container.getBoundingClientRect().height - handle.getBoundingClientRect().height;

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

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    },
    [toggle]
  );

  // Only override with an inline transform while actively dragging, so
  // the finger is tracked 1:1 with no transition lag. Once released, the
  // inline style is cleared and the caller's `--expanded` class (with its
  // own CSS transition) takes over to animate the final snap.
  const dragStyle =
    dragging && dragPx != null ? { transform: `translateY(${dragPx}px)`, transition: 'none' } : undefined;

  const handleProps = {
    role: 'button',
    tabIndex: 0,
    'aria-expanded': expanded,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
    onKeyDown: handleKeyDown,
  };

  return { expanded, dragging, containerRef, handleRef, dragStyle, handleProps, toggle };
}
