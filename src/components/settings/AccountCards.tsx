import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useSettings } from '../../context/SettingsContext';
import * as ipc from '../../ipc';
import type { SyncStatusInfo } from '../../ipc';
import type { useBrowserSignIn, usePasswordSignIn } from '../auth/signInHooks';
import PasswordForm from '../auth/PasswordForm';
import { SignedInPanel, SignedOutPanel } from '../auth/CrossDevice';
import { FormMessage, MicroLabel } from '../ui/field';
import { Tag } from '../ui/tag';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { DEFAULT_SYNC_URL, apiBase, apiError, apiRequest } from '../../syncServer';
import { timeAgo } from '../../dates';
import { errorMessage, initialsOf } from '@/lib/utils';
import {
  authMethods,
  METHOD_PILL,
  type AuthMethod,
  type AuthMethodContext,
  type AuthMethodRow,
} from '../../authMethods/registry';
import {
  Card,
  LINK_MUTED,
  SettingItem,
  SettingsTable,
  SettingsTableNote,
  SW_TD,
  SW_TR,
  type AsyncState,
  AsyncMessage,
  useAsyncState,
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
  syncState: AsyncState;
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
        <button type="button" onClick={onSync} disabled={busy} className="button-small">
          Sync Now
        </button>
      </SettingItem>
      <PushDelaySetting />
      <SignedInPanel />
      <SettingItem label="Log out" description="Sign out of this device">
        <button type="button" onClick={() => setConfirming(true)} className="button-small button-danger">
          Log Out
        </button>
      </SettingItem>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-[min(24rem,calc(100%-2rem))]">
          <DialogTitle className="text-h1 mb-sm">Sign out{status?.account ? ` of ${status.account}` : ''}?</DialogTitle>
          <DialogDescription>
            Your local items stay on this device, but syncing will stop until you sign in again.
          </DialogDescription>
          <div className="flex gap-xs justify-end">
            <button type="button" onClick={() => setConfirming(false)} className="button-small">
              Cancel
            </button>
            <button
              type="button"
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
      <AsyncMessage state={syncState} />
    </Card>
  );
}

/**
 * How long after the last edit the automatic push waits (`DataContext`
 * `scheduleSync`). Stored as `__sync_debounce_ms` — device-local, like the
 * layout widths — and edited here in seconds; blank restores the 2 s default.
 */
const PUSH_DELAY_DEFAULT_S = 2;
const PUSH_DELAY_MIN_S = 0.5;
const PUSH_DELAY_MAX_S = 10;

function PushDelaySetting() {
  const { getSetting, setSetting } = useSettings();
  const stored = Number.parseInt(getSetting('__sync_debounce_ms') ?? '', 10);
  const [text, setText] = useState(stored > 0 ? String(stored / 1000) : '');

  const commit = () => {
    const n = Number.parseFloat(text);
    if (!Number.isFinite(n) || n <= 0) {
      setText('');
      setSetting('__sync_debounce_ms', '');
      return;
    }
    const clamped = Math.min(PUSH_DELAY_MAX_S, Math.max(PUSH_DELAY_MIN_S, n));
    setText(String(clamped));
    setSetting('__sync_debounce_ms', String(Math.round(clamped * 1000)));
  };

  return (
    <SettingItem
      label="Push after edits"
      description={`Seconds to wait after a change before syncing it (${PUSH_DELAY_MIN_S}–${PUSH_DELAY_MAX_S}; blank = ${PUSH_DELAY_DEFAULT_S}).`}
    >
      <label className="flex items-center gap-2">
        <MicroLabel className="text-ink">Seconds</MicroLabel>
        <input
          className="field-input w-20"
          type="number"
          inputMode="decimal"
          min={PUSH_DELAY_MIN_S}
          max={PUSH_DELAY_MAX_S}
          step={0.5}
          placeholder={String(PUSH_DELAY_DEFAULT_S)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </label>
    </SettingItem>
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
          if (!cancelled) setById((prev) => ({ ...prev, [m.id]: { rows: [], error: errorMessage(err) } }));
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
          <button type="button" onClick={() => setManual(!manual)} className={LINK_MUTED}>
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
              <button
                type="button"
                onClick={onConnect}
                disabled={busy || token.trim() === ''}
                className="button-primary"
              >
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
  const { state, run, busy } = useAsyncState();

  return (
    <div>
      <h4 className="card-title text-sm mb-2">Export data</h4>
      <p className="setting-desc mb-2">Downloads everything synced to this account as a JSON file.</p>
      <button
        type="button"
        className="button-small"
        onClick={() => void run('Exporting…', async () => `Saved to ${await ipc.accountExport()}`)}
        disabled={!ctx.token || busy}
      >
        {busy ? 'Exporting...' : 'Export data'}
      </button>
      <AsyncMessage state={state} />
    </div>
  );
}

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
      setError(errorMessage(e, 'Network error.'));
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
      setError(errorMessage(e, 'Network error.'));
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
      setError(errorMessage(e, 'Network error.'));
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
                  type="button"
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
        <button
          type="button"
          className="button-small mt-4"
          onClick={() => void revokeOthers()}
          disabled={busyId !== null}
        >
          {busyId === 'all' ? 'Signing out...' : 'Sign out other devices'}
        </button>
      )}
    </Card>
  );
}
