/**
 * The sync server: the hosted default, and every transform between the forms
 * its address takes. Rust keeps its own copy of the default
 * (`sync::DEFAULT_URL`, in endpoint form) and the two must stay in step.
 *
 * `__sync_url` (the stored `/sync` endpoint) wins over the default in Rust.
 * It is written by every sign-in (`adopt_session`) and by Settings › Advanced,
 * the one place a person can name their own server; blank there means the
 * default, never localhost.
 */
import type { ApiResponse } from './ipc';

export const DEFAULT_SYNC_URL = 'https://albas.danni-dev.com/api';

/**
 * Turns whatever a person pastes into the Advanced server field into
 * something `syncEndpoint()` (and then Rust's `check_url`) can judge: blank
 * is the default; a bare domain is assumed to mean `https://`; anything
 * already carrying a scheme passes through unchanged, and `check_url` in
 * `sync.rs` — the single source of truth on which schemes are allowed —
 * rejects `http://` with a clear reason the next time this device syncs.
 */
export function normalizeSyncUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return DEFAULT_SYNC_URL;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * The web portal (`/login`, passkey management) for an API base: the same
 * origin with the `/api` prefix (stripped by nginx before proxying) dropped.
 * Mirrors `portal_base()` in `account.rs`.
 */
export function portalUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/api\/?$/, '');
}

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
 * The inverse of `syncEndpoint`: the API base every server call wants
 * (`/passkeys`, `/login/password`, `/app-session` hang off it), recovered
 * from whatever is actually stored in `__sync_url`. Deriving it from the
 * live sync URL rather than `DEFAULT_SYNC_URL` is what keeps a self-hoster's
 * sign-in and Settings on their own server rather than the hosted one.
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
