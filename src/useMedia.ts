import { useEffect, useState } from 'react';

/**
 * Phone-width breakpoint. Below this the app switches to the mobile layout:
 * no sidebar, no desktop taskbar, bottom tabs instead.
 */
const MOBILE_QUERY = '(max-width: 768px)';

/**
 * matchMedia rather than a Tauri platform check, deliberately: it needs no
 * extra dependency, and narrowing the desktop window exercises the exact same
 * mobile layout, so the Android shell is testable without a device.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    setIsMobile(mq.matches); // re-sync in case it changed before the listener attached
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

const COARSE_POINTER_QUERY = '(pointer: coarse)';

export function useIsCoarsePointer(): boolean {
  const [isCoarse, setIsCoarse] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(COARSE_POINTER_QUERY).matches : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(COARSE_POINTER_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsCoarse(e.matches);
    mq.addEventListener('change', onChange);
    setIsCoarse(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isCoarse;
}

const WIDE_QUERY = '(min-width: 68.75rem)';

export function useIsWide(): boolean {
  const [isWide, setIsWide] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(WIDE_QUERY).matches : true,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsWide(e.matches);
    mq.addEventListener('change', onChange);
    setIsWide(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isWide;
}
