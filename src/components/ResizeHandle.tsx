import { useRef, useState, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';

interface ResizeHandleProps {
  /**
   * Which panel edge this handle sits on. Informational only — the handle
   * just reports raw pointer deltas; only the caller knows which panel is on
   * which side of the drag, and so which sign widens it.
   */
  side: 'left' | 'right';
  /**
   * Called on every pointer move while dragging, with the px moved since the
   * previous call (positive = pointer moved right, negative = left).
   */
  onDelta: (px: number) => void;
  /** Double-click: the caller resets the adjoining panel to its default width. */
  onReset: () => void;
  ariaLabel: string;
}

/**
 * A thin drag handle between two panels — a 0.5rem hit area drawing a 1px
 * hairline (the `after:` pseudo-element) that turns the accent colour on
 * hover/drag. It never touches layout state itself: it just reports pointer
 * deltas and a reset request, so the caller (which owns the width var and the
 * persisted setting) decides what a delta means.
 *
 * Desktop only — `hidden md:block` matches the 768px breakpoint the sidebar
 * itself goes `display: none` under (`useIsMobile`'s `MOBILE_QUERY`).
 */
export default function ResizeHandle({ side, onDelta, onReset, ariaLabel }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const lastX = useRef(0);

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    lastX.current = e.clientX;
    setDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const delta = e.clientX - lastX.current;
    lastX.current = e.clientX;
    if (delta !== 0) onDelta(delta);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      data-side={side}
      className={cn(
        'relative hidden w-2 shrink-0 cursor-col-resize touch-none md:block',
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-line after:transition-colors after:duration-150 after:content-[''] hover:after:bg-accent",
        dragging && 'after:bg-accent',
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
    />
  );
}
