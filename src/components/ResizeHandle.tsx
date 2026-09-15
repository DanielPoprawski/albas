import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { clampRem, LAYOUT_LIMITS } from '../appearance';
import { useSettings } from '../context/SettingsContext';

/**
 * The drag state behind one `ResizeHandle`: the panel's width in rem, held
 * in a ref rather than React state (a pixel-by-pixel setState would re-render
 * the whole panel on every pointermove). The CSS var is written straight onto
 * `<html>` during the drag; `setSetting` — which persists and re-derives
 * `applyLayout` — runs once, when the handle reports the drag ended.
 *
 * `sign` says which pointer direction widens the panel: +1 for a handle on
 * the panel's right edge (dragging right widens), -1 for one on its left.
 * Returns the three handlers the handle takes, ready to spread.
 */
export function useResizableWidth(panel: keyof typeof LAYOUT_LIMITS, sign: 1 | -1) {
  const { getSetting, setSetting } = useSettings();
  const key = `__layout_${panel}_w`;
  const cssVar = `--layout-${panel}-w`;
  const limits = LAYOUT_LIMITS[panel];
  const dragRem = useRef<number | null>(null);

  return {
    onDelta(deltaPx: number) {
      if (dragRem.current === null) {
        const stored = parseFloat(getSetting(key) ?? '');
        dragRem.current = Number.isFinite(stored) ? stored : limits.def;
      }
      const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      dragRem.current = clampRem(dragRem.current + (sign * deltaPx) / remPx, limits.min, limits.max);
      document.documentElement.style.setProperty(cssVar, `${dragRem.current}rem`);
    },
    onEnd() {
      if (dragRem.current === null) return;
      setSetting(key, String(dragRem.current));
      dragRem.current = null;
    },
    onReset() {
      dragRem.current = null;
      document.documentElement.style.removeProperty(cssVar);
      setSetting(key, '');
    },
  };
}

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
  /**
   * Called once when the drag ends, however it ends — release, cancel, the
   * window losing focus, or the handle unmounting mid-drag. The caller
   * persists the width here.
   */
  onEnd: () => void;
  /** Double-click: the caller resets the adjoining panel to its default width. */
  onReset: () => void;
  ariaLabel: string;
}

/**
 * A thin drag handle between two panels — a 0.5rem hit area drawing a solid
 * 3px accent-2 line (the `after:` pseudo-element) that turns the accent
 * colour on hover/drag. It never touches layout state itself: it just reports pointer
 * deltas, a drag end and a reset request, so the caller (which owns the width
 * var and the persisted setting) decides what a delta means.
 *
 * The drag itself is tracked on `window`, not on the element: pointer capture
 * on WebKitGTK was unreliable enough that a release outside the handle (or
 * outside the window) left the drag running until the next click, with the
 * panel following the mouse across the whole screen.
 *
 * Desktop only — `max-md:hidden` matches the 768px breakpoint the sidebar
 * itself goes `display: none` under (`useIsMobile`'s `MOBILE_QUERY`).
 */
export default function ResizeHandle({ side, onDelta, onEnd, onReset, ariaLabel }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const lastX = useRef(0);
  // The live listeners' teardown, or null when no drag is in flight. A ref,
  // so the pointerdown handler and the unmount cleanup see the same drag.
  const stop = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onDelta, onEnd });
  callbacks.current = { onDelta, onEnd };

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || stop.current) return;
    lastX.current = e.clientX;
    setDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const move = (ev: PointerEvent) => {
      const delta = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      if (delta !== 0) callbacks.current.onDelta(delta);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      stop.current = null;
      setDragging(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      callbacks.current.onEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    stop.current = end;
  }

  // Unmounting mid-drag (the right panel leaves with the calendar route) must
  // not leave window listeners or the body cursor behind.
  useEffect(() => () => stop.current?.(), []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      data-side={side}
      className={cn(
        'relative block max-md:hidden w-2 shrink-0 cursor-col-resize touch-none',
        "after:absolute after:inset-y-0 after:left-1/2 after:w-[3px] after:-translate-x-1/2 after:bg-accent-2 after:transition-colors after:duration-150 after:content-[''] hover:after:bg-accent",
        dragging && 'after:bg-accent',
      )}
      onPointerDown={handlePointerDown}
      onDoubleClick={onReset}
    />
  );
}
