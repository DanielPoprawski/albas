import { useRef } from 'react';
import type { TouchEvent, WheelEvent, MouseEvent } from 'react';
import { useApp } from '../../context/AppContext';

/** Horizontal travel before a drag counts as a month swipe. */
const SWIPE_MIN_X = 56;
/** …and how much more horizontal than vertical it has to be, so that a swipe
 *  that's really a scroll of the week rows doesn't change the month. */
const SWIPE_RATIO = 1.4;

/** Trackpads emit a stream of small deltas, so one flick is accumulated… */
const WHEEL_THRESHOLD = 100;
/** …then locked out for its tail, or a single gesture jumps three months. */
const WHEEL_COOLDOWN = 400;
/** Gap that ends a wheel gesture and drops the accumulated delta. */
const WHEEL_IDLE = 250;

/** How long a completed swipe suppresses the tap it would otherwise become. */
const TAP_SUPPRESS = 400;

/**
 * Horizontal drag (or trackpad scroll) steps the month. Returns handler props
 * for the grid root — no rendering decisions, so the layouts stay
 * presentational.
 */
export function useMonthSwipe() {
  const { setCurrentMonth } = useApp();

  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const wheelAcc = useRef(0);
  const wheelAt = useRef(0);
  const wheelLock = useRef(0);

  const step = (dir: 1 | -1) =>
    setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + dir, 1));

  return {
    // let the browser keep vertical scrolling; we only claim the x axis
    style: { touchAction: 'pan-y' as const },

    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },

    onTouchEnd: (e: TouchEvent) => {
      const from = start.current;
      start.current = null;
      if (!from) return;

      const t = e.changedTouches[0];
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;

      // dragging left pulls the next month in, as the pages were side by side
      step(dx < 0 ? 1 : -1);
      swiped.current = true;
      setTimeout(() => { swiped.current = false; }, TAP_SUPPRESS);
    },

    // touchend is followed by a click on whichever cell the finger lifted over,
    // which would drill into that day; swallow it after a swipe
    onClickCapture: (e: MouseEvent) => {
      if (!swiped.current) return;
      swiped.current = false;
      e.preventDefault();
      e.stopPropagation();
    },

    onWheel: (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      const now = Date.now();
      if (now < wheelLock.current) return;
      if (now - wheelAt.current > WHEEL_IDLE) wheelAcc.current = 0;
      wheelAt.current = now;

      wheelAcc.current += e.deltaX;
      if (Math.abs(wheelAcc.current) < WHEEL_THRESHOLD) return;

      step(wheelAcc.current > 0 ? 1 : -1);
      wheelAcc.current = 0;
      wheelLock.current = now + WHEEL_COOLDOWN;
    },
  };
}
