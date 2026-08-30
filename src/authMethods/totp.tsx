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
 * image. Plain `fetch` throughout, same as `password.tsx`.
 */
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { registerAuthMethod, type AuthMethodContext, type AuthMethodRow } from './registry';

interface TotpStatus {
  enrolled: boolean;
  confirmed: boolean;
}

async function fetchStatus(ctx: AuthMethodContext): Promise<TotpStatus> {
  const res = await fetch(`${ctx.server}/totp`, {
    headers: { Authorization: `Bearer ${ctx.token}` },
  });
  if (!res.ok) {
    const message = (await res.text().catch(() => '')).trim();
    throw new Error(message || `Couldn't check two-factor status (HTTP ${res.status}).`);
  }
  return (await res.json()) as TotpStatus;
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

const SCOPE_NOTE =
  'A code from here is asked for when signing in with a password. It is not used, and not needed, for passkey sign-in.';

function TotpAction({ ctx }: { ctx: AuthMethodContext }) {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
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
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error.');
      });
    return () => {
      cancelled = true;
    };
    // Re-check whenever the token changes (sign-in/out); mutations below
    // update `status` directly rather than re-running this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.token, ctx.server]);

  async function startEnroll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${ctx.server}/totp/enroll`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.token}` },
      });
      if (!res.ok) {
        const message = (await res.text().catch(() => '')).trim();
        throw new Error(message || `Couldn't start enrollment (HTTP ${res.status}).`);
      }
      const body = (await res.json()) as Enrollment;
      setEnrollment(body);
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${ctx.server}/totp/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.token}`,
        },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        const message = (await res.text().catch(() => '')).trim();
        throw new Error(message || `That code didn't work (HTTP ${res.status}).`);
      }
      setEnrollment(null);
      setCode('');
      setNotice('Two-factor authentication is turned on.');
      setStatus({ enrolled: true, confirmed: true });
      ctx.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  function cancelEnroll() {
    setEnrollment(null);
    setCode('');
    setError(null);
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${ctx.server}/totp`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ctx.token}` },
      });
      if (!res.ok) {
        const message = (await res.text().catch(() => '')).trim();
        throw new Error(message || `Couldn't turn it off (HTTP ${res.status}).`);
      }
      setStatus({ enrolled: false, confirmed: false });
      setNotice('Two-factor authentication is turned off.');
      ctx.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  if (enrollment) {
    return (
      <div>
        <p className="setting-desc">
          Scan this with an authenticator app (Google Authenticator, Authy, 1Password, ...), or
          enter the code below manually.
        </p>
        <QRCodeSVG value={enrollment.uri} size={160} />
        <p className="setting-desc">
          Manual entry: <code>{enrollment.secret}</code>
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          className="input-text"
          placeholder="6-digit code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={busy}
        />
        <button
          className="button-primary"
          onClick={() => void confirm()}
          disabled={busy || code.trim().length === 0}
        >
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
        <button
          className="button-small button-danger"
          onClick={() => void turnOff()}
          disabled={!ctx.token || busy}
        >
          {busy ? 'Turning off...' : 'Turn off'}
        </button>
      ) : (
        <button
          className="button-primary"
          onClick={() => void startEnroll()}
          disabled={!ctx.token || busy}
        >
          {busy ? 'Starting...' : 'Set up two-factor authentication'}
        </button>
      )}
      {error && <p className="setting-desc">{error}</p>}
      {notice && <p className="setting-desc">{notice}</p>}
      <p className="setting-desc">{SCOPE_NOTE}</p>
    </div>
  );
}

registerAuthMethod({ id: 'totp', order: 30, load, Action: TotpAction });
