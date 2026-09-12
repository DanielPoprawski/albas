import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '../../syncServer';
import type { PasswordSignInState } from './signInHooks';

const INPUT = 'field-input disabled:opacity-50';
const LABEL = 'micro-label block mb-xs';

/**
 * Username + password, for signing in or creating an account. Shared by the
 * Welcome gate and Settings → Account & Sign-in so the two can't drift. The
 * 2FA code field appears only once the server has said it wants one
 * (`state.kind === 'totp'`), so an account without an authenticator never
 * sees it.
 */
export default function PasswordForm({
  mode,
  state,
  onLogin,
  onRegister,
  submitClass,
}: {
  mode: 'login' | 'register';
  state: PasswordSignInState;
  onLogin: (name: string, password: string, code?: string, recoveryCode?: string) => void;
  onRegister: (name: string, password: string, confirm: string) => void;
  /** The submit button's classes — Welcome and Settings style theirs differently. */
  submitClass: string;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const busy = state.kind === 'busy';
  const needsCode = mode === 'login' && state.kind === 'totp';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'login') {
      if (needsCode && useRecoveryCode) onLogin(name, password, undefined, recoveryCode);
      else onLogin(name, password, needsCode ? code : undefined);
    } else {
      onRegister(name, password, confirm);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[0.875rem]">
      <div>
        <label className={LABEL} htmlFor={`pw-${mode}-name`}>
          Account name
        </label>
        <input
          id={`pw-${mode}-name`}
          className={INPUT}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={mode === 'register' ? 'letters, digits, - or _' : 'your-account'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          required
        />
      </div>
      <div>
        <label className={LABEL} htmlFor={`pw-${mode}-password`}>
          Password
        </label>
        <input
          id={`pw-${mode}-password`}
          className={INPUT}
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          placeholder={mode === 'register' ? `at least ${MIN_PASSWORD_LENGTH} characters` : '••••••••••••'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          required
        />
      </div>
      {mode === 'register' && (
        <div>
          <label className={LABEL} htmlFor="pw-register-confirm">
            Confirm password
          </label>
          <input
            id="pw-register-confirm"
            className={INPUT}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
            required
          />
        </div>
      )}
      {needsCode && !useRecoveryCode && (
        <div>
          <label className={LABEL} htmlFor="pw-login-code">
            Two-factor code
          </label>
          <input
            id="pw-login-code"
            className={INPUT}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
            autoFocus
            required
          />
        </div>
      )}
      {needsCode && useRecoveryCode && (
        <div>
          <label className={LABEL} htmlFor="pw-login-recovery">
            Recovery code
          </label>
          <input
            id="pw-login-recovery"
            className={INPUT}
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="xxxxx-xxxxx"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            disabled={busy}
            autoFocus
            required
          />
        </div>
      )}
      {needsCode && (
        <button
          type="button"
          onClick={() => setUseRecoveryCode((v) => !v)}
          disabled={busy}
          className="text-xs text-[var(--t-ink-muted)] underline self-start bg-transparent border-0 cursor-pointer p-0"
        >
          {useRecoveryCode ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
        </button>
      )}
      {state.kind === 'error' && <p className="text-sm text-[var(--t-danger)] leading-snug">{state.message}</p>}
      <button type="submit" className={submitClass} disabled={busy}>
        {busy
          ? mode === 'login'
            ? 'Signing in…'
            : 'Creating…'
          : needsCode
            ? 'Verify & sign in'
            : mode === 'login'
              ? 'Sign in'
              : 'Create account'}
      </button>
    </form>
  );
}
