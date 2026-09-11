import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DEFAULT_SYNC_URL } from '../../syncServer';
import * as ipc from '../../ipc';

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
  /**
   * Browser is open (or a QR is showing); `code` is shown so the user can match
   * it to the other screen, and `url` is what the QR encodes — the same page
   * the browser was opened on, so a plain camera app lands somewhere useful.
   */
  | { kind: 'waiting'; code: string; url: string }
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
      await ipc.appSigninCancel();
    } catch {
      // Cancelling is local bookkeeping; the server row expires on its own.
    }
  }, [stopPolling]);

  const poll = useCallback(
    (nonce: string) => {
      const deadline = Date.now() + TIMEOUT_MS;
      stopPolling();
      timer.current = setInterval(async () => {
        if (Date.now() > deadline) {
          stopPolling();
          setState({ kind: 'error', message: 'That sign-in timed out. Try again.' });
          return;
        }
        try {
          const res = await ipc.appSigninPoll(nonce);
          if (res.status === 'ready') {
            stopPolling();
            // Rust already wrote the token and reset the watermarks, so the
            // React tree has to be re-read from SQLite before it can agree.
            await reloadFromStore();
            setSetting('__welcome_done', '1');
            setState({ kind: 'idle' });
            await syncNow();
          } else if (res.status === 'expired') {
            stopPolling();
            setState({ kind: 'error', message: 'That sign-in expired. Try again.' });
          }
        } catch (err) {
          // A dropped network shouldn't end the attempt: the browser half may
          // still be in progress, and the deadline above bounds the retries.
          console.warn('sign-in poll failed:', err);
        }
      }, INTERVAL_MS);
    },
    [reloadFromStore, syncNow, setSetting, stopPolling],
  );

  /**
   * Opens a pending sign-in on the server. `open` = also launch the system
   * browser on it; without it the caller shows the URL as a QR for a signed-in
   * phone to scan (see `SessionCard`'s "Scan to sign in another device").
   */
  const start = useCallback(
    async (screen: 'login' | 'register', open = true) => {
      setState({ kind: 'starting' });
      try {
        const res = await ipc.appSigninStart(DEFAULT_SYNC_URL, screen);
        if (open) {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl(res.url);
        }
        setState({ kind: 'waiting', code: res.code, url: res.url });
        poll(res.nonce);
      } catch (err) {
        setState({ kind: 'error', message: String(err) });
      }
    },
    [poll],
  );

  /**
   * The other direction: this device scanned a QR from a signed-in device
   * (`app_session_offer` in `account.rs`), whose session is already claimed
   * for that account — so all that's left is to poll it and adopt.
   */
  const attach = useCallback(
    async (nonce: string) => {
      setState({ kind: 'starting' });
      try {
        const res = await ipc.appSigninAttach(DEFAULT_SYNC_URL, nonce);
        setState({ kind: 'waiting', code: '', url: '' });
        poll(res.nonce);
      } catch (err) {
        setState({ kind: 'error', message: String(err) });
      }
    },
    [poll],
  );

  return { state, start, attach, cancel };
}
