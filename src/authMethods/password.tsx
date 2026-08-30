/**
 * Password sign-in method.
 *
 * `load` asks `GET /password`, which reports only whether a hash exists — the
 * server never hands the verifier out, and a boolean is the only honest thing
 * it can say about a password. A row appears here when, and only when, the
 * account really can be opened with one.
 *
 * The action sets or changes it via `PUT /password`. Plain fetch throughout:
 * unlike a passkey, a password needs no OS authenticator and so no Tauri hop.
 */
import { useState } from 'react';
import { registerAuthMethod, type AuthMethodContext, type AuthMethodRow } from './registry';

async function load(ctx: AuthMethodContext): Promise<AuthMethodRow[]> {
  if (!ctx.token) return [];

  const res = await fetch(`${ctx.server}/password`, {
    headers: { Authorization: `Bearer ${ctx.token}` },
  });
  // A server too old to know this route has no password support at all, so the
  // honest answer is "no password", not an error in the user's face.
  if (res.status === 404 || res.status === 405 || res.status === 501) return [];
  if (!res.ok) throw new Error((await res.text().catch(() => '')).trim() || `HTTP ${res.status}`);

  const { set } = (await res.json()) as { set?: boolean };
  return set ? [{ key: 'password', name: 'Password', type: 'Password' }] : [];
}

function SetPasswordAction({ ctx }: { ctx: AuthMethodContext }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSetPassword() {
    if (!password || password.length < 12) {
      setError('Password must be at least 12 characters long.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch(`${ctx.server}/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.token}`,
        },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => `HTTP ${res.status}`);
        setError(message.trim() || `Failed to set password (HTTP ${res.status}).`);
        return;
      }

      setSuccess(true);
      setPassword('');
      ctx.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <input
        type="password"
        className="input-text"
        placeholder="New password (min 12 chars)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={!ctx.token || loading}
      />
      <button
        className="button-primary"
        onClick={() => void handleSetPassword()}
        disabled={!ctx.token || !password || loading}
      >
        {loading ? 'Setting...' : 'Set Password'}
      </button>
      {error && <p className="setting-desc">{error}</p>}
      {success && <p className="setting-desc">Password set successfully.</p>}
    </div>
  );
}

registerAuthMethod({ id: 'password', order: 20, load, Action: SetPasswordAction });
