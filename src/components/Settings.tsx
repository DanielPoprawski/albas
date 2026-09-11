import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useApp, FONT_SIZES, FONT_STACKS } from '../context/AppContext';
import type { FontChoice, FontSizeChoice } from '../context/AppContext';
import { colorHex, DEFAULT_COLOR, isHex, PALETTE_COMPACT } from '../colors';
import { inTauri } from '../persistence';
import { parseIcs } from '../ics';
import * as ipc from '../ipc';
import type { SharesRes, SyncStatusInfo } from '../ipc';
import { useBrowserSignIn } from './auth/useBrowserSignIn';
import { usePasswordSignIn } from './auth/usePasswordSignIn';
import PasswordForm from './auth/PasswordForm';
import { SignedInPanel, SignedOutPanel } from './auth/CrossDevice';
import { Switch } from './ui/switch';
import { Card as UiCard } from './ui/card';
import { Checkbox } from './ui/checkbox';
import { Button, IconButton } from './ui/button';
import { FormMessage, MicroLabel } from './ui/field';
import { Tag } from './ui/tag';
import { Segmented } from './ui/segmented';
import { cn } from '@/lib/utils';
import { ColorPicker, inputClass } from './forms/shared';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { DEFAULT_SYNC_URL, apiBase, apiError, apiRequest, syncEndpoint } from '../syncServer';
import { timeAgo } from '../dates';
import { initialsOf } from './AppShell';
import { authMethods, METHOD_PILL, type AuthMethod, type AuthMethodContext, type AuthMethodRow } from '../authMethods';
import type { Category, CategoryScope, ThemeName } from '../types';
import { formatKeys, SHORTCUTS, type ShortcutGroup } from '../shortcuts';

/** The Account & Sign-in credential table and the Sessions table. */
const SW_TABLE = 'w-full border-collapse text-xs';
const SW_TH = 'micro-label border-b border-line px-2.5 py-2 text-left';
const SW_TD = 'border-b border-subtle p-2.5 text-ink';
/** The hairline belongs *between* rows, so the last row drops it. */
const SW_TR = 'last:[&>td]:border-b-0';
/** A muted inline text button ("Advanced", "Show recovery codes"). */
const LINK_MUTED = 'cursor-pointer border-0 bg-transparent p-0 text-xs text-ink-muted underline hover:text-ink';
/** A flat inset row inside a card (the share lists). */
const ROW_INSET = 'mb-1 flex items-center gap-3 bg-subtle px-2 py-1.5';

type SyncState =
  | { kind: 'idle' }
  | { kind: 'busy'; what: string }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

/**
 * The themes this build offers: two, not the four `CLAUDE.md` § Theming lists.
 * `grey-high` and `grey-low` are dropped — the redesign never drew them and
 * nobody asked for them back. There is deliberately no "Auto (System)": a
 * theme here is a stored value that `applyTheme()` stamps onto <html>, and
 * "follow the OS" is a fifth state with no `data-theme` to write.
 *
 * `AppContext`'s `THEMES` / `readTheme()` now validate against these same two,
 * so a database still holding `grey-high`/`grey-low` fails that check and falls
 * back to the default rather than selecting an option that no longer paints.
 */
