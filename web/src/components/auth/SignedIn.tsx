import { useEffect, useState } from 'react';
import {
  addPasskey,
  ApiError,
  claimAppSession,
  clearSession,
  confirmTotp,
  disableTotp,
  enrollTotp,
  getTotpStatus,
  listPasskeys,
  LockedOutError,
  type PasskeyInfo,
  type Session,
  type TotpStatus,
} from '../../lib/api';
import { webauthnSupported } from '../../lib/webauthn';
import { Logo } from './Splash';

/** A 401 from a session-backed read means the stored token is dead on the
 * server (expired, revoked, or the account was recreated) — the only
 * honest thing this page can do with it is forget it and ask for a fresh
 * sign-in. Only *reads* are probed this way: `POST /totp/confirm` also
 * answers 401 for a wrong code, and that must stay an inline error. */
function isDeadSession(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

type Handoff =
  | { kind: 'none' }
  | { kind: 'claiming' }
  | { kind: 'done'; code: string }
  | { kind: 'failed'; message: string };

/** The multi-step TOTP enroll/confirm/recovery-codes flow, entirely local to
 * this component so it can be dropped into the signed-in page without
 * threading state through `SignedIn` itself. */
type TotpFlow =
  | { step: 'idle' }
  | { step: 'password' }
  | { step: 'code'; secret: string; uri: string }
  | { step: 'recovery-codes'; codes: string[] };

function TotpSection({ token, onSessionDead }: { token: string; onSessionDead: () => void }) {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [flow, setFlow] = useState<TotpFlow>({ step: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    getTotpStatus(token)
      .then(setStatus)
      .catch((err) => {
        if (isDeadSession(err)) return onSessionDead();
        setError(err instanceof Error ? err.message : String(err));
      });
  };
  useEffect(refresh, [token]);

  const startEnroll = () => {
    setFlow({ step: 'password' });
    setPassword('');
    setError(null);
  };

  const submitPassword = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { secret, uri } = await enrollTotp(token, password);
      setFlow({ step: 'code', secret, uri });
      setCode('');
    } catch (err) {
      setError(
        err instanceof LockedOutError ? err.message : err instanceof Error ? err.message : "Couldn't start enrollment.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { recoveryCodes } = await confirmTotp(token, code);
      setFlow({ step: 'recovery-codes', codes: recoveryCodes });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't match. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!window.confirm('Turn off two-factor authentication for this account?')) return;
    setBusy(true);
    setError(null);
    try {
      await disableTotp(token);
      setFlow({ step: 'idle' });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn off two-factor authentication.");
    } finally {
      setBusy(false);
    }
  };

  if (flow.step === 'recovery-codes') {
    return (
      <div className="passkey-note">
        ✅ Two-factor authentication is on. Save these one-time recovery codes somewhere safe — each works once, in
        place of an authenticator code, and this is the only time they're shown:
        <pre className="code-block">{flow.codes.join('\n')}</pre>
        <button type="button" className="btn-primary" onClick={() => setFlow({ step: 'idle' })}>
          I've saved these
        </button>
      </div>
    );
  }

  if (flow.step === 'password') {
    return (
      <form onSubmit={submitPassword} className="passkey-note">
        Enter your password to start setting up two-factor authentication.
        <div className="form-group mt-3">
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Working…' : 'Continue'}
          </button>
          <button type="button" className="btn-text" onClick={() => setFlow({ step: 'idle' })}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  if (flow.step === 'code') {
    return (
      <form onSubmit={submitCode} className="passkey-note">
        Scan this into your authenticator app (Google Authenticator, 1Password, …), or enter the secret manually, then
        enter the 6-digit code it shows:
        <div className="code-block mt-2">{flow.secret}</div>
        <div className="form-group">
          <input
            type="text"
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
          />
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Verifying…' : 'Confirm'}
          </button>
          <button type="button" className="btn-text" onClick={() => setFlow({ step: 'idle' })}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="session-row">
        <span className="session-label">Two-Factor Auth</span>
        <span className="session-value">{status === null ? '…' : status.confirmed ? 'On' : 'Off'}</span>
      </div>
      {error && <div className="form-error">{error}</div>}
      {status?.confirmed ? (
        <button type="button" className="btn-secondary btn-block" onClick={disable} disabled={busy}>
          Turn off two-factor authentication
        </button>
      ) : (
        status !== null && (
          <button type="button" className="btn-primary btn-block" onClick={startEnroll}>
            Set up two-factor authentication
          </button>
        )
      )}
    </>
  );
}

export function SignedIn({
  session,
  appSession,
  onSignedOut,
  onSessionExpired,
}: {
  session: Session;
  /** The nonce the app is polling on, when this page was opened by the app. */
  appSession?: string | null;
  onSignedOut: () => void;
  /** The stored session no longer works on the server; it has already been
   * cleared from storage by the time this fires. */
  onSessionExpired: () => void;
}) {
  const [handoff, setHandoff] = useState<Handoff>(appSession ? { kind: 'claiming' } : { kind: 'none' });
  const [passkeys, setPasskeys] = useState<PasskeyInfo[] | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const supported = webauthnSupported();

  const sessionDead = () => {
    clearSession();
    onSessionExpired();
  };

  const refreshPasskeys = () => {
    listPasskeys(session.token)
      .then(setPasskeys)
      .catch((err) => {
        if (isDeadSession(err)) return sessionDead();
        setPasskeyError(String(err?.message ?? err));
      });
  };

  useEffect(refreshPasskeys, [session.token]);

  const onAddPasskey = async () => {
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      await addPasskey(session.token);
      refreshPasskeys();
    } catch (err) {
      if (isDeadSession(err)) return sessionDead();
      setPasskeyError(err instanceof Error ? err.message : "Couldn't add a passkey.");
    } finally {
      setPasskeyBusy(false);
    }
  };

  useEffect(() => {
    if (!appSession) return;
    let cancelled = false;
    claimAppSession(appSession, session.token)
      .then((res) => {
        if (!cancelled) setHandoff({ kind: 'done', code: res.code });
      })
      .catch((err) => {
        // Most likely the request expired (five minutes) or was already used;
        // either way the honest instruction is to start again from the app.
        if (!cancelled) setHandoff({ kind: 'failed', message: String(err?.message ?? err) });
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

        {handoff.kind === 'claiming' && <div className="passkey-note">Connecting the Albas app…</div>}

        {handoff.kind === 'done' && (
          <div className="passkey-note">
            ✅ Return to the Albas app to finish signing in. It should show the code <strong>{handoff.code}</strong> —
            if it shows something different, cancel there and start again, because the request came from somewhere else.
          </div>
        )}

        {handoff.kind === 'failed' && (
          <div className="passkey-note">
            ⚠️ Couldn't connect the app: {handoff.message} Start the sign-in again from the app.
          </div>
        )}

        {handoff.kind === 'none' && (
          <div className="passkey-note">
            🔐 Open the Albas app on your desktop or Android device and sign in with your account name and password to
            start syncing this account's schedule, habits and tasks.
          </div>
        )}

        <div className="session-row">
          <span className="session-label">Passkeys</span>
          <span className="session-value">
            {passkeys === null ? '…' : passkeys.length === 0 ? 'None yet' : passkeys.map((p) => p.label).join(', ')}
          </span>
        </div>

        {supported ? (
          <>
            <button type="button" className="btn-primary btn-block" onClick={onAddPasskey} disabled={passkeyBusy}>
              {passkeyBusy ? 'Waiting for your authenticator…' : 'Add a passkey'}
            </button>
            <div className="passkey-note">
              A passkey (security key, fingerprint or face unlock) signs you in without the password. Add one from each
              browser or device you want it on.
            </div>
          </>
        ) : (
          <div className="passkey-note">This browser doesn't support passkeys; add one from a browser that does.</div>
        )}
        {passkeyError && <div className="form-error">{passkeyError}</div>}

        <TotpSection token={session.token} onSessionDead={sessionDead} />

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={logOut}>
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
