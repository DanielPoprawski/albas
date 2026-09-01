import { useEffect, useState } from "react";
import { getAuthConfig, startGoogleSignIn } from "../../lib/api";

/**
 * Renders nothing until the server confirms Google sign-in is configured
 * (`GET /api/auth/config`) — a self-hosted server with no Google Cloud
 * project simply has no client id/secret set, and the button should not
 * appear rather than appear and 503 on click. See sync-server/src/google.rs.
 *
 * `appSession` is threaded through from `App.tsx` so the app-handoff nonce
 * (present when this page was opened by the desktop/Android app) survives
 * the round trip through Google's consent screen — see `startGoogleSignIn`.
 */
export function GoogleSignInButton({ appSession }: { appSession?: string | null }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then((cfg) => {
        if (!cancelled) setEnabled(cfg.google);
      })
      .catch(() => {
        // Treat an unreachable/erroring config check the same as "off" — the
        // real error will surface soon enough elsewhere if the server is down.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;

  // The divider lives inside this component (rather than in every caller) so
  // there is never a dangling "or" with nothing beneath it while the config
  // check is still loading or comes back disabled.
  return (
    <>
      <div className="auth-divider">or</div>
      <button
        type="button"
        className="btn-secondary"
        style={{ width: "100%" }}
        onClick={() => startGoogleSignIn(appSession)}
      >
        Continue with Google
      </button>
    </>
  );
}