const THEME_OPTIONS: { value: ThemeName; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Turns whatever a person pastes into the "Advanced" server field into
 * something `syncEndpoint()` (and then Rust's `check_url`) can judge.
 *
 * Blank -> the real default, never localhost. A bare domain (no scheme) is
 * assumed to mean `https://` — the common case of pasting just the host —
 * rather than being handed to `check_url` as-is to fail with a message that
 * doesn't explain what's missing. Anything already carrying a scheme
 * (including `http://`, e.g. a LAN test server) is passed through unchanged:
 * `check_url` in `sync.rs` is the single source of truth on which schemes are
 * actually allowed, and it will reject `http://` with a clear reason the next
 * time this device syncs.
 */
function normalizeSyncUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return DEFAULT_SYNC_URL;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export default function Settings() {
  const { setSetting, syncNow, reloadFromStore, syncToken } = useApp();
  const [status, setStatus] = useState<SyncStatusInfo | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({ kind: 'idle' });
  const [token, setToken] = useState('');
  const [manual, setManual] = useState(false);
  // Blank means "use the default server" (see `normalizeSyncUrl` below), never
  // prefilled from `status.url` — so clearing the field can't read back as
  // whatever custom value was last saved.
  const [url, setUrl] = useState('');

  const available = inTauri();
  const browser = useBrowserSignIn();
  const password = usePasswordSignIn();
  const busy =
    syncState.kind === 'busy' ||
    browser.state.kind === 'starting' ||
    browser.state.kind === 'waiting' ||
    password.state.kind === 'busy';

  useEffect(() => {
    if (!available) return;
    (async () => {
      try {
        setStatus(await ipc.syncStatus());
      } catch {
        // backend not ready
      }
    })();
  }, [available, browser.state.kind, password.state.kind]);

  async function sync() {
    setSyncState({ kind: 'busy', what: 'Syncing' });
    try {
      const out = await syncNow();
      await refreshStatus();
      const parts = [`sent ${out.pushed}`, `received ${out.pulled}`];
      if (out.skipped > 0) parts.push(`${out.skipped} skipped`);
      setSyncState({
        kind: out.skipped > 0 ? 'error' : 'ok',
        message:
          out.skipped > 0
            ? `Synced (${parts.join(', ')}). Skipped rows come from a newer version of Albas.`
            : `Synced - ${parts.join(', ')}.`,
      });
    } catch (err) {
      setSyncState({ kind: 'error', message: String(err) });
    }
  }

  /**
   * The local-state half of leaving an account, shared by `signOut()` and a
   * successful account deletion — both end with Rust having already cleared
   * the stored token, and the React tree needing to catch up the same way.
   * Order matters: persistence writes go through a serial queue that
   * `reloadFromStore()` does not join, so clearing the flag *before*
   * reloading would race the read-back and be clobbered by the stale '1'.
   * Without this the user is signed out but never returns to the splash,
   * because `welcomeDone` is `__welcome_done || signedIn`.
   */
  async function afterLeavingAccount() {
    await reloadFromStore();
    setSetting('__welcome_done', '0');
    await refreshStatus();
    setToken('');
    setSyncState({ kind: 'idle' });
  }

  async function signOut() {
    try {
      await ipc.syncSignOut();
      await afterLeavingAccount();
    } catch (err) {
      setSyncState({ kind: 'error', message: String(err) });
    }
  }

  async function refreshStatus() {
    try {
      setStatus(await ipc.syncStatus());
    } catch {
      // backend not ready
    }
  }

  async function connectManually() {
    setSyncState({ kind: 'busy', what: 'Saving' });
    try {
      setSetting('__sync_url', syncEndpoint(normalizeSyncUrl(url)));
      setSetting('__sync_token', token.trim());
      setSetting('__sync_account', '');
      setSetting('__welcome_done', '1');
      await refreshStatus();
      setSyncState({ kind: 'idle' });
      await sync();
    } catch (err) {
      setSyncState({ kind: 'error', message: String(err) });
    }
  }

  return (
    <div className="w-full max-w-[75rem] mx-auto">
      <div className="mb-6">
        <h1 className="mb-1.5 font-heading text-[1.375rem] font-bold text-ink">Settings</h1>
        <p className="text-sm text-ink-secondary">Manage your account and preferences</p>
      </div>

      <div className="grid grid-cols-2 items-start gap-5 max-md:grid-cols-1">
        <ProfileCard />

        {status?.configured && (
          <SessionCard syncState={syncState} status={status} onSync={sync} onSignOut={signOut} busy={busy} />
        )}

        <AccountSigninCard
          browser={browser}
          password={password}
          busy={busy}
          token={token}
          setToken={setToken}
          url={url}
          setUrl={setUrl}
          manual={manual}
          setManual={setManual}
          onConnect={connectManually}
          status={status}
          syncToken={syncToken}
          onAccountDeleted={afterLeavingAccount}
        />

        {status?.configured && <SessionsCard status={status} syncToken={syncToken} />}

        <AppearanceCard />

        <CategoriesCard />

        <PreferencesCard />

        <ShortcutsCard />

        <ImportCard />

        <SharingCard />

        <AboutCard />
      </div>
    </div>
  );
}

/* ── Profile ─────────────────────────────────────────────────────────────
 *
 * Read-only, deliberately. The only name Albas knows is the sync account's,
 * which the server owns (it is the name other people share *to*); there is no
 * local display-name setting, and `useApp()` exposes no way to read one back
 * after writing it, so an editable field here would be a control that silently
 * discards input. Signed out, there is no name at all — say so rather than
 * inventing one.
 */
function ProfileCard() {
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

function SessionCard({
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

function AccountSigninCard({
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
          <table className={SW_TABLE}>
            <thead>
              <tr>
                <th className={SW_TH}>Name</th>
                <th className={SW_TH}>Type</th>
              </tr>
            </thead>
            <tbody>
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
                <tr>
                  <td colSpan={2} className="text-ink-muted">
                    No sign-in methods are attached to this account yet.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={2} className="text-ink-muted">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>

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
function SessionsCard({ status, syncToken }: { status: SyncStatusInfo | null; syncToken: string | null }) {
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
      <table className={SW_TABLE}>
        <thead>
          <tr>
            <th className={SW_TH}>Device</th>
            <th className={SW_TH}>Last used</th>
            <th className={SW_TH}></th>
          </tr>
        </thead>
        <tbody>
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
          {rows !== null && rows.length === 0 && (
            <tr>
              <td colSpan={3} className="text-ink-muted">
                No active sessions.
              </td>
            </tr>
          )}
          {rows === null && !error && (
            <tr>
              <td colSpan={3} className="text-ink-muted">
                Loading…
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {error && <FormMessage>{error}</FormMessage>}
      {others.length > 0 && (
        <button className="button-small mt-4" onClick={() => void revokeOthers()} disabled={busyId !== null}>
          {busyId === 'all' ? 'Signing out...' : 'Sign out other devices'}
        </button>
      )}
    </Card>
  );
}

/* ── Appearance ──────────────────────────────────────────────────────────*/

/**
 * Theme, accent colour, font and text size — all live settings read from
 * `useApp()` (which derives them from the persisted `theme` / `accent` /
 * `font` / `fontSize` keys) and written through `setSetting`, whose
 * appearance branch calls `applyAppearance()` so the change paints at once.
 * No local state except the custom-colour input's own value.
 */
function AppearanceCard() {
  const { theme, accent, font, fontSize, setSetting } = useApp();
  const [custom, setCustom] = useState(accent || DEFAULT_COLOR);
  const fonts = Object.keys(FONT_STACKS) as FontChoice[];
  const sizes = Object.keys(FONT_SIZES) as FontSizeChoice[];

  return (
    <Card title="Appearance" span>
      <div className="setting-item">
        <div>
          <div className="setting-label">Theme</div>
          <div className="setting-desc">Applies immediately and is remembered across launches.</div>
        </div>
        <Segmented aria-label="Theme" options={THEME_OPTIONS} value={theme} onChange={(v) => setSetting('theme', v)} />
      </div>

      <div className="setting-item items-start">
        <div>
          <div className="setting-label">Accent colour</div>
          <div className="setting-desc">
            Buttons, highlights and the selected day. Hover and tint shades are derived from it.
          </div>
        </div>
        <div className="flex items-center gap-[0.5rem] flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setSetting('accent', '')}
            className={cn('button-small', accent === '' && 'border-accent text-accent bg-accent-tint')}
          >
            Default
          </button>
          {PALETTE_COMPACT.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={hex}
              title={hex}
              onClick={() => setSetting('accent', hex)}
              className="w-[1.5rem] h-[1.5rem] transition-transform hover:scale-110"
              // dynamic: the swatch's own colour and the selected-state outline
              style={{
                background: hex,
                outline: accent.toLowerCase() === hex ? '2px solid var(--t-ink)' : '1px solid var(--t-border)',
                outlineOffset: '2px',
              }}
            />
          ))}
          <label className="flex items-center gap-[0.25rem] setting-desc mt-0">
            <input
              type="color"
              value={isHex(custom) ? custom : DEFAULT_COLOR}
              onChange={(e) => {
                setCustom(e.target.value);
                setSetting('accent', e.target.value);
              }}
              aria-label="Custom accent colour"
              className="w-[1.5rem] h-[1.5rem] p-0 border border-line bg-transparent"
            />
            Custom
          </label>
        </div>
      </div>

      <div className="setting-item">
        <div>
          <div className="setting-label">Font</div>
          <div className="setting-desc">Outfit is the default; Slabo is a serif; System uses your OS font.</div>
        </div>
        <Segmented
          aria-label="Font"
          options={fonts.map((f) => ({
            value: f,
            // The option previews its own face — the one inline style that is
            // genuinely per-option data.
            // dynamic: each option previews its own font
            label: <span style={{ fontFamily: FONT_STACKS[f].body }}>{FONT_STACKS[f].label}</span>,
          }))}
          value={font}
          onChange={(v) => setSetting('font', v)}
        />
      </div>

      <div className="setting-item">
        <div>
          <div className="setting-label">Text size</div>
          <div className="setting-desc">Scales the whole interface, not just the text.</div>
        </div>
        <Segmented
          aria-label="Text size"
          options={sizes.map((sz) => ({ value: sz, label: FONT_SIZES[sz].label }))}
          value={fontSize}
          onChange={(v) => setSetting('fontSize', v)}
        />
      </div>
    </Card>
  );
}

/* ── Categories ──────────────────────────────────────────────────────────*/

const SCOPE_OPTIONS: { value: CategoryScope; label: string }[] = [
  { value: 'calendar', label: 'Calendar' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'habits', label: 'Habits' },
];

/**
 * User-managed, synced groupings for events/tasks/habits (Phase K). Rows are
 * kept in the user's manual `sort` order; reordering swaps two rows' `sort`
 * values rather than renumbering the whole list. Delete asks inline
 * ("Delete? Yes/No") instead of `window.confirm` — the rest of the app never
 * uses the native dialog, and `deleteCategory` already clears the id off
 * every referencing to-do/event so nothing is silently orphaned.
 */
function CategoriesCard() {
  const { categories, addCategory, updateCategory, deleteCategory } = useApp();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(DEFAULT_COLOR);
  const [newColorOpen, setNewColorOpen] = useState(false);

  const sorted = [...categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  function move(id: string, dir: -1 | 1) {
    const idx = sorted.findIndex((c) => c.id === id);
    const other = sorted[idx + dir];
    if (idx === -1 || !other) return;
    const a = sorted[idx];
    updateCategory(a.id, { sort: other.sort });
    updateCategory(other.id, { sort: a.sort });
  }

  function toggleScope(cat: Category, scope: CategoryScope) {
    const scopes = cat.scopes.includes(scope) ? cat.scopes.filter((s) => s !== scope) : [...cat.scopes, scope];
    updateCategory(cat.id, { scopes });
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    addCategory({ name, colorKey: newColor, scopes: ['tasks'], sort: sorted.length });
    setNewName('');
    setNewColorOpen(false);
  }

  return (
    <Card title="Categories" span>
      <p className="setting-desc mb-4">
        Shared groupings for events, tasks and habits — pick which surfaces each one appears on.
      </p>
      <div className="space-y-sm">
        {sorted.map((cat, i) => (
          <div key={cat.id}>
            <div className="flex items-center gap-sm flex-wrap">
              <button
                type="button"
                onClick={() => setEditingColorId(editingColorId === cat.id ? null : cat.id)}
                aria-label="Change colour"
                title={colorHex(cat.colorKey)}
                className="w-[1.375rem] h-[1.375rem] flex-shrink-0 border border-line transition-transform hover:scale-110"
                // dynamic: the category's own colour
                style={{ background: colorHex(cat.colorKey) }}
              />
              <input
                className={`${inputClass} flex-[1_1_10rem] min-w-32`}
                value={cat.name}
                onChange={(e) => updateCategory(cat.id, { name: e.target.value })}
              />
              <div className="flex items-center gap-sm flex-wrap">
                {SCOPE_OPTIONS.map(({ value, label }) => (
                  <label
                    key={value}
                    className="flex items-center gap-[0.3125rem] text-xs text-ink-secondary cursor-pointer"
                  >
                    <Checkbox checked={cat.scopes.includes(value)} onCheckedChange={() => toggleScope(cat, value)} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-[0.125rem] flex-shrink-0">
                <IconButton onClick={() => move(cat.id, -1)} disabled={i === 0} aria-label="Move up">
                  <ChevronUp size="0.875rem" />
                </IconButton>
                <IconButton onClick={() => move(cat.id, 1)} disabled={i === sorted.length - 1} aria-label="Move down">
                  <ChevronDown size="0.875rem" />
                </IconButton>
              </div>
              {confirmId === cat.id ? (
                <span className="flex items-center gap-xs text-sm flex-shrink-0">
                  Delete?
                  <button
                    type="button"
                    onClick={() => {
                      deleteCategory(cat.id);
                      setConfirmId(null);
                    }}
                    className="font-semibold text-danger hover:underline"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="text-ink-muted hover:text-ink hover:underline"
                  >
                    No
                  </button>
                </span>
              ) : (
                <IconButton onClick={() => setConfirmId(cat.id)} aria-label={`Delete ${cat.name}`}>
                  <Trash2 size="0.875rem" />
                </IconButton>
              )}
            </div>
            {editingColorId === cat.id && (
              <div className="mt-xs mb-xs pl-[1.875rem]">
                <ColorPicker value={cat.colorKey} onChange={(hex) => updateCategory(cat.id, { colorKey: hex })} />
              </div>
            )}
          </div>
        ))}

        {sorted.length === 0 && <p className="text-body-sm text-ink-muted">No categories yet — add one below.</p>}

        {/* Add row */}
        <div className={cn('pt-xs', sorted.length > 0 && 'border-t border-line')}>
          <div className="flex items-center gap-sm flex-wrap">
            <button
              type="button"
              onClick={() => setNewColorOpen((v) => !v)}
              aria-label="Pick colour for new category"
              title={newColor}
              className="w-[1.375rem] h-[1.375rem] flex-shrink-0 border border-line transition-transform hover:scale-110"
              // dynamic: the colour picked for the new category
              style={{ background: newColor }}
            />
            <input
              className={`${inputClass} flex-[1_1_10rem] min-w-32`}
              placeholder="New category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
            <Button size="sm" onClick={handleAdd} disabled={!newName.trim()} className="gap-xs flex-shrink-0">
              <Plus size="0.8125rem" />
              Add category
            </Button>
          </div>
          {newColorOpen && (
            <div className="mt-xs pl-[1.875rem]">
              <ColorPicker value={newColor} onChange={setNewColor} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── Preferences ─────────────────────────────────────────────────────────*/

/**
 * Week start. It is a live setting threaded through the whole calendar
 * (`firstDayOfWeek` is a trailing argument on a dozen date helpers), so it is
 * read from `useApp()` rather than local state.
 */
function PreferencesCard() {
  const { firstDayOfWeek, setSetting } = useApp();

  return (
    <Card title="Preferences">
      <div>
        <div className="setting-label mb-2">Week starts on</div>
        <Segmented
          aria-label="Week starts on"
          options={[
            { value: '1', label: 'Monday' },
            { value: '0', label: 'Sunday' },
          ]}
          value={String(firstDayOfWeek)}
          onChange={(v) => setSetting('firstDayOfWeek', v)}
        />
        <p className="setting-desc mt-2">
          Changes the calendar and the weekly strips. A “N times per week” to-do counts its completions inside this
          week, so its progress can shift.
        </p>
      </div>
    </Card>
  );
}

/* ── Shortcuts ───────────────────────────────────────────────────────────*/

const SHORTCUT_GROUPS: ShortcutGroup[] = ['Navigation', 'Create', 'Search'];

/**
 * A reference card, not a settings surface — `shortcuts.ts#SHORTCUTS` is the
 * only place a binding is defined, this just renders it grouped. `Ctrl`
 * prints as `⌘` on Mac (`formatKeys`).
 */
function ShortcutsCard() {
  return (
    <Card title="Keyboard shortcuts">
      <div className="space-y-md">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group}>
            <div className="setting-label mb-2">{group}</div>
            <div className="space-y-xs">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-sm">
                  <span className="setting-desc mt-0">{s.label}</span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    {formatKeys(s.keys).map((k, i) => (
                      <kbd
                        key={i}
                        className="inline-flex h-5 min-w-5 items-center justify-center border border-line-strong bg-subtle px-1 text-xs font-semibold text-ink-secondary"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Calendar import ─────────────────────────────────────────────────────*/

type ImportState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; imported: number; skipped: number }
  | { kind: 'error'; message: string };

function ImportCard() {
  const { importEvents } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ImportState>({ kind: 'idle' });

  function runImport(text: string) {
    const { events, skipped } = parseIcs(text);
    if (events.length === 0) {
      setState({ kind: 'error', message: 'No events found — is that an iCalendar (.ics) file?' });
      return;
    }
    importEvents(events);
    setState({ kind: 'done', imported: events.length, skipped });
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setState({ kind: 'busy' });
    try {
      runImport(await file.text());
    } catch (err) {
      setState({ kind: 'error', message: `Couldn't read file: ${err}` });
    }
    if (fileRef.current) fileRef.current.value = ''; // allow re-picking the same file
  }

  async function handleUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setState({ kind: 'busy' });
    try {
      runImport(await ipc.fetchIcs(trimmed));
    } catch (err) {
      setState({ kind: 'error', message: `Fetch failed: ${err}` });
    }
  }

  return (
    <Card title="Calendar import">
      <p className="setting-desc mb-4">
        Imported entries become regular Albas events, matched by ID — importing again updates instead of duplicating.
      </p>

      <div className="mb-4">
        <div className="setting-label">From an exported file</div>
        <p className="setting-desc mb-2">
          Google Calendar → Settings → Import &amp; export → Export, then unzip and pick the .ics file for a calendar.
        </p>
        <button type="button" onClick={() => fileRef.current?.click()} className="button-primary">
          Choose .ics file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ics,text/calendar"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      <div>
        <div className="setting-label">From a calendar URL</div>
        <p className="setting-desc mb-2">
          Google Calendar → Settings → your calendar → Integrate calendar → “Secret address in iCal format”. Keep this
          URL private.
        </p>
        <div className="flex gap-2 items-center">
          <input
            className="field-input max-w-[12.5rem] flex-1 min-w-0 w-auto"
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!inTauri()}
          />
          <button
            type="button"
            onClick={handleUrl}
            disabled={!inTauri() || state.kind === 'busy'}
            className="button-primary shrink-0"
          >
            Import
          </button>
        </div>
        {!inTauri() && (
          <p className="setting-desc mt-2">URL import needs the desktop app — use the file import in the browser.</p>
        )}
      </div>

      {state.kind === 'busy' && <FormMessage kind="busy">Importing…</FormMessage>}
      {state.kind === 'done' && (
        <FormMessage kind="success">
          Imported {state.imported} event{state.imported === 1 ? '' : 's'}
          {state.skipped > 0 ? ` (${state.skipped} skipped)` : ''}.
        </FormMessage>
      )}
      {state.kind === 'error' && <FormMessage>{state.message}</FormMessage>}
    </Card>
  );
}

/* ── Sharing ─────────────────────────────────────────────────────────────*/

/**
 * Who can see your calendar and to-dos, and whose you see. Sharing is
 * read-only in both directions and granted per category. Hiding an incoming
 * share is local to this device (it just stops
 * drawing it), which is why it isn't a server call.
 */
function SharingCard() {
  const { signedIn, hiddenOwners, toggleOwnerHidden, reloadFromStore } = useApp();
  const [shares, setShares] = useState<SharesRes | null>(null);
  const [state, setState] = useState<SyncState>({ kind: 'idle' });
  const [newName, setNewName] = useState('');

  const available = inTauri() && signedIn;

  async function load() {
    setShares(await ipc.sharesList());
  }

  useEffect(() => {
    if (!available) return;
    load().catch((err) => setState({ kind: 'error', message: String(err) }));
  }, [available]);

  async function setShare(name: string, calendar: boolean, todos: boolean) {
    setState({ kind: 'busy', what: 'Saving…' });
    try {
      await ipc.sharesSet(name, calendar, todos);
      await load();
      setState({ kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  }

  async function addShare() {
    const name = newName.trim();
    if (!name) return;
    await setShare(name, true, false);
    setNewName('');
  }

  /** Their next sync is what actually moves data; ours only re-reads grants. */
  async function refreshIncoming() {
    setState({ kind: 'busy', what: 'Syncing…' });
    try {
      await ipc.syncNow();
      await reloadFromStore();
      await load();
      setState({ kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  }

  if (!available) return null;

  return (
    <Card title="Sharing">
      <p className="setting-desc mb-4">
        Let another account on this server see your calendar or your to-dos and habits. Sharing is{' '}
        <strong>read-only</strong> — they can't edit or check anything off.
      </p>

      <div className="setting-label">You share with</div>
      {shares?.outgoing.length === 0 && <p className="setting-desc">Nobody yet.</p>}
      <div className="mt-2 mb-4">
        {shares?.outgoing.map((g) => (
          <div key={g.name} className={ROW_INSET}>
            <span className="setting-label flex-1 min-w-0 truncate">{g.name}</span>
            <label className="setting-desc flex items-center gap-1.5 mt-0">
              <Switch checked={g.calendar} onCheckedChange={(v) => setShare(g.name, v, g.todos)} />
              Calendar
            </label>
            <label className="setting-desc flex items-center gap-1.5 mt-0">
              <Switch checked={g.todos} onCheckedChange={(v) => setShare(g.name, g.calendar, v)} />
              To-dos &amp; habits
            </label>
          </div>
        ))}
      </div>

      <div className="setting-label">Share with someone</div>
      <div className="flex gap-2 mt-2">
        <input
          className="field-input max-w-[12.5rem] flex-1 min-w-0 w-auto"
          autoComplete="off"
          placeholder="their account name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addShare();
          }}
        />
        <button
          onClick={() => void addShare()}
          disabled={state.kind === 'busy' || newName.trim() === ''}
          className="button-primary shrink-0"
        >
          Share
        </button>
      </div>
      <p className="setting-desc mt-2">
        Starts with the calendar shared; switch either category off any time. Turning both off removes the share
        entirely.
      </p>

      <div className="mt-4 pt-4 border-t border-line">
        <div className="setting-label">Shared with you</div>
        {shares?.incoming.length === 0 ? (
          <p className="setting-desc">Nothing yet. Ask them to share with your account name in their Settings.</p>
        ) : (
          <div className="mt-2">
            {shares?.incoming.map((g) => (
              <div key={g.name} className={ROW_INSET}>
                <span className="setting-label flex-1 min-w-0 truncate">
                  {g.name}
                  <span className="setting-desc mt-0">
                    {' · '}
                    {[g.calendar && 'calendar', g.todos && 'to-dos & habits'].filter(Boolean).join(', ')}
                  </span>
                </span>
                <label className="setting-desc flex items-center gap-1.5 mt-0">
                  <Switch checked={!hiddenOwners.includes(g.name)} onCheckedChange={() => toggleOwnerHidden(g.name)} />
                  Show
                </label>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => void refreshIncoming()} disabled={state.kind === 'busy'} className="button-small mt-3">
          Refresh
        </button>
      </div>

      {state.kind === 'busy' && <FormMessage kind="busy">{state.what}</FormMessage>}
      {state.kind === 'error' && <FormMessage>{state.message}</FormMessage>}
    </Card>
  );
}

/* ── About ───────────────────────────────────────────────────────────────*/

/**
 * The one place the running version is visible. `__APP_VERSION__` is injected
 * by Vite from package.json (see `define` in vite.config.ts), which is the
 * single source every other version file is derived from — so if this number
 * is right, the bundle, the installer and the APK all agree.
 */
function AboutCard() {
  // No Tauri platform check — `os` would be a plugin and an async call for one
  // word of text. Android's WebView is the only one that says so in the UA.
  const platform = !inTauri()
    ? 'Browser (data stays in this browser)'
    : /android/i.test(navigator.userAgent)
      ? 'Android app'
      : 'Desktop app';

  return (
    <Card title="About">
      <div className="setting-item">
        <div>
          <div className="setting-label">Albas v{__APP_VERSION__}</div>
          <div className="setting-desc">{platform}</div>
        </div>
      </div>
    </Card>
  );
}

/* ── Shared card chrome ──────────────────────────────────────────────────*/

function Card({ title, span = false, children }: { title: string; span?: boolean; children: ReactNode }) {
  return (
    // `ui/card.tsx`'s Card for the surface (adds `shadow-card` over the old
    // shadowless `.settings-card`); the heading stays Settings' own flat
    // uppercase label (`.card-title`) rather than `CardHeader`'s
    // accent-tinted strip, which is a different card style used elsewhere.
    <UiCard className={span ? 'col-span-full p-6' : 'p-6'}>
      <h3 className="card-title">{title}</h3>
      {children}
    </UiCard>
  );
}

function SettingItem({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="setting-item">
      <div>
        <div className="setting-label">{label}</div>
        <div className="setting-desc">{description}</div>
      </div>
      {children}
    </div>
  );
}
