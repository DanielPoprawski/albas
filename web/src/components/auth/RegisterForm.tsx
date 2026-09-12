import { useState } from 'react';
import type { Screen } from '../../App';
import { registerWithPassword, saveSession, type Session } from '../../lib/api';
import { GoogleSignInButton } from './GoogleSignInButton';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, NAME_PATTERN } from '../../../../shared/authRules';

export function RegisterForm({
  onNavigate,
  onSignedIn,
  appSession,
}: {
  onNavigate: (screen: Screen) => void;
  onSignedIn: (session: Session) => void;
  /** The app-session nonce this page was opened with, if any — forwarded to
   * Google sign-in so the handoff survives the round trip. See `App.tsx`. */
  appSession?: string | null;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!NAME_PATTERN.test(name)) {
      setError("Account names are 1–64 characters: letters, digits, '-' or '_'.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Passwords are at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      setError(`Passwords are at most ${MAX_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await registerWithPassword(name, password);
      saveSession(session);
      onSignedIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-card-header">
          <h2 className="auth-title">Get Started</h2>
          <p className="auth-subtitle">Create your Albas account</p>
        </div>

        <form onSubmit={submit}>
          <div className="form-group">
            <label htmlFor="register-username">Account Name</label>
            <input
              id="register-username"
              type="text"
              placeholder="letters, digits, - or _"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="register-password">Password</label>
            <input
              id="register-password"
              type="password"
              placeholder={`at least ${MIN_PASSWORD_LENGTH} characters`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="register-confirm">Confirm password</label>
            <input
              id="register-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="passkey-note">
            🔐 Your password is the first key to the account. Once you're in, you can add a passkey (security key,
            fingerprint or face unlock) and an authenticator app from the signed-in page.
          </div>

          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create Account'}
            </button>
            <button type="button" className="btn-text" onClick={() => onNavigate('splash')}>
              Back
            </button>
          </div>
        </form>

        <GoogleSignInButton appSession={appSession} />

        <div className="form-footer">
          <p className="form-footer-text">
            Already have an account?{' '}
            <button type="button" className="form-footer-link" onClick={() => onNavigate('login')}>
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
