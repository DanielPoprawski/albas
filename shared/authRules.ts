/**
 * Account-name and password rules shared between the desktop app (`src/`)
 * and the sync-server web portal (`web/src/`); the server keeps its own copy
 * in step by hand (`sync-server/src/password.rs`) since there's no build
 * step that shares Rust and TS.
 *
 * `src/syncServer.ts` re-exports these so existing imports keep working;
 * `web/src/components/auth/RegisterForm.tsx` imports them directly.
 */

/** The account-name rule, mirroring `name_ok()` on the server. */
export const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Mirrors `MIN_PASSWORD_LENGTH` in `sync-server/src/password.rs`. */
export const MIN_PASSWORD_LENGTH = 12;

/** Mirrors `sync-server/src/password.rs`'s max length (server enforces it too). */
export const MAX_PASSWORD_LENGTH = 128;
