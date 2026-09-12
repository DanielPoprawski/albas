import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import * as ipc from '../../ipc';
import type { SyncStatusInfo } from '../../ipc';
import type { useBrowserSignIn } from '../auth/useBrowserSignIn';
import type { usePasswordSignIn } from '../auth/usePasswordSignIn';
import PasswordForm from '../auth/PasswordForm';
import { SignedInPanel, SignedOutPanel } from '../auth/CrossDevice';
import { FormMessage, MicroLabel } from '../ui/field';
import { Tag } from '../ui/tag';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { DEFAULT_SYNC_URL, apiBase, apiError, apiRequest } from '../../syncServer';
import { timeAgo } from '../../dates';
import { initialsOf } from '../AppShell';
import {
  authMethods,
  METHOD_PILL,
  type AuthMethod,
  type AuthMethodContext,
  type AuthMethodRow,
} from '../../authMethods';
import {
  Card,
  LINK_MUTED,
  SettingItem,
  SettingsTable,
  SettingsTableNote,
  SW_TD,
  SW_TR,
  type SyncState,
} from './shared';

/* ── Profile ─────────────────────────────────────────────────────────────
 *
 * Read-only, deliberately. The only name Albas knows is the sync account's,
 * which the server owns (it is the name other people share *to*); there is no
 * local display-name setting, and `useApp()` exposes no way to read one back
 * after writing it, so an editable field here would be a control that silently
 * discards input. Signed out, there is no name at all — say so rather than
 * inventing one.
 */
export function ProfileCard() {
  const { syncAccount, signedIn } = useApp();
  const name = syncAccount ?? (signedIn ? 'Sync token' : 'Local (offline)');

  return (
    <Card title="Profile">
      <div className="flex gap-4 items-center mb-5">
        <div className="flex size-16 shrink-0 items-center justify-center bg-accent font-heading text-2xl font-semibold text-on-accent">
          {syncAccount ? initialsOf(syncAccount) : '—'}
        </div>
        <div>
          <div className="setting-label">{name}</div>
          <div className="setting-desc">
            {syncAccount
              ? 'Your account on the Albas sync server.'
              : signedIn
                ? 'Connected with a sync token; this device has no account name.'
                : 'Albas works fully offline. An account is only needed for sync and sharing.'}
          </div>
        </div>
      </div>
      <div className="setting-item">
        <div>
          <div className="setting-label">Display name</div>
          <div className="setting-desc">
            Set when the account was created — renaming it would break every share pointed at it, so it is fixed here.
          </div>
        </div>
        <span className="setting-label">{syncAccount ?? '—'}</span>
      </div>
    </Card>
  );
}

export function SessionCard({
  syncState,
  status,
  onSync,
  onSignOut,
  busy,
}: {
  syncState: SyncState;
  status: SyncStatusInfo | null;
  onSync: () => void;
  onSignOut: () => void;
  busy: boolean;
}) {
  // Signing out now drops the user back to the splash screen, so confirm it
  // rather than firing on a single stray click.
  const [confirming, setConfirming] = useState(false);

  return (
    <Card title="Session">
      <SettingItem
        label="Sync"
        description={
          status?.lastSync ? `Last sync: ${new Date(Number(status.lastSync)).toLocaleString()}` : 'Never synced'
        }
      >
        <button onClick={onSync} disabled={busy} className="button-small">
          Sync Now
        </button>
      </SettingItem>
      <SignedInPanel />
      <SettingItem label="Log out" description="Sign out of this device">
        <button onClick={() => setConfirming(true)} className="button-small button-danger">
          Log Out
        </button>
      </SettingItem>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          showCloseButton={false}
          className="block rounded-2xl p-md w-full max-w-[min(24rem,calc(100%-2rem))] border-line shadow-2xl"
        >
          <DialogTitle className="text-headline-lg-mobile font-title font-normal text-ink mb-sm">
            Sign out{status?.account ? ` of ${status.account}` : ''}?
          </DialogTitle>
          <DialogDescription className="text-body-sm text-ink-muted mb-md">
            Your local items stay on this device, but syncing will stop until you sign in again.
          </DialogDescription>
          <div className="flex gap-xs justify-end">
            <button onClick={() => setConfirming(false)} className="button-small">
              Cancel
            </button>
            <button
              onClick={() => {
                setConfirming(false);
                onSignOut();
              }}
              className="button-small button-danger"
            >
              Sign Out
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {syncState.kind === 'ok' && <FormMessage kind="success">{syncState.message}</FormMessage>}
      {syncState.kind === 'error' && <FormMessage>{syncState.message}</FormMessage>}
    </Card>
  );
}

