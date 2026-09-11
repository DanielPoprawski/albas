import { useCallback, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DEFAULT_SYNC_URL, MIN_PASSWORD_LENGTH, NAME_PATTERN } from '../../syncServer';
import * as ipc from '../../ipc';

/**
 * Username + password sign-in and sign-up, entirely in-app.
 *
 * A password is the mandatory first credential, and unlike a passkey it needs
 * no OS authenticator, so nothing here touches the browser: the form asks
 * Rust (`account_login_password` / `account_register_password`), Rust asks
 * the server, and on success this device is already on the account by the
 * time the promise resolves — the same `adopt_session` the browser handoff
 * ends in.
 */
export type PasswordSignInState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  /** The account has an authenticator app; ask for the code and call again. */
  | { kind: 'totp' }
  | { kind: 'error'; message: string };

export function usePasswordSignIn(server: string = DEFAULT_SYNC_URL) {
  const { reloadFromStore, syncNow, setSetting } = useApp();
  const [state, setState] = useState<PasswordSignInState>({ kind: 'idle' });

  const finish = useCallback(async () => {
    // Rust already wrote the token and reset the watermarks, so the React
    // tree has to be re-read from SQLite before it can agree.
    await reloadFromStore();
    setSetting('__welcome_done', '1');
    setState({ kind: 'idle' });
    await syncNow();
  }, [reloadFromStore, setSetting, syncNow]);

  const login = useCallback(
    async (name: string, password: string, code?: string, recoveryCode?: string) => {
      setState({ kind: 'busy' });
      try {
        const res = await ipc.accountLoginPassword(
          server,
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
        setState({ kind: 'error', message: String(err) });
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
        await ipc.accountRegisterPassword(server, name.trim(), password);
        await finish();
      } catch (err) {
        setState({ kind: 'error', message: String(err) });
      }
    },
    [server, finish],
  );

  const reset = useCallback(() => setState({ kind: 'idle' }), []);

  return { state, login, register, reset };
}
