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
