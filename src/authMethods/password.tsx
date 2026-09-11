/**
 * Password sign-in method.
 *
 * `load` asks `GET /password`, which reports only whether a hash exists — the
 * server never hands the verifier out, and a boolean is the only honest thing
 * it can say about a password. A row appears here when, and only when, the
 * account really can be opened with one.
 *
 * The action sets or changes it via `PUT /password`. Every request goes
 * through `apiRequest` — a Rust hop inside the app, since the WebView can't
 * reach the server directly (see `syncServer.ts`).
 */
import { useState } from 'react';
import { apiError, apiRequest, MIN_PASSWORD_LENGTH } from '../syncServer';
import { registerAuthMethod, type AuthMethodContext, type AuthMethodRow } from './registry';

async function load(ctx: AuthMethodContext): Promise<AuthMethodRow[]> {
  if (!ctx.token) return [];

  const res = await apiRequest('GET', '/password', undefined, ctx);
  // A server too old to know this route has no password support at all, so the
  // honest answer is "no password", not an error in the user's face.
  if (res.status === 404 || res.status === 405 || res.status === 501) return [];
  if (res.status < 200 || res.status >= 300) throw new Error(apiError(res, "Couldn't check the password"));

  const { set } = res.body as { set?: boolean };
  return set ? [{ key: 'password', name: 'Password', type: 'Password' }] : [];
}

function SetPasswordAction({ ctx }: { ctx: AuthMethodContext }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSetPassword() {
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await apiRequest('PUT', '/password', { password }, ctx);
      if (res.status < 200 || res.status >= 300) {
        setError(apiError(res, 'Failed to set password'));
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
        className="field-input max-w-[12.5rem]"
        placeholder={`New password (min ${MIN_PASSWORD_LENGTH} chars)`}
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
