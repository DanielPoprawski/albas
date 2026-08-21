/**
 * The sync server this build ships pointing at.
 *
 * It is a *default*, not a lock: the Server field in Welcome and in
 * Settings → Account & sync stays editable, and whatever is stored in
 * `__sync_url` always wins. Hardcoding it just means a fresh install can sign
 * in without anyone typing a URL — the common case now that there is one real
 * server. Rust keeps its own copy of this string (`sync::DEFAULT_URL`) for the
 * same reason, and the two must stay in step.
 */
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
