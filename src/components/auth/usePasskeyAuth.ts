import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { cancelCeremony, createAccount, signIn, submitPin, type PasskeyEvent } from '../../auth';

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
 */
export function usePasskeyAuth() {
  const { reloadFromStore, setSetting } = useApp();
  const [state, setState] = useState<AuthState>({ kind: 'idle' });
  const [pin, setPin] = useState<{ attemptsRemaining: number | null } | null>(null);

  const onEvent = (e: PasskeyEvent) => {
    if (e.kind === 'pinRequired') setPin({ attemptsRemaining: e.attemptsRemaining });
    else setState({ kind: 'error', message: e.message });
  };

  async function run(what: string, fn: () => Promise<{ name: string }>) {
    setState({ kind: 'busy', what });
    try {
      const res = await fn();
      setPin(null);
      setState({ kind: 'busy', what: 'Syncing…' });
      setSetting('__welcome_done', '1');
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('sync_now');
      } catch {
        // signed in but the first sync failed — the next launch retries
      }
      await reloadFromStore();
      setState({ kind: 'done', name: res.name });
    } catch (err) {
      setPin(null);
      setState({ kind: 'error', message: String(err) });
    }
  }

  return {
    state,
    pin,
    signIn: (url: string) =>
      run('Touch your security key or confirm on your device…', () => signIn(url, onEvent)),
    createAccount: (url: string, name: string, invite: string | null) =>
      run('Creating your passkey…', () => createAccount(url, name, invite, onEvent)),
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
