import { useEffect, useState } from "react";
import { claimAppSession, clearSession, type Session } from "../../lib/api";
import { Logo } from "./Logo";

type Handoff =
  | { kind: "none" }
  | { kind: "claiming" }
  | { kind: "done"; code: string }
  | { kind: "failed"; message: string };

export function SignedIn({
  session,
  appSession,
  onSignedOut,
}: {
  session: Session;
  /** The nonce the app is polling on, when this page was opened by the app. */
  appSession?: string | null;
  onSignedOut: () => void;
}) {
  const [handoff, setHandoff] = useState<Handoff>(appSession ? { kind: "claiming" } : { kind: "none" });

  useEffect(() => {
    if (!appSession) return;
    let cancelled = false;
    claimAppSession(appSession, session.token)
      .then((res) => {
        if (!cancelled) setHandoff({ kind: "done", code: res.code });
      })
      .catch((err) => {
        // Most likely the request expired (five minutes) or was already used;
        // either way the honest instruction is to start again from the app.
        if (!cancelled) setHandoff({ kind: "failed", message: String(err?.message ?? err) });
      });
    return () => {
      cancelled = true;
    };
  }, [appSession, session.token]);

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

        {handoff.kind === "claiming" && (
          <div className="passkey-note">Connecting the Albas app…</div>
        )}

        {handoff.kind === "done" && (
          <div className="passkey-note">
            ✅ Return to the Albas app to finish signing in. It should show the code{" "}
            <strong>{handoff.code}</strong> — if it shows something different, cancel there and start
            again, because the request came from somewhere else.
          </div>
        )}

        {handoff.kind === "failed" && (
          <div className="passkey-note">
            ⚠️ Couldn't connect the app: {handoff.message} Start the sign-in again from the app.
          </div>
        )}

        {handoff.kind === "none" && (
          <div className="passkey-note">
            🔐 Open the Albas app on your desktop or Android device and choose Sign In to start
            syncing this account's schedule, habits and tasks.
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={logOut}>
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
