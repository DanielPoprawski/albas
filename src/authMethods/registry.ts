/**
 * The extension point for sign-in methods.
 *
 * Settings → Account & Sign-in renders whatever `authMethods()` returns rather
 * than a hardcoded list, so adding a method is a new file under
 * `src/authMethods/` exporting an `AuthMethod`, plus one entry in the list at
 * the bottom of this file — no edit to the Settings cards. A module that is
 * not implemented yet exports nothing, so an unfinished method can never show
 * a row for a credential that does not exist.
 *
 * The contract is deliberately narrow:
 *  - `load()` returns the credentials **really attached** to the signed-in
 *    account. Returning a row for something that does not exist is a bug: this
 *    table is the user's record of how their account can be opened.
 *  - `Action` is the control that adds/changes that method, rendered in the
 *    card's action row.
 *
 * Nothing here talks to the network itself. Each module calls the sync
 * server through `apiRequest()` in `syncServer.ts`, which hops through Rust
 * inside the app — the WebView cannot `fetch` the server itself (no CORS).
 */
import type { ComponentType } from 'react';
import type { CategoryAccentName } from '../colors';

/** The pill text in the table's Type column. Only add a value that works. */
export type AuthMethodType = 'Passkey' | 'Password' | '2FA';

/** Type pill accent per method (a `<Tag accent>` name), so the pill follows the theme. */
export const METHOD_PILL: Record<AuthMethodType, CategoryAccentName> = {
  Passkey: 'green',
  Password: 'amber',
  '2FA': 'purple',
};

/** One credential attached to the account. */
export interface AuthMethodRow {
  /** Stable key within a method — a credential id, a label, `'password'`. */
  key: string;
  /** What the row is called: a device/key label, "Password", "Authenticator app". */
  name: string;
  type: AuthMethodType;
  /** Optional right-aligned detail, e.g. "added 12 Mar 2026". */
  detail?: string;
}

/** What a method is handed to do its work. */
export interface AuthMethodContext {
  /** Bearer token for the sync server; null when signed out. */
  token: string | null;
  /** Sync server base URL — no trailing slash, no `/sync`. */
  server: string;
  /** Re-runs every method's `load()`. Call after a successful mutation. */
  refresh: () => void;
}

export interface AuthMethod {
  /** Unique, stable. */
  id: string;
  /** Sort order in the table and the action row. Lower comes first. */
  order: number;
  /**
   * The credentials of this kind on the account. Resolve to `[]` when none
   * are attached; throw only for a real failure (the card shows the message).
   */
  load(ctx: AuthMethodContext): Promise<AuthMethodRow[]>;
  /** Optional control for adding/changing this method. */
  Action?: ComponentType<{ ctx: AuthMethodContext }>;
}

// Below the types on purpose: the method modules import only types from this
// file, so there is no runtime cycle.
import { passkeyMethod } from './passkey';
import { passwordMethod } from './password';
import { totpMethod } from './totp';

/** Every built-in method, in `order`. */
export function authMethods(): AuthMethod[] {
  return [passkeyMethod, passwordMethod, totpMethod].sort((a, b) => a.order - b.order);
}
