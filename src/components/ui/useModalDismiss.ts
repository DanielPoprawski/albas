import { useEffect, useRef } from 'react';

/**
 * Routes every "get me out of here" gesture to one `dismiss` callback:
 * Escape, and the Android hardware back button. The back button works by
 * pushing a history entry while the modal is open — `WryActivity` only
 * intercepts back when the WebView can go back, so with nothing on the
 * stack it exited the app instead of closing the modal. Closing by any other
 * route pops that entry again so the stack stays balanced.
 *
 * `dismiss` is read through a ref, so the caller can pass a fresh closure
 * every render without re-registering listeners.
 */
export function useModalDismiss(dismiss: () => void) {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A nested Radix dialog (delete confirm) handles its own Escape and
      // marks it; a field that consumed Escape stops propagation instead.
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      dismissRef.current();
    };
    let popped = false;
    const onPop = () => {
      popped = true;
      dismissRef.current();
    };
    window.addEventListener('keydown', onKey);
    window.history.pushState({ albasModal: true }, '');
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      if (!popped) window.history.back();
    };
  }, []);
}
