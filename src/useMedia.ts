import { useEffect, useState } from 'react';

/** Phone-width breakpoint. Below this the app switches to the drawer layout. */
const MOBILE_QUERY = '(max-width: 767px)';

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
