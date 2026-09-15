/**
 * TOTP (authenticator-app) as a second factor.
 *
 * Scope, and this is deliberate: a code from here is only ever asked for on
 * **password** sign-in. It is never asked for on a passkey sign-in, and a
 * passkey never needs one enrolled — a passkey ceremony is already possession
 * plus user verification (the OS authenticator's own PIN/biometric prompt),
 * so a typed code on top of that adds friction without adding a factor. The
 * passkey ceremony also runs through the OS authenticator via a Tauri plugin
 * (`src/auth.ts`), which has nowhere to prompt for a code even if it wanted
 * to. `Action` below says this plainly rather than implying broader coverage.
 *
 * `load` only reports a row once the server says the secret is **confirmed**
 * (`GET /totp` -> `{ enrolled, confirmed }`). An enrolled-but-unconfirmed
 * secret — an abandoned setup attempt — is not a working sign-in method and
 * must not appear as one in this table.
 *
 * Enrollment is entirely client-driven and Tauri-free: `POST /totp/enroll`
 * returns a base32 secret and an `otpauth://` URI, and the QR is rendered
 * *here* from that URI with `qrcode.react` rather than as a server-generated
 * image. Every request goes through `apiRequest` (a Rust hop inside the
 * app), same as `password.tsx`.
 */
import { errorMessage } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { apiError, apiRequest } from '../syncServer';
import type { AuthMethod, AuthMethodContext, AuthMethodRow } from './registry';

interface TotpStatus {
  enrolled: boolean;
  confirmed: boolean;
}

async function fetchStatus(ctx: AuthMethodContext): Promise<TotpStatus> {
  const res = await apiRequest('GET', '/totp', undefined, ctx);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(apiError(res, "Couldn't check two-factor status"));
  }
  return res.body as TotpStatus;
}

async function load(ctx: AuthMethodContext): Promise<AuthMethodRow[]> {
  if (!ctx.token) return [];
  const status = await fetchStatus(ctx);
  if (!status.confirmed) return [];
  return [{ key: 'totp', name: 'Authenticator app', type: '2FA' }];
}

interface Enrollment {
  secret: string;
  uri: string;
}

interface ConfirmResult {
  confirmed: boolean;
  recoveryCodes: string[];
}

const SCOPE_NOTE =
  'A code from here is asked for when signing in with a password. It is not used, and not needed, for passkey sign-in.';

