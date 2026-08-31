import { clearSession, type Session } from "../../lib/api";
import { Logo } from "./Logo";

export function SignedIn({ session, onSignedOut }: { session: Session; onSignedOut: () => void }) {
  const logOut = () => {
    clearSession();
    onSignedOut();
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-card-header">
          <Logo size={40} />
          <h2 className="auth-title">You're Signed In</h2>
          <p className="auth-subtitle">This browser now has a session with your Albas account</p>
        </div>

        <div className="session-row">
          <span className="session-label">Account</span>
          <span className="session-value">{session.name}</span>
        </div>

        <div className="passkey-note">
          🔐 Open the Albas app on your desktop or Android device and sign in with a passkey to start syncing this
          account's schedule, habits and tasks.
        </div>

        <div className="form-actions">
          <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={logOut}>
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
