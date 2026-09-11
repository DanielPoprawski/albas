/**
 * The sync server, full stop.
 *
 * This was a *default* behind an editable Server field in Welcome and in
 * Settings → Account & sync; both fields are gone. There is one hosted server,
 * an account on it is the product, and a URL box asking a person to name their
 * own only ever produced typos and a stale `http://localhost:8787/sync` sitting
 * in front of this constant forever. Rust keeps its own copy of the string
 * (`sync::DEFAULT_URL`, in endpoint form) and the two must stay in step.
 *
 * `__sync_url` still wins over it in Rust, and is still what the passkey flow
 * writes — nothing reads a URL from the UI any more, so the only values that
 * can be in there are this one and leftovers `db::repoint_default_server`
 * sweeps. Pointing a build at another server means editing these two
 * constants, not shipping the field again.
 */
import type { ApiResponse } from './ipc';

export const DEFAULT_SYNC_URL = 'https://albas.danni-dev.com/api';

/**
 * `__sync_url` holds the full `/sync` endpoint — `sync::run` POSTs straight to
 * it without appending a path, while the passkey flow writes `{base}/sync`
 * itself. Manual token entry is the one path where a bare base URL could be
 * stored and then 404 on every sync, so normalise it here.
 */
export function syncEndpoint(url: string): string {
  const base = url.trim().replace(/\/+$/, '');
  return base.endsWith('/sync') ? base : `${base}/sync`;
}

/**
 * The inverse of `syncEndpoint`: the API base the auth-method fetches want
 * (`/passkeys`, `/password`, `/totp` hang off it), recovered from whatever is
 * actually stored in `__sync_url`.
 *
 * Needed because the server is editable again (Settings → Advanced). Deriving
 * the base from the live sync URL instead of `DEFAULT_SYNC_URL` is what stops
 * a self-hoster's Settings from listing sign-in methods off the hosted server
 * while their data syncs somewhere else entirely.
 */
export function apiBase(url: string | null | undefined): string {
  if (!url) return DEFAULT_SYNC_URL;
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed === '') return DEFAULT_SYNC_URL;
  return trimmed.endsWith('/sync') ? trimmed.slice(0, -'/sync'.length) : trimmed;
}

/**
 * What every credential-management call resolves to, error statuses included:
 * a 404 from an older server is an answer ("no such feature"), not a failure,
 * and each caller decides that for itself the way the old fetch code did.
 * Defined in `ipc.ts` (it's `sync_api`'s return type); re-exported here so
 * existing imports keep working.
 */
export type { ApiResponse };

/**
 * One authenticated request against the signed-in sync server.
 *
 * Inside the app this hops through Rust (`sync_api` in `account.rs`): the
 * WebView's origin is `tauri://localhost`, the server has no CORS layer, and
 * WebKit reports the blocked preflight as a bare "TypeError: Load failed" —
 * which is exactly what Settings used to show for every method. Under
 * `bun run dev` there is no Rust, so it falls back to a plain `fetch` with
 * the token, which works there because Vite proxies nothing and the browser
 * is the origin the server was written for.
 */
export async function apiRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  fallback?: { server: string; token: string | null },
): Promise<ApiResponse> {
  const { inTauri } = await import('./persistence');
  if (inTauri()) {
    const { syncApi } = await import('./ipc');
    return syncApi(method, path, body);
  }
  if (!fallback) throw new Error('Not signed in.');
  const res = await fetch(`${fallback.server}${path}`, {
    method,
    headers: {
      ...(fallback.token ? { Authorization: `Bearer ${fallback.token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => '');
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { message: text.trim() };
  }
  return { status: res.status, body: parsed };
}

/** The server's plain-text error for a non-2xx `ApiResponse`, or a fallback. */
export function apiError(res: ApiResponse, fallback: string): string {
  const msg = typeof res.body?.message === 'string' ? res.body.message.trim() : '';
  return msg || `${fallback} (HTTP ${res.status}).`;
}

// Re-exported for existing imports — the rules themselves live in
// `shared/authRules.ts` (repo root) so the web portal can share them too.
export { NAME_PATTERN, MIN_PASSWORD_LENGTH } from '../shared/authRules';
