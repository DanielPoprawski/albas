import { type RefObject, useCallback, useEffect, useRef } from 'react';

/**
 * Animates `card`'s height towards `inner`'s content height with a critically
 * damped spring, so a modal whose rows appear and disappear grows and shrinks
 * smoothly instead of jumping. The height is written straight to the element
 * (no React state per frame); `prefers-reduced-motion` snaps instead. A
 * `ResizeObserver` on `inner` catches content changes; the returned
 * `measure` is for callers that know a change is coming before layout does.
 */
export function useSpringHeight(
  card: RefObject<HTMLElement | null>,
  inner: RefObject<HTMLElement | null>,
  snappiness = 1,
): () => void {
  const raf = useRef<number | null>(null);
  const height = useRef<number | null>(null);
  const velocity = useRef(0);
  const target = useRef<number | null>(null);
  const lastTime = useRef(0);

  const setHeight = useCallback(
    (px: number) => {
      if (card.current) card.current.style.height = `${Math.round(px)}px`;
    },
    [card],
  );

  const tick = useCallback(() => {
    if (raf.current) return;
    const k = 190 * snappiness;
    const d = 2 * Math.sqrt(k) * 0.92;
    lastTime.current = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.032, (now - lastTime.current) / 1000);
      lastTime.current = now;
      if (height.current == null || target.current == null) return;

      const err = target.current - height.current;
      velocity.current += (k * err - d * velocity.current) * dt;
      height.current += velocity.current * dt;
      setHeight(height.current);

      if (Math.abs(err) < 0.4 && Math.abs(velocity.current) < 6) {
        height.current = target.current;
        velocity.current = 0;
        raf.current = null;
        setHeight(target.current);
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [snappiness, setHeight]);

  const measure = useCallback(() => {
    if (!inner.current || !card.current) return;
    const next = Math.min(inner.current.scrollHeight, Math.round(window.innerHeight * 0.88));
    if (next === target.current) return;
    target.current = next;

    const snap = height.current == null || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (snap) {
      height.current = next;
      velocity.current = 0;
      setHeight(next);
      return;
    }
    tick();
  }, [inner, card, tick, setHeight]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    if (inner.current) ro.observe(inner.current);
    measure();
    return () => {
      ro.disconnect();
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [inner, measure]);

  return measure;
}
