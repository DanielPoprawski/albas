import { useState } from "react";
import { loginWithPasskey, saveSession, type Session } from "../../lib/api";
import { webauthnSupported } from "../../lib/webauthn";

export function PasskeyLogin({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = webauthnSupported();

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await loginWithPasskey();
      saveSession(session);
      onSignedIn(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="btn-primary" style={{ width: "100%" }} onClick={signIn} disabled={busy || !supported}>
        {busy ? "Waiting for your passkey…" : "Sign In with Passkey"}
      </button>

      {!supported && (
        <div className="form-error">This browser doesn't support passkeys. Use Password + 2FA instead.</div>
      )}
      {error && <div className="form-error">{error}</div>}

      <div className="passkey-note">
        🔐 Your passkey (security key, fingerprint, or face unlock) is your password. It never leaves your device —
        just touch or look at your authenticator when prompted.
      </div>
    </div>
  );
}
