import { useState } from 'react';
import { LockedOutError, loginWithPassword, saveSession, type Session, TotpRequiredError } from '../../lib/api';

export function PasswordLogin({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  // Swaps the 2FA field from an authenticator code to a one-time recovery
  // code, for when the authenticator itself isn't available.
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await loginWithPassword(
        name,
        password,
        needsCode && !useRecoveryCode ? code : undefined,
        needsCode && useRecoveryCode ? code : undefined,
      );
      saveSession(session);
      onSignedIn(session);
    } catch (e) {
      if (e instanceof TotpRequiredError) {
        setNeedsCode(true);
        setError(needsCode ? "That code didn't match. Try again." : null);
      } else if (e instanceof LockedOutError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Sign-in failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="form-group">
        <label htmlFor="pw-login-name">Account Name</label>
        <input
          id="pw-login-name"
          type="text"
          placeholder="your-account"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="pw-login-password">Password</label>
        <input
          id="pw-login-password"
          type="password"
          placeholder="••••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      {needsCode && (
        <div className="form-group">
          <label htmlFor="pw-login-code">{useRecoveryCode ? 'Recovery Code' : '2FA Code'}</label>
          <input
            id="pw-login-code"
            type="text"
            inputMode={useRecoveryCode ? 'text' : 'numeric'}
            placeholder={useRecoveryCode ? 'xxxxx-xxxxx' : '123456'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
          />
          <button
            type="button"
            className="btn-text btn-text-sm"
            onClick={() => {
              setUseRecoveryCode((v) => !v);
              setCode('');
            }}
          >
            {useRecoveryCode ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
          </button>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      <button type="submit" className="btn-primary btn-block" disabled={busy}>
        {busy ? 'Signing in…' : needsCode ? 'Verify & Sign In' : 'Sign In'}
      </button>
    </form>
  );
}
