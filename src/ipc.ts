/**
 * Typed wrappers for every Rust command registered in
 * `src-tauri/src/lib.rs`'s `generate_handler![]`. This is the only module in
 * `src/` that imports `@tauri-apps/api/core` directly — every other call
 * site (components, hooks, `persistence.ts`, `syncServer.ts`) goes through
 * one of the functions below instead of calling `invoke()` itself.
 *
 * Kept free of React so it can be imported from anywhere — a hook, a plain
 * module, a component — without pulling a component tree along with it.
 *
 * Tauri converts a Rust command's snake_case argument names to camelCase on
 * the JS side, so every object literal below uses camelCase even where the
 * matching Rust signature reads snake_case (e.g. `key_id` -> `keyId`).
 */

import type { List, RawSharedRow, Seed, ShareGrant, Tag } from './types';

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

/** Mirrors Rust's `AppData` (`db.rs`) — the whole-DB snapshot `load_state` returns. */
export interface AppDataState {
  seeds: Seed[];
  lists: List[];
  tags: Tag[];
  settings: Record<string, string>;
}

/** Settings › Danger zone wipes: events, one-off to-dos, or habits. */
export type WipeKind = 'events' | 'todos' | 'habits';

export function loadState(): Promise<AppDataState> {
  return invoke('load_state');
}

export function setSetting(key: string, value: string): Promise<void> {
  return invoke('set_setting', { key, value });
}

export function saveSeed(seed: Seed): Promise<void> {
  return invoke('save_seed', { seed });
}

export function deleteSeed(id: string): Promise<void> {
  return invoke('delete_seed', { id });
}

export function setDone(seedId: string, date: string, value: number): Promise<void> {
  return invoke('set_done', { seedId, date, value });
}

/** Tombstones every live seed of one kind (with its done rows) in one transaction. */
export function deleteAll(kind: WipeKind): Promise<void> {
  return invoke('delete_all', { kind });
}

export function saveList(list: List): Promise<void> {
  return invoke('save_list', { list });
}

export function deleteList(id: string): Promise<void> {
  return invoke('delete_list', { id });
}

export function saveTag(tag: Tag): Promise<void> {
  return invoke('save_tag', { tag });
}

export function deleteTag(id: string): Promise<void> {
  return invoke('delete_tag', { id });
}

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

/** Mirrors `SyncOutcome` from Rust's `sync_now` (`src-tauri/src/sync.rs`). */
export interface SyncOutcome {
  pushed: number;
  pulled: number;
  skipped: number;
  sharedChanged: boolean;
  /** Epoch millis as a string — an i64 that would lose precision as a JSON number. */
  lastSync: string | null;
}

/** Mirrors `SyncStatus` from Rust's `sync_status`. */
export interface SyncStatusInfo {
  configured: boolean;
  url: string | null;
  account: string | null;
  lastSync: string | null;
}

export function syncNow(): Promise<SyncOutcome> {
  return invoke('sync_now');
}

export function syncStatus(): Promise<SyncStatusInfo> {
  return invoke('sync_status');
}

/** Tauri only: re-reads the shared cache (`shared_rows`). */
export function loadShared(): Promise<RawSharedRow[]> {
  return invoke('load_shared');
}

// ---------------------------------------------------------------------------
// account
// ---------------------------------------------------------------------------

/**
 * What every credential-management call resolves to, error statuses
 * included: a 404 from an older server is an answer ("no such feature"), not
 * a failure, and each caller decides that for itself.
 */
export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface AppSigninStartResult {
  nonce: string;
  code: string;
  url: string;
}

export interface AppSigninPollResult {
  status: string;
  account?: string;
}

export interface AppSigninAttachResult {
  nonce: string;
}

export interface PasswordAuthResult {
  status: string;
  account?: string;
}

export function appSigninStart(url: string, screen?: 'login' | 'register'): Promise<AppSigninStartResult> {
  return invoke('app_signin_start', { url, screen });
}

export function appSigninPoll(nonce: string): Promise<AppSigninPollResult> {
  return invoke('app_signin_poll', { nonce });
}

export function appSigninCancel(): Promise<void> {
  return invoke('app_signin_cancel');
}

export function appSigninAttach(url: string, nonce: string): Promise<AppSigninAttachResult> {
  return invoke('app_signin_attach', { url, nonce });
}

export function accountRegisterPassword(url: string, name: string, password: string): Promise<PasswordAuthResult> {
  return invoke('account_register_password', { url, name, password });
}

export function accountLoginPassword(
  url: string,
  name: string,
  password: string,
  code?: string | null,
  recoveryCode?: string | null,
): Promise<PasswordAuthResult> {
  return invoke('account_login_password', {
    url,
    name,
    password,
    code: code ?? null,
    recoveryCode: recoveryCode ?? null,
  });
}

/**
 * One authenticated request against the signed-in sync server, routed
 * through Rust to dodge the WebView's CORS wall — see
 * `syncServer.ts#apiRequest`, the only caller.
 */
export function syncApi(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<ApiResponse> {
  return invoke('sync_api', { method, path, body: body ?? null });
}

export interface SharesRes {
  outgoing: ShareGrant[];
  incoming: ShareGrant[];
}

export function sharesList(): Promise<SharesRes> {
  return invoke('shares_list');
}

/** Grants (`true`) or revokes everything — seeds, done rows, lists and tags — to one account. */
export function sharesSet(name: string, granted: boolean): Promise<void> {
  return invoke('shares_set', { name, granted });
}

export function syncSignOut(): Promise<void> {
  return invoke('sync_sign_out');
}

/**
 * Settings › Advanced: adopt a pasted bearer token for `url` (a server base or
 * `/sync` endpoint). Rust stores the secret; the WebView never sees it again.
 */
export function syncConnectToken(url: string, token: string): Promise<void> {
  return invoke('sync_connect_token', { url, token });
}

/** Deletes the signed-in account server-side and clears local session state. */
export function accountDelete(password: string): Promise<void> {
  return invoke('account_delete', { password });
}

/**
 * Fetches every row this account owns and writes it to a JSON file in the
 * app's data dir (no dialog/fs plugin is wired up yet — see `account.rs`).
 * Resolves to the file's path.
 */
export function accountExport(): Promise<string> {
  return invoke('account_export');
}

// ---------------------------------------------------------------------------
// app sessions (cross-device sign-in)
// ---------------------------------------------------------------------------

export interface AppSessionOffer {
  nonce: string;
  code: string;
  url: string;
}

export interface AppSessionApproval {
  code: string;
  account: string;
}

export function appSessionClaim(nonce: string): Promise<AppSessionApproval> {
  return invoke('app_session_claim', { nonce });
}

export function appSessionOffer(): Promise<AppSessionOffer> {
  return invoke('app_session_offer');
}

// ---------------------------------------------------------------------------
// window lifecycle
// ---------------------------------------------------------------------------

/**
 * Runs `handler` when the OS asks the main window to close. Calling
 * `e.preventDefault()` keeps it open — the caller then flushes/syncs and ends
 * with `destroyWindow()`. Resolves to the unlisten function.
 */
export async function onCloseRequested(
  handler: (e: { preventDefault(): void }) => void | Promise<void>,
): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow().onCloseRequested(handler);
}

/** Closes the main window without re-firing the close-requested event. */
export async function destroyWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().destroy();
}

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------

/** Fetches an iCalendar feed server-side — the WebView's CORS policy blocks it client-side. */
export function fetchIcs(url: string): Promise<string> {
  return invoke('fetch_ics', { url });
}