/* ── Account & Sign-in ───────────────────────────────────────────────────*/

/** What one registered method resolved to. `undefined` while still loading. */
type MethodState = { rows: AuthMethodRow[]; error: string | null } | undefined;

/**
 * Loads every registered method's credentials in parallel.
 *
 * Each method is tracked separately on purpose: one failing endpoint must not
 * blank the table, so a rejection is recorded as that method's error and the
 * others still render their rows.
 */
function useAuthMethods(ctx: AuthMethodContext, enabled: boolean) {
  // `authMethods()` reads a module-level registry filled at import time, so the
  // list is stable for the life of the app.
  const methods = useMemo<AuthMethod[]>(() => authMethods(), []);
  const [byId, setById] = useState<Record<string, MethodState>>({});

  useEffect(() => {
    if (!enabled) {
      setById({});
      return;
    }
    let cancelled = false;
    setById({});
    for (const m of methods) {
      m.load(ctx)
        .then((rows) => {
          if (!cancelled) setById((prev) => ({ ...prev, [m.id]: { rows, error: null } }));
        })
        .catch((err) => {
          if (!cancelled) setById((prev) => ({ ...prev, [m.id]: { rows: [], error: String(err) } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [methods, ctx, enabled]);

  return { methods, byId };
}

export function AccountSigninCard({
  browser,
  password,
  busy,
  token,
  setToken,
  url,
  setUrl,
  manual,
  setManual,
  onConnect,
  status,
  syncToken,
  onAccountDeleted,
}: {
  browser: ReturnType<typeof useBrowserSignIn>;
  password: ReturnType<typeof usePasswordSignIn>;
  busy: boolean;
  token: string;
  setToken: (t: string) => void;
  url: string;
  setUrl: (u: string) => void;
  manual: boolean;
  setManual: (m: boolean) => void;
  onConnect: () => void;
  status: SyncStatusInfo | null;
  syncToken: string | null;
  /** Refreshes local state after the account itself is gone from the server. */
  onAccountDeleted: () => Promise<void>;
}) {
  const configured = !!status?.configured;

  // A counter, not a boolean: `refresh()` must re-run the loads even when the
  // token and server are unchanged, and a new object identity is what the
  // effect below keys on.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const ctx = useMemo<AuthMethodContext>(
    () => ({ token: syncToken, server: apiBase(status?.url), refresh }),
    // `tick` is deliberately a dependency: it is what makes `refresh()` bite.
    [syncToken, status?.url, refresh, tick],
  );

  const { methods, byId } = useAuthMethods(ctx, configured);

  const rows = methods.flatMap((m) => (byId[m.id]?.rows ?? []).map((r) => ({ ...r, methodId: m.id })));
  const loading = configured && methods.some((m) => byId[m.id] === undefined);
  const title = loading
    ? 'Account & Sign-in'
    : `Account & Sign-in (${rows.length} method${rows.length === 1 ? '' : 's'})`;

  return (
    <Card title={configured ? title : 'Account & Sign-in'} span>
      {!configured ? (
        <div className="py-4">
          <p className="text-sm text-ink-secondary mb-4">
            Sign in with your account name and password. Accounts are free; passkeys and two-factor can be added once
            you're in.
          </p>
          <div className="max-w-[22.5rem] mb-4">
            {browser.state.kind !== 'waiting' && browser.state.kind !== 'starting' && (
              <PasswordForm
                mode="login"
                state={password.state}
                onLogin={(n, p, c, rc) => void password.login(n, p, c, rc)}
                onRegister={() => {}}
                submitClass="button-primary"
              />
            )}
            <div className="mt-3">
              <SignedOutPanel browser={browser} busy={busy} />
            </div>
          </div>
          <button onClick={() => setManual(!manual)} className={LINK_MUTED}>
            {manual ? 'v' : '>'} Advanced: connect to your own server
          </button>
          {manual && (
            <div className="mt-3">
              <p className="text-xs text-ink-secondary mb-2 max-w-[22.5rem]">
                A server URL and a sync token together are a complete sign-in — the token is the only credential, and
                the server only ever stores its SHA-256. Leave the URL blank to use the default server (
                {DEFAULT_SYNC_URL}).
              </p>
              <MicroLabel className="text-ink mb-1">Server URL</MicroLabel>
              <input
                className="field-input max-w-[12.5rem] block mb-2"
                type="text"
                autoComplete="off"
                placeholder={DEFAULT_SYNC_URL}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <MicroLabel className="text-ink mb-1">Sync token</MicroLabel>
              <input
                className="field-input max-w-[12.5rem] block mb-2"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button onClick={onConnect} disabled={busy || token.trim() === ''} className="button-primary">
                Connect
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <SettingsTable headers={['Name', 'Type']}>
            {rows.map((row) => {
              const pill = METHOD_PILL[row.type];
              return (
                <tr key={`${row.methodId}:${row.key}`} className={SW_TR}>
                  <td className={SW_TD}>
                    {row.name}
                    {row.detail && <span className="setting-desc mt-0 ml-2">{row.detail}</span>}
                  </td>
                  <td className={SW_TD}>
                    <Tag accent={pill}>{row.type}</Tag>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <SettingsTableNote span={2}>No sign-in methods are attached to this account yet.</SettingsTableNote>
            )}
            {loading && <SettingsTableNote span={2}>Loading…</SettingsTableNote>}
          </SettingsTable>

          {/* One line per method that failed to load. The table above keeps
              whatever the other methods did return. */}
          {methods.map((m) => {
            const error = byId[m.id]?.error;
            return error ? (
              <FormMessage key={m.id}>
                {m.id}: {error}
              </FormMessage>
            ) : null;
          })}

          {/* The action row — each method's own control for adding/changing it. */}
          <div className="flex flex-wrap gap-4 items-start mt-5">
            {methods.map((m) => (m.Action ? <m.Action key={m.id} ctx={ctx} /> : null))}
          </div>

          <div className="mt-6 pt-5 border-t border-line">
            <ExportDataSection ctx={ctx} />
          </div>

          <div className="mt-6 pt-5 border-t border-line">
            <DangerZoneSection ctx={ctx} onDeleted={onAccountDeleted} />
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * `GET /account/export` hands every row this account owns back as JSON — big
 * enough on a real account that Rust writes it straight to a file (app data
 * dir) instead of round-tripping the text through IPC (see
 * `account.rs::account_export`); this just triggers that and shows the path.
 */
function ExportDataSection({ ctx }: { ctx: AuthMethodContext }) {
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; path: string } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function run() {
    setState({ kind: 'busy' });
    try {
      const path = await ipc.accountExport();
      setState({ kind: 'done', path });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div>
      <h4 className="card-title text-sm mb-2">Export data</h4>
      <p className="setting-desc mb-2">Downloads everything synced to this account as a JSON file.</p>
      <button className="button-small" onClick={() => void run()} disabled={!ctx.token || state.kind === 'busy'}>
        {state.kind === 'busy' ? 'Exporting...' : 'Export data'}
      </button>
      {state.kind === 'done' && (
        <p className="setting-desc mt-2">
          Saved to <code className="select-all">{state.path}</code>
        </p>
      )}
      {state.kind === 'error' && <FormMessage>{state.message}</FormMessage>}
    </div>
  );
}

/**
 * Permanently deletes the signed-in account server-side. Deliberately no
 * `window.confirm` — the password field itself, disabled until non-empty, is
 * the confirmation gate, matching the rest of this file's style.
 */
function DangerZoneSection({ ctx, onDeleted }: { ctx: AuthMethodContext; onDeleted: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setExpanded(false);
    setPassword('');
    setError(null);
  }

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      await ipc.accountDelete(password);
      setPassword('');
      setExpanded(false);
      await onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h4 className="card-title text-sm mb-2 text-danger">Danger zone</h4>
      {!expanded ? (
        <button className="button-small button-danger" onClick={() => setExpanded(true)} disabled={!ctx.token}>
          Delete account
        </button>
      ) : (
        <div className="max-w-[25rem]">
          <p className="setting-desc mb-2">
            This permanently deletes your account and everything synced to it - events, tasks, habits, shares, and every
            sign-in method - from the server. Local data on this device stays until you reset the app, but will no
            longer sync anywhere. This cannot be undone.
          </p>
          <input
            type="password"
            className="field-input max-w-[12.5rem] block mb-2"
            autoComplete="current-password"
            placeholder="Confirm your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <div className="flex gap-2">
            <button
              className="button-small button-danger"
              onClick={() => void confirmDelete()}
              disabled={busy || password.length === 0}
            >
              {busy ? 'Deleting...' : 'Permanently delete account'}
            </button>
            <button className="button-small" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
          {error && <FormMessage>{error}</FormMessage>}
        </div>
      )}
    </div>
  );
}

/* ── Sessions ────────────────────────────────────────────────────────────*/

/** Mirrors the `GET /tokens` row shape (Phase E, `sync-server`). */
interface TokenRow {
  id: number;
  label: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
  current: boolean;
}

/**
 * Every bearer token issued for this account, with a revoke button per
 * device other than the one Settings is currently running on — that one
 * goes through sign-out (`DELETE /tokens/current`) instead, not a row button
 * here. Its own `ctx`/`refresh` cycle, separate from `AccountSigninCard`'s:
 * revoking a session has nothing to do with re-checking sign-in methods.
 */
export function SessionsCard({ status, syncToken }: { status: SyncStatusInfo | null; syncToken: string | null }) {
  const ctx = useMemo<AuthMethodContext>(
    () => ({ token: syncToken, server: apiBase(status?.url), refresh: () => {} }),
    [syncToken, status?.url],
  );
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | 'all' | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/tokens', undefined, ctx);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(apiError(res, "Couldn't load sessions"));
      }
      setRows(res.body as TokenRow[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.token, ctx.server]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: number) {
    setBusyId(id);
    try {
      const res = await apiRequest('DELETE', `/tokens/${id}`, undefined, ctx);
      if ((res.status < 200 || res.status >= 300) && res.status !== 404) {
        throw new Error(apiError(res, "Couldn't revoke that session"));
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusyId(null);
    }
  }

  async function revokeOthers() {
    setBusyId('all');
    try {
      const res = await apiRequest('DELETE', '/tokens', undefined, ctx);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(apiError(res, "Couldn't sign out other devices"));
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusyId(null);
    }
  }

  const others = (rows ?? []).filter((r) => !r.current);

  return (
    <Card title="Sessions">
      <SettingsTable headers={['Device', 'Last used', '']}>
        {(rows ?? []).map((row) => (
          <tr key={row.id} className={SW_TR}>
            <td className={SW_TD}>
              {row.label?.trim() || 'Unnamed device'}
              {row.current && <Tag className="ml-2 bg-line text-ink-secondary">This device</Tag>}
            </td>
            <td className={SW_TD}>{timeAgo(row.lastUsedAt)}</td>
            <td className={SW_TD}>
              {!row.current && (
                <button
                  className="button-small button-danger"
                  onClick={() => void revoke(row.id)}
                  disabled={busyId !== null}
                >
                  {busyId === row.id ? 'Revoking...' : 'Revoke'}
                </button>
              )}
            </td>
          </tr>
        ))}
        {rows !== null && rows.length === 0 && <SettingsTableNote span={3}>No active sessions.</SettingsTableNote>}
        {rows === null && !error && <SettingsTableNote span={3}>Loading…</SettingsTableNote>}
      </SettingsTable>
      {error && <FormMessage>{error}</FormMessage>}
      {others.length > 0 && (
        <button className="button-small mt-4" onClick={() => void revokeOthers()} disabled={busyId !== null}>
          {busyId === 'all' ? 'Signing out...' : 'Sign out other devices'}
        </button>
      )}
    </Card>
  );
}
