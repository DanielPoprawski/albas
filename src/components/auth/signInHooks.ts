import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/utils';
import { useApp } from '../../context/AppContext';
import { apiBase, MIN_PASSWORD_LENGTH, NAME_PATTERN } from '../../syncServer';
import * as ipc from '../../ipc';

/**
 * The API base a sign-in talks to: whatever server this device is pointed at
 * (Settings › Advanced writes `__sync_url`), the hosted default otherwise.
 * Read live rather than captured, so changing the server and then signing
 * in on the same screen goes to the new one.
 */
function useServer(): () => string {
  const { getSetting } = useApp();
  return useCallback(() => apiBase(getSetting('__sync_url')), [getSetting]);
}

/**
 * The two ways this device gets onto an account — password in-app, or a
 * handoff to the system browser — end the same way: Rust has already written
 * the token and reset the sync watermarks (`adopt_session`), so the React
 * tree has to be re-read from SQLite before it can agree, the welcome screen
 * is marked done, and a first sync runs.
 */
function useFinishSignIn() {
  const { reloadFromStore, syncNow, setSetting } = useApp();
  return useCallback(async () => {
    await reloadFromStore();
    setSetting('__welcome_done', '1');
    await syncNow();
  }, [reloadFromStore, setSetting, syncNow]);
}

// --- Password ----------------------------------------------------------------

/**
 * Username + password sign-in and sign-up, entirely in-app.
 *
 * A password is the mandatory first credential, and unlike a passkey it needs
 * no OS authenticator, so nothing here touches the browser: the form asks
 * Rust (`account_login_password` / `account_register_password`), Rust asks
 * the server, and on success this device is already on the account by the
 * time the promise resolves — the same `adopt_session` the browser handoff
 * ends in (`useFinishSignIn`).
 */
export type PasswordSignInState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  /** The account has an authenticator app; ask for the code and call again. */
  | { kind: 'totp' }
  | { kind: 'error'; message: string };

export function usePasswordSignIn() {
  const [state, setState] = useState<PasswordSignInState>({ kind: 'idle' });
  const finishSignIn = useFinishSignIn();
  const server = useServer();

  const finish = useCallback(async () => {
    setState({ kind: 'idle' });
    await finishSignIn();
  }, [finishSignIn]);

  const login = useCallback(
    async (name: string, password: string, code?: string, recoveryCode?: string) => {
      setState({ kind: 'busy' });
      try {
        const res = await ipc.accountLoginPassword(
          server(),
          name.trim(),
          password,
          code?.trim() || null,
          recoveryCode?.trim() || null,
        );
        if (res.status === 'totp_required') {
          setState({ kind: 'totp' });
          return;
        }
        await finish();
      } catch (err) {
        setState({ kind: 'error', message: errorMessage(err) });
      }
    },
    [server, finish],
  );

  const register = useCallback(
    async (name: string, password: string, confirm: string) => {
      if (!NAME_PATTERN.test(name.trim())) {
        setState({
          kind: 'error',
          message: "Account names are 1–64 characters: letters, digits, '-' or '_'.",
        });
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setState({
          kind: 'error',
          message: `Passwords are at least ${MIN_PASSWORD_LENGTH} characters.`,
        });
        return;
      }
      if (password !== confirm) {
        setState({ kind: 'error', message: "Those passwords don't match." });
        return;
      }
      setState({ kind: 'busy' });
      try {
        await ipc.accountRegisterPassword(server(), name.trim(), password);
        await finish();
      } catch (err) {
        setState({ kind: 'error', message: errorMessage(err) });
      }
    },
    [server, finish],
  );

  const reset = useCallback(() => setState({ kind: 'idle' }), []);

  return { state, login, register, reset };
}

// --- System browser ------------------------------------------------------------

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
/**
 * Polling cadence. The server (and nginx in front of it) budget the
 * app-session routes at 30/min per IP with a burst of 30: a full five-minute
 * wait at this interval spends 100 polls against an allowance of 180, so a
 * sign-in never rate-limits itself. Every second did, after twenty seconds.
 */
const INTERVAL_MS = 3000;

export function useBrowserSignIn() {
  const [state, setState] = useState<BrowserSignInState>({ kind: 'idle' });
  const finishSignIn = useFinishSignIn();
  const server = useServer();
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
      // One poll at a time: a slow request must not overlap the next tick, or
      // two `ready` answers could each run `finishSignIn`.
      let inFlight = false;
      timer.current = setInterval(async () => {
        if (inFlight) return;
        if (Date.now() > deadline) {
          stopPolling();
          setState({ kind: 'error', message: 'That sign-in timed out. Try again.' });
          return;
        }
        inFlight = true;
        try {
          const res = await ipc.appSigninPoll(nonce);
          if (res.status === 'ready') {
            stopPolling();
            setState({ kind: 'idle' });
            await finishSignIn();
          } else if (res.status === 'expired') {
            stopPolling();
            setState({ kind: 'error', message: 'That sign-in expired. Try again.' });
          }
        } catch (err) {
          // A dropped network shouldn't end the attempt: the browser half may
          // still be in progress, and the deadline above bounds the retries.
          console.warn('sign-in poll failed:', err);
        } finally {
          inFlight = false;
        }
      }, INTERVAL_MS);
    },
    [finishSignIn, stopPolling],
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
        const res = await ipc.appSigninStart(server(), screen);
        if (open) {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl(res.url);
        }
        setState({ kind: 'waiting', code: res.code, url: res.url });
        poll(res.nonce);
      } catch (err) {
        setState({ kind: 'error', message: errorMessage(err) });
      }
    },
    [poll, server],
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
        const res = await ipc.appSigninAttach(server(), nonce);
        setState({ kind: 'waiting', code: '', url: '' });
        poll(res.nonce);
      } catch (err) {
        setState({ kind: 'error', message: errorMessage(err) });
      }
    },
    [poll, server],
  );

  return { state, start, attach, cancel };
}
