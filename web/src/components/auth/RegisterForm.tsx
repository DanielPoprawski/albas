import { useState } from "react";
import type { Screen } from "../../screens";
import { registerWithPasskey, saveSession, type Session } from "../../lib/api";
import { webauthnSupported } from "../../lib/webauthn";
import { GoogleSignInButton } from "./GoogleSignInButton";

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

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
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = webauthnSupported();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!NAME_PATTERN.test(name)) {
      setError("Account names are 1–64 characters: letters, digits, '-' or '_'.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await registerWithPasskey(name);
      saveSession(session);
      onSignedIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
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
              required
            />
          </div>

          {!supported && (
            <div className="form-error">
              This browser doesn't support passkeys, so it can't complete registration. Try a browser or device with
              passkey support.
            </div>
          )}
          {error && <div className="form-error">{error}</div>}

          <div className="passkey-note">
            🔐 You'll create a passkey to protect your account — a security key, fingerprint, or face unlock. No
            password needed (though you can add one as a backup later).
          </div>

          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={busy || !supported}>
              {busy ? "Creating…" : "Create Account"}
            </button>
            <button type="button" className="btn-text" onClick={() => onNavigate("splash")}>
              Back
            </button>
          </div>
        </form>

        <GoogleSignInButton appSession={appSession} />

        <div className="form-footer">
          <p className="form-footer-text">
            Already have an account?{" "}
            <button type="button" className="form-footer-link" onClick={() => onNavigate("login")}>
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
