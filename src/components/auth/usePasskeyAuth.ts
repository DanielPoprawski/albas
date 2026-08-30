import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  addPasskey,
  cancelCeremony,
  createAccount,
  signIn,
  submitPin,
  type PasskeyEvent,
} from '../../auth';
import { DEFAULT_SYNC_URL } from '../../syncServer';

export type AuthState =
  | { kind: 'idle' }
  | { kind: 'busy'; what: string }
  | { kind: 'error'; message: string }
  | { kind: 'done'; name: string };

/**
 * One passkey flow (sign-in or create-account) as UI state, shared by the
 * Welcome screen and Settings → Account. `pin` being set means a security key
 * is waiting for its PIN — render a `PinDialog` off it.
 *
 * On success the Rust side already stored the token and account behind React's
 * back, so this syncs once and reloads everything; `signedIn`/`welcomeDone`
 * flip as the settings come back.
 *
 * The server is `DEFAULT_SYNC_URL` and is supplied here rather than by the
 * caller: there is one server, and neither screen holds a URL any more.
 */
export function usePasskeyAuth() {
  const { reloadFromStore, setSetting } = useApp();
  const [state, setState] = useState<AuthState>({ kind: 'idle' });
  const [pin, setPin] = useState<{ attemptsRemaining: number | null } | null>(null);

  const onEvent = (e: PasskeyEvent) => {
    if (e.kind === 'pinRequired') setPin({ attemptsRemaining: e.attemptsRemaining });
    else setState({ kind: 'error', message: e.message });
  };

  /**
   * `adoptsSession` is what separates a login from adding a credential. A
   * login lands this device on an account, so it marks the welcome screen done
   * and reloads everything the Rust side wrote behind React's back. Adding a
   * passkey to the session you are already in changes nothing local — doing
   * either of those would be stomping state that is already correct.
   */
  async function run(
    what: string,
    fn: () => Promise<{ name: string }>,
    adoptsSession = true
  ): Promise<boolean> {
    setState({ kind: 'busy', what });
    try {
      const res = await fn();
      setPin(null);
      if (adoptsSession) {
        setState({ kind: 'busy', what: 'Syncing…' });
        setSetting('__welcome_done', '1');
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('sync_now');
        } catch {
          // signed in but the first sync failed — the next launch retries
        }
        await reloadFromStore();
      }
      setState({ kind: 'done', name: res.name });
      return true;
    } catch (err) {
      setPin(null);
      setState({ kind: 'error', message: String(err) });
      return false;
    }
  }

  return {
    state,
    pin,
    signIn: () =>
      run('Touch your security key or confirm on your device…', () =>
        signIn(DEFAULT_SYNC_URL, onEvent)
      ),
    createAccount: (name: string, invite: string | null) =>
      run('Creating your passkey…', () => createAccount(DEFAULT_SYNC_URL, name, invite, onEvent)),
    addPasskey: () =>
      run('Creating your passkey…', () => addPasskey(DEFAULT_SYNC_URL, onEvent), false),
    submitPin: async (p: string) => {
      setPin(null); // an invalidPin event reopens the dialog with the attempt count
      try {
        await submitPin(p);
      } catch (err) {
        setState({ kind: 'error', message: String(err) });
      }
    },
    cancelPin: async () => {
      setPin(null);
      setState({ kind: 'idle' });
      await cancelCeremony();
    },
  };
}
