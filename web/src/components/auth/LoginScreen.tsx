import { useState } from "react";
import type { Screen } from "../../screens";
import type { Session } from "../../lib/api";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { PasskeyLogin } from "./PasskeyLogin";
import { PasswordLogin } from "./PasswordLogin";

type Method = "passkey" | "password";

export function LoginScreen({
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
  const [method, setMethod] = useState<Method>("passkey");

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-card-header">
          <h2 className="auth-title">Welcome Back</h2>
          <p className="auth-subtitle">Sign in to sync your schedule, habits and tasks</p>
          <p className="auth-methods-count">Passkey, or password + 2FA as a backup</p>
        </div>

        <div className="auth-method-tabs">
          <button
            type="button"
            className={`auth-method-tab ${method === "passkey" ? "active" : ""}`}
            onClick={() => setMethod("passkey")}
          >
            Passkey
          </button>
          <button
            type="button"
            className={`auth-method-tab ${method === "password" ? "active" : ""}`}
            onClick={() => setMethod("password")}
          >
            Password + 2FA
          </button>
        </div>

        {method === "passkey" ? <PasskeyLogin onSignedIn={onSignedIn} /> : <PasswordLogin onSignedIn={onSignedIn} />}

        <GoogleSignInButton appSession={appSession} />

        <div className="form-actions">
          <button type="button" className="btn-text" style={{ flex: 1 }} onClick={() => onNavigate("splash")}>
            Back
          </button>
        </div>

        <div className="form-footer">
          <p className="form-footer-text">
            Don't have an account?{" "}
            <button type="button" className="form-footer-link" onClick={() => onNavigate("register")}>
              Create one
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
