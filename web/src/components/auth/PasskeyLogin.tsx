import { useEffect, useRef, useState } from 'react';
import { loginStart, loginWithPasskey, saveSession, type Session } from '../../lib/api';
import { type AuthenticationChallenge, webauthnSupported } from '../../lib/webauthn';

export function PasskeyLogin({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = webauthnSupported();
  // Fetched ahead of the click so `navigator.credentials.get()` runs
  // synchronously inside the gesture — WebKit browsers reject it with
  // NotAllowedError otherwise. Used once; a retry fetches a fresh one.
  const challenge = useRef<AuthenticationChallenge | null>(null);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    loginStart()
      .then((c) => {
        if (!cancelled) challenge.current = c;
      })
      .catch(() => {
        // Not fatal: the click path fetches its own if this one is missing.
      });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const prefetched = challenge.current;
    challenge.current = null;
    try {
      const session = await loginWithPasskey(prefetched ?? undefined);
      saveSession(session);
      onSignedIn(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="btn-primary btn-block" onClick={signIn} disabled={busy || !supported}>
        {busy ? 'Waiting for your passkey…' : 'Sign In with Passkey'}
      </button>

      {!supported && (
        <div className="form-error">This browser doesn't support passkeys. Use Password + 2FA instead.</div>
      )}
      {error && <div className="form-error">{error}</div>}

      <div className="passkey-note">
        🔐 Your passkey (security key, fingerprint, or face unlock) is your password. It never leaves your device — just
        touch or look at your authenticator when prompted.
      </div>
    </div>
  );
}