function TotpAction({ ctx }: { ctx: AuthMethodContext }) {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  // `POST /totp/enroll` now re-verifies the password server-side (a bearer
  // token alone must not be enough to mint a fresh secret over an old one, in
  // case the token itself is stolen rather than the account holder acting) —
  // so enrollment asks for it here, as a stage before enroll is even called.
  const [awaitingPassword, setAwaitingPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  // Shown exactly once, right after confirm() — the server never returns
  // these again, only their hashes are stored from here on.
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!ctx.token) {
      setStatus(null);
      return;
    }
    fetchStatus(ctx)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, 'Network error.'));
      });
    return () => {
      cancelled = true;
    };
    // Re-check whenever the token changes (sign-in/out); mutations below
    // update `status` directly rather than re-running this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.token, ctx.server]);

  function beginEnroll() {
    setAwaitingPassword(true);
    setPassword('');
    setError(null);
    setNotice(null);
  }

  async function startEnroll() {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest('POST', '/totp/enroll', { password }, ctx);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(apiError(res, "Couldn't start enrollment"));
      }
      const body = res.body as Enrollment;
      setEnrollment(body);
      setAwaitingPassword(false);
      setPassword('');
      setCode('');
    } catch (e) {
      setError(errorMessage(e, 'Network error.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest('POST', '/totp/confirm', { code: code.trim() }, ctx);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(apiError(res, "That code didn't work"));
      }
      const body = res.body as ConfirmResult;
      setEnrollment(null);
      setCode('');
      setStatus({ enrolled: true, confirmed: true });
      // Recovery codes are shown once, right here — the server never returns
      // them again after this call. `notice` (the "turned on" line) is set
      // once the user acknowledges having saved them, not before.
      setRecoveryCodes(body.recoveryCodes ?? []);
      setCopied(false);
      ctx.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Network error.'));
    } finally {
      setBusy(false);
    }
  }

  function cancelEnroll() {
    setAwaitingPassword(false);
    setEnrollment(null);
    setPassword('');
    setCode('');
    setError(null);
  }

  async function copyRecoveryCodes() {
    const text = (recoveryCodes ?? []).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Some WebViews don't expose the Clipboard API to a `tauri://` origin
      // — fall back to selecting the block's text so Ctrl/Cmd+C still works.
      const el = document.getElementById('totp-recovery-codes');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  function acknowledgeRecoveryCodes() {
    setRecoveryCodes(null);
    setCopied(false);
    setNotice('Two-factor authentication is turned on.');
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest('DELETE', '/totp', undefined, ctx);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(apiError(res, "Couldn't turn it off"));
      }
      setStatus({ enrolled: false, confirmed: false });
      setNotice('Two-factor authentication is turned off.');
      ctx.refresh();
    } catch (e) {
      setError(errorMessage(e, 'Network error.'));
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div>
        <p className="setting-desc">
          Save these recovery codes somewhere safe. Each one signs you in once if you lose access to your authenticator
          app — they will not be shown again.
        </p>
        <pre
          id="totp-recovery-codes"
          className="select-all font-mono text-sm border border-line px-3 py-[0.625rem] mt-1.5 whitespace-pre-wrap break-all"
        >
          {recoveryCodes.join('\n')}
        </pre>
        <div className="flex gap-2 mt-2">
          <button className="button-small" onClick={() => void copyRecoveryCodes()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="button-primary" onClick={acknowledgeRecoveryCodes}>
            I&apos;ve saved these
          </button>
        </div>
      </div>
    );
  }

  if (awaitingPassword) {
    return (
      <div>
        <p className="setting-desc">Confirm your password to start setting up two-factor authentication.</p>
        <input
          type="password"
          autoComplete="current-password"
          className="field-input max-w-[12.5rem]"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          autoFocus
        />
        <button className="button-primary" onClick={() => void startEnroll()} disabled={busy || password.length === 0}>
          {busy ? 'Starting...' : 'Continue'}
        </button>
        <button className="button-small" onClick={cancelEnroll} disabled={busy}>
          Cancel
        </button>
        {error && <p className="setting-desc">{error}</p>}
      </div>
    );
  }

  if (enrollment) {
    return (
      <div>
        <p className="setting-desc">
          Scan this with an authenticator app (Google Authenticator, Authy, 1Password, ...), or enter the code below
          manually.
        </p>
        <QRCodeSVG value={enrollment.uri} size={160} />
        <p className="setting-desc">
          Manual entry: <code>{enrollment.secret}</code>
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          className="field-input max-w-[12.5rem]"
          placeholder="6-digit code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={busy}
        />
        <button className="button-primary" onClick={() => void confirm()} disabled={busy || code.trim().length === 0}>
          {busy ? 'Confirming...' : 'Confirm'}
        </button>
        <button className="button-small" onClick={cancelEnroll} disabled={busy}>
          Cancel
        </button>
        {error && <p className="setting-desc">{error}</p>}
        <p className="setting-desc">{SCOPE_NOTE}</p>
      </div>
    );
  }

  return (
    <div>
      {status?.confirmed ? (
        <button className="button-small button-danger" onClick={() => void turnOff()} disabled={!ctx.token || busy}>
          {busy ? 'Turning off...' : 'Turn off'}
        </button>
      ) : (
        <button className="button-primary" onClick={beginEnroll} disabled={!ctx.token || busy}>
          {busy ? 'Starting...' : 'Set up two-factor authentication'}
        </button>
      )}
      {error && <p className="setting-desc">{error}</p>}
      {notice && <p className="setting-desc">{notice}</p>}
      <p className="setting-desc">{SCOPE_NOTE}</p>
    </div>
  );
}

export const totpMethod: AuthMethod = { id: 'totp', order: 30, load, Action: TotpAction };
