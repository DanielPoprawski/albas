import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DEFAULT_SYNC_URL } from '../../syncServer';

/**
 * Drives a sign-in that happens in the system browser.
 *
 * The ceremony can't run in this WebView: passkeys there need a per-OS Rust
 * plugin with no iOS support, and Google blocks OAuth in embedded webviews
 * outright. So the app opens the public site, then polls until the page
 * reports a token bound to the nonce it opened with.
 *
 * Polling rather than an `albas://` deep link, so the same code works on
 * desktop, Android and iOS with no per-platform registration.
 */
export type BrowserSignInState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  /** Browser is open; `code` is shown so the user can match it to the page. */
  | { kind: 'waiting'; code: string }
  | { kind: 'error'; message: string };

/** Matches the server's five-minute TTL in `app_session.rs`. */
const TIMEOUT_MS = 5 * 60 * 1000;
const INTERVAL_MS = 1000;

export function useBrowserSignIn() {
  const { reloadFromStore, syncNow, setSetting } = useApp();
  const [state, setState] = useState<BrowserSignInState>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  // A poll loop must not outlive the screen that started it.
  useEffect(() => stopPolling, [stopPolling]);

  const cancel = useCallback(async () => {
    stopPolling();
    setState({ kind: 'idle' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('app_signin_cancel');
    } catch {
      // Cancelling is local bookkeeping; the server row expires on its own.
    }
  }, [stopPolling]);

  const start = useCallback(
    async (screen: 'login' | 'register') => {
      setState({ kind: 'starting' });
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        const res = await invoke<{ nonce: string; code: string; url: string }>(
          'app_signin_start',
          { url: DEFAULT_SYNC_URL, screen },
        );
        await openUrl(res.url);
        setState({ kind: 'waiting', code: res.code });

        const deadline = Date.now() + TIMEOUT_MS;
        stopPolling();
        timer.current = setInterval(async () => {
          if (Date.now() > deadline) {
            stopPolling();
            setState({ kind: 'error', message: 'That sign-in timed out. Try again.' });
            return;
          }
          try {
            const poll = await invoke<{ status: string; account?: string }>('app_signin_poll', {
              nonce: res.nonce,
            });
            if (poll.status === 'ready') {
              stopPolling();
              // Rust already wrote the token and reset the watermarks, so the
              // React tree has to be re-read from SQLite before it can agree.
              await reloadFromStore();
              setSetting('__welcome_done', '1');
              setState({ kind: 'idle' });
              await syncNow();
            } else if (poll.status === 'expired') {
              stopPolling();
              setState({ kind: 'error', message: 'That sign-in expired. Try again.' });
            }
          } catch (err) {
            // A dropped network shouldn't end the attempt: the browser half may
            // still be in progress, and the deadline above bounds the retries.
            console.warn('sign-in poll failed:', err);
          }
        }, INTERVAL_MS);
      } catch (err) {
        setState({ kind: 'error', message: String(err) });
      }
    },
    [reloadFromStore, syncNow, setSetting, stopPolling],
  );

  return { state, start, cancel };
}
