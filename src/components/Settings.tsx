import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useApp } from '../context/AppContext';
import type { SyncStatusInfo } from '../context/AppContext';
import { inTauri } from '../persistence';
import { parseIcs } from '../ics';
import { useBrowserSignIn } from './auth/useBrowserSignIn';
import { Switch } from './ui/switch';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { DEFAULT_SYNC_URL, apiBase, syncEndpoint } from '../syncServer';
import { initialsOf } from './AppShell';
import {
  authMethods,
  METHOD_PILL,
  type AuthMethod,
  type AuthMethodContext,
  type AuthMethodRow,
} from '../authMethods';
import type {
  FirstDayOfWeek,
  ShareGrant,
  ThemeName,
  WeightEntry,
  WeightUnit,
} from '../types';

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
  const busy = syncState.kind === 'busy' || browser.state.kind === 'starting' || browser.state.kind === 'waiting';

  useEffect(() => {
    if (!available) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        setStatus(await invoke<SyncStatusInfo>('sync_status'));
      } catch {
        // backend not ready
      }
    })();
  }, [available, browser.state.kind]);

  async function sync() {
    setSyncState({ kind: 'busy', what: 'Syncing' });
    try {
      const out = await syncNow();
      await refreshStatus();
      const parts = [`sent ${out.pushed}`, `received ${out.pulled}`];
      if (out.skipped > 0) parts.push(`${out.skipped} skipped`);
      setSyncState({
        kind: out.skipped > 0 ? 'error' : 'ok',
        message: out.skipped > 0 ? `Synced (${parts.join(', ')}). Skipped rows come from a newer version of Albas.` : `Synced - ${parts.join(', ')}.`,
      });
    } catch (err) {
      setSyncState({ kind: 'error', message: String(err) });
    }
  }

  async function signOut() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('sync_sign_out');
      await reloadFromStore();
      // Order matters: persistence writes go through a serial queue that
      // load() does not join, so clearing the flag *before* reloadFromStore
      // would race the read-back and be clobbered by the stale '1'.
      // Without this the user is signed out but never returns to the splash,
      // because welcomeDone is `__welcome_done || signedIn`.
      setSetting('__welcome_done', '0');
      await refreshStatus();
      setToken('');
      setSyncState({ kind: 'idle' });
    } catch (err) {
      setSyncState({ kind: 'error', message: String(err) });
    }
  }

  async function refreshStatus() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      setStatus(await invoke<SyncStatusInfo>('sync_status'));
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
    <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
      <div className="settings-header">
        <h1>Settings</h1>
        <p>Manage your account and preferences</p>
      </div>

      <div className="cards-grid">
        <ProfileCard />

        {status?.configured && (
          <SessionCard
            syncState={syncState}
            status={status}
            onSync={sync}
            onSignOut={signOut}
            busy={busy}
          />
        )}

        <AccountSigninCard
          browser={browser}
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
        />

        <ThemeCard />

        <PreferencesCard />

        <ImportCard />

        <SharingCard />

        <WyzeCard />

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
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '20px' }}>
        <div className="avatar-box">{syncAccount ? initialsOf(syncAccount) : '—'}</div>
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
            Set when the account was created — renaming it would break every share
            pointed at it, so it is fixed here.
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
      <SettingItem label="Sync" description={status?.lastSync ? `Last sync: ${new Date(Number(status.lastSync)).toLocaleString()}` : 'Never synced'}>
        <button onClick={onSync} disabled={busy} className="button-small">
          Sync Now
        </button>
      </SettingItem>
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
          <DialogTitle className="text-headline-lg-mobile font-title font-normal text-txt mb-sm">
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
      {syncState.kind === 'ok' && <p style={{ fontSize: '12px', color: 'var(--t-success)', marginTop: '12px' }}>{syncState.message}</p>}
      {syncState.kind === 'error' && <p style={{ fontSize: '12px', color: 'var(--t-danger)', marginTop: '12px' }}>{syncState.message}</p>}
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
        .then(rows => {
          if (!cancelled) setById(prev => ({ ...prev, [m.id]: { rows, error: null } }));
        })
        .catch(err => {
          if (!cancelled) setById(prev => ({ ...prev, [m.id]: { rows: [], error: String(err) } }));
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
}) {
  const configured = !!status?.configured;

  // A counter, not a boolean: `refresh()` must re-run the loads even when the
  // token and server are unchanged, and a new object identity is what the
  // effect below keys on.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  const ctx = useMemo<AuthMethodContext>(
    () => ({ token: syncToken, server: apiBase(status?.url), refresh }),
    // `tick` is deliberately a dependency: it is what makes `refresh()` bite.
    [syncToken, status?.url, refresh, tick]
  );

  const { methods, byId } = useAuthMethods(ctx, configured);

  const rows = methods.flatMap(m => (byId[m.id]?.rows ?? []).map(r => ({ ...r, methodId: m.id })));
  const loading = configured && methods.some(m => byId[m.id] === undefined);
  const title = loading
    ? 'Account & Sign-in'
    : `Account & Sign-in (${rows.length} method${rows.length === 1 ? '' : 's'})`;

  return (
    <Card title={configured ? title : 'Account & Sign-in'} span>
      {!configured ? (
        <div style={{ paddingTop: '16px', paddingBottom: '16px' }}>
          <p style={{ fontSize: '12px', color: 'var(--t-ink-secondary)', marginBottom: '16px' }}>
            Sign in through your browser - passkey, password or two-factor, whichever you've set up. Accounts are free.
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button onClick={() => void browser.start('login')} disabled={busy} className="button-primary">
              Sign in
            </button>
          </div>
          {browser.state.kind === 'waiting' && (
            <p style={{ fontSize: '12px', color: 'var(--t-ink-secondary)', marginBottom: '16px' }}>
              Finish in your browser - it should show the code <strong>{browser.state.code}</strong>.{' '}
              <button
                onClick={() => void browser.cancel()}
                style={{ background: 'none', border: 'none', color: 'var(--t-accent)', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
              >
                Cancel
              </button>
            </p>
          )}
          <button
            onClick={() => setManual(!manual)}
            style={{ fontSize: '11px', color: 'var(--t-ink-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {manual ? 'v' : '>'} Advanced: connect to your own server
          </button>
          {manual && (
            <div style={{ marginTop: '12px' }}>
              <p style={{ fontSize: '11px', color: 'var(--t-ink-secondary)', marginBottom: '8px', maxWidth: '360px' }}>
                A server URL and a sync token together are a complete sign-in — the
                token is the only credential, and the server only ever stores its
                SHA-256. Leave the URL blank to use the default server ({DEFAULT_SYNC_URL}).
              </p>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: '700', color: 'var(--t-ink)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.5px' }}>Server URL</label>
              <input
                className="input-text"
                style={{ marginBottom: '8px', display: 'block' }}
                type="text"
                autoComplete="off"
                placeholder={DEFAULT_SYNC_URL}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <label style={{ display: 'block', fontSize: '10px', fontWeight: '700', color: 'var(--t-ink)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.5px' }}>Sync token</label>
              <input
                className="input-text"
                style={{ marginBottom: '8px', display: 'block' }}
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
          <table className="sw-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const pill = METHOD_PILL[row.type];
                return (
                  <tr key={`${row.methodId}:${row.key}`}>
                    <td>
                      {row.name}
                      {row.detail && (
                        <span className="setting-desc" style={{ marginTop: 0, marginLeft: '8px' }}>
                          {row.detail}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="type-pill" style={{ background: pill.bg, color: pill.color }}>
                        {row.type}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ color: 'var(--t-ink-muted)' }}>
                    No sign-in methods are attached to this account yet.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={2} style={{ color: 'var(--t-ink-muted)' }}>Loading…</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* One line per method that failed to load. The table above keeps
              whatever the other methods did return. */}
          {methods.map(m => {
            const error = byId[m.id]?.error;
            return error ? (
              <p key={m.id} style={{ fontSize: '12px', color: 'var(--t-danger)', marginTop: '12px' }}>
                {m.id}: {error}
              </p>
            ) : null;
          })}

          {/* The action row — each method's own control for adding/changing it. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start', marginTop: '20px' }}>
            {methods.map(m => (m.Action ? <m.Action key={m.id} ctx={ctx} /> : null))}
          </div>
        </>
      )}
      {browser.state.kind === 'starting' && <p style={{ fontSize: '12px', color: 'var(--t-ink-secondary)', marginTop: '12px' }}>Opening your browser…</p>}
      {browser.state.kind === 'error' && <p style={{ fontSize: '12px', color: 'var(--t-danger)', marginTop: '12px' }}>{browser.state.message}</p>}
    </Card>
  );
}

/* ── Appearance ──────────────────────────────────────────────────────────*/

/**
 * Light / Dark, wired to the real path: the current value is read from
 * `useApp().theme` (which derives it from the persisted `theme` setting), and
 * a click goes through `setSetting`, whose `theme` branch calls `applyTheme`
 * to stamp `data-theme` on <html> and mirror it to localStorage for the
 * pre-mount script in index.html.
 *
 * No local `useState`: the context is the source of truth, so the selection
 * survives leaving and re-entering the page and can never disagree with what
 * is actually applied.
 */
function ThemeCard() {
  const { theme, setSetting } = useApp();

  return (
    <Card title="Theme">
      <div className="seg-group">
        {THEME_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setSetting('theme', value)}
            className={`seg-opt${theme === value ? ' active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="setting-desc" style={{ marginTop: '12px' }}>
        Applies immediately and is remembered across launches.
      </p>
    </Card>
  );
}

/* ── Preferences ─────────────────────────────────────────────────────────*/

/**
 * Weight unit and week start. Both are live settings threaded through the
 * whole calendar (`firstDayOfWeek` is a trailing argument on a dozen date
 * helpers), so they are read from `useApp()` rather than local state.
 */
function PreferencesCard() {
  const { weightUnit, firstDayOfWeek, setSetting } = useApp();

  return (
    <Card title="Preferences">
      <div style={{ marginBottom: '16px' }}>
        <div className="setting-label" style={{ marginBottom: '8px' }}>Weight unit</div>
        <div className="seg-group">
          {(['lb', 'kg'] as WeightUnit[]).map(u => (
            <button
              key={u}
              onClick={() => setSetting('weightUnit', u)}
              className={`seg-opt${weightUnit === u ? ' active' : ''}`}
            >
              {u}
            </button>
          ))}
        </div>
        <p className="setting-desc" style={{ marginTop: '8px' }}>
          Readings are always stored in kilograms; this only changes how they are shown.
        </p>
      </div>

      <div>
        <div className="setting-label" style={{ marginBottom: '8px' }}>Week starts on</div>
        <div className="seg-group">
          {([[1, 'Monday'], [0, 'Sunday']] as [FirstDayOfWeek, string][]).map(([day, label]) => (
            <button
              key={day}
              onClick={() => setSetting('firstDayOfWeek', String(day))}
              className={`seg-opt${firstDayOfWeek === day ? ' active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="setting-desc" style={{ marginTop: '8px' }}>
          Changes the calendar and the weekly strips. A “N times per week” to-do counts
          its completions inside this week, so its progress can shift.
        </p>
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
      const { invoke } = await import('@tauri-apps/api/core');
      runImport(await invoke<string>('fetch_ics', { url: trimmed }));
    } catch (err) {
      setState({ kind: 'error', message: `Fetch failed: ${err}` });
    }
  }

  return (
    <Card title="Calendar import">
      <p className="setting-desc" style={{ marginBottom: '16px' }}>
        Imported entries become regular Albas events, matched by ID — importing again
        updates instead of duplicating.
      </p>

      <div style={{ marginBottom: '16px' }}>
        <div className="setting-label">From an exported file</div>
        <p className="setting-desc" style={{ marginBottom: '8px' }}>
          Google Calendar → Settings → Import &amp; export → Export, then unzip and pick
          the .ics file for a calendar.
        </p>
        <button type="button" onClick={() => fileRef.current?.click()} className="button-primary">
          Choose .ics file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ics,text/calendar"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files?.[0])}
        />
      </div>

      <div>
        <div className="setting-label">From a calendar URL</div>
        <p className="setting-desc" style={{ marginBottom: '8px' }}>
          Google Calendar → Settings → your calendar → Integrate calendar → “Secret
          address in iCal format”. Keep this URL private.
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            className="input-text"
            style={{ flex: 1, minWidth: 0, width: 'auto' }}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            value={url}
            onChange={e => setUrl(e.target.value)}
            disabled={!inTauri()}
          />
          <button
            type="button"
            onClick={handleUrl}
            disabled={!inTauri() || state.kind === 'busy'}
            className="button-primary"
            style={{ flexShrink: 0 }}
          >
            Import
          </button>
        </div>
        {!inTauri() && (
          <p className="setting-desc" style={{ marginTop: '8px' }}>
            URL import needs the desktop app — use the file import in the browser.
          </p>
        )}
      </div>

      {state.kind === 'busy' && <p className="setting-desc" style={{ marginTop: '12px' }}>Importing…</p>}
      {state.kind === 'done' && (
        <p style={{ fontSize: '12px', color: 'var(--t-success)', marginTop: '12px' }}>
          Imported {state.imported} event{state.imported === 1 ? '' : 's'}
          {state.skipped > 0 ? ` (${state.skipped} skipped)` : ''}.
        </p>
      )}
      {state.kind === 'error' && (
        <p style={{ fontSize: '12px', color: 'var(--t-danger)', marginTop: '12px' }}>{state.message}</p>
      )}
    </Card>
  );
}

/* ── Sharing ─────────────────────────────────────────────────────────────*/

interface SharesRes {
  outgoing: ShareGrant[];
  incoming: ShareGrant[];
}

/**
 * Who can see your calendar and to-dos, and whose you see. Sharing is
 * read-only in both directions and granted per category; weights are never
 * shareable. Hiding an incoming share is local to this device (it just stops
 * drawing it), which is why it isn't a server call.
 */
function SharingCard() {
  const { signedIn, hiddenOwners, toggleOwnerHidden, reloadFromStore } = useApp();
  const [shares, setShares] = useState<SharesRes | null>(null);
  const [state, setState] = useState<SyncState>({ kind: 'idle' });
  const [newName, setNewName] = useState('');

  const available = inTauri() && signedIn;

  async function load() {
    const { invoke } = await import('@tauri-apps/api/core');
    setShares(await invoke<SharesRes>('shares_list'));
  }

  useEffect(() => {
    if (!available) return;
    load().catch(err => setState({ kind: 'error', message: String(err) }));
  }, [available]);

  async function setShare(name: string, calendar: boolean, todos: boolean) {
    setState({ kind: 'busy', what: 'Saving…' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('shares_set', { name, calendar, todos });
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
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('sync_now');
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
      <p className="setting-desc" style={{ marginBottom: '16px' }}>
        Let another account on this server see your calendar or your to-dos and habits.
        Sharing is <strong>read-only</strong> — they can't edit or check anything off.
        Weight data is never shared.
      </p>

      <div className="setting-label">You share with</div>
      {shares?.outgoing.length === 0 && <p className="setting-desc">Nobody yet.</p>}
      <div style={{ marginTop: '8px', marginBottom: '16px' }}>
        {shares?.outgoing.map(g => (
          <div
            key={g.name}
            style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 8px', background: 'var(--t-subtle)', marginBottom: '4px' }}
          >
            <span className="setting-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {g.name}
            </span>
            <label className="setting-desc" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 0 }}>
              <Switch checked={g.calendar} onCheckedChange={v => setShare(g.name, v, g.todos)} />
              Calendar
            </label>
            <label className="setting-desc" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 0 }}>
              <Switch checked={g.todos} onCheckedChange={v => setShare(g.name, g.calendar, v)} />
              To-dos &amp; habits
            </label>
          </div>
        ))}
      </div>

      <div className="setting-label">Share with someone</div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <input
          className="input-text"
          style={{ flex: 1, minWidth: 0, width: 'auto' }}
          autoComplete="off"
          placeholder="their account name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void addShare(); }}
        />
        <button
          onClick={() => void addShare()}
          disabled={state.kind === 'busy' || newName.trim() === ''}
          className="button-primary"
          style={{ flexShrink: 0 }}
        >
          Share
        </button>
      </div>
      <p className="setting-desc" style={{ marginTop: '8px' }}>
        Starts with the calendar shared; switch either category off any time. Turning both
        off removes the share entirely.
      </p>

      <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--t-border)' }}>
        <div className="setting-label">Shared with you</div>
        {shares?.incoming.length === 0 ? (
          <p className="setting-desc">
            Nothing yet. Ask them to share with your account name in their Settings.
          </p>
        ) : (
          <div style={{ marginTop: '8px' }}>
            {shares?.incoming.map(g => (
              <div
                key={g.name}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 8px', background: 'var(--t-subtle)', marginBottom: '4px' }}
              >
                <span className="setting-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {g.name}
                  <span className="setting-desc" style={{ marginTop: 0 }}>
                    {' · '}
                    {[g.calendar && 'calendar', g.todos && 'to-dos & habits'].filter(Boolean).join(', ')}
                  </span>
                </span>
                <label className="setting-desc" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 0 }}>
                  <Switch
                    checked={!hiddenOwners.includes(g.name)}
                    onCheckedChange={() => toggleOwnerHidden(g.name)}
                  />
                  Show
                </label>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => void refreshIncoming()}
          disabled={state.kind === 'busy'}
          className="button-small"
          style={{ marginTop: '12px' }}
        >
          Refresh
        </button>
      </div>

      {state.kind === 'busy' && <p className="setting-desc" style={{ marginTop: '12px' }}>{state.what}</p>}
      {state.kind === 'error' && (
        <p style={{ fontSize: '12px', color: 'var(--t-danger)', marginTop: '12px' }}>{state.message}</p>
      )}
    </Card>
  );
}

/* ── Wyze scale ──────────────────────────────────────────────────────────*/

/** Mirrors the `WyzeStatus` struct returned by the `wyze_status` command. */
interface WyzeStatus {
  connected: boolean;
  email: string | null;
  lastSync: string | null;
}

function WyzeCard() {
  const { importWeights } = useApp();
  const [status, setStatus] = useState<WyzeStatus | null>(null);
  const [state, setState] = useState<SyncState>({ kind: 'idle' });
  const [form, setForm] = useState({ email: '', password: '', keyId: '', apiKey: '' });

  const available = inTauri();

  useEffect(() => {
    if (!available) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        setStatus(await invoke<WyzeStatus>('wyze_status'));
      } catch {
        // backend not ready — the card still renders in its disconnected state
      }
    })();
  }, [available]);

  async function sync() {
    setState({ kind: 'busy', what: 'Syncing…' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const count = await invoke<number>('wyze_sync', { days: 90 });
      // Rust wrote straight to SQLite, so pull the rows back into React state.
      const data = await invoke<{ weights: WeightEntry[] }>('load_state');
      importWeights(data.weights.filter(w => w.source === 'wyze'));
      setStatus(await invoke<WyzeStatus>('wyze_status'));
      setState({
        kind: 'ok',
        message: count === 0 ? 'No readings in the last 90 days.' : `Synced ${count} reading${count === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  }

  async function connect() {
    setState({ kind: 'busy', what: 'Saving…' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('wyze_save_credentials', {
        email: form.email.trim(),
        password: form.password,
        keyId: form.keyId.trim(),
        apiKey: form.apiKey.trim(),
      });
      setForm({ email: '', password: '', keyId: '', apiKey: '' });
      setStatus(await invoke<WyzeStatus>('wyze_status'));
      setState({ kind: 'idle' });
      await sync();
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  }

  async function disconnect() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('wyze_clear_credentials');
      setStatus(await invoke<WyzeStatus>('wyze_status'));
      setState({ kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  }

  const canConnect =
    form.email.trim() !== '' && form.password !== '' &&
    form.keyId.trim() !== '' && form.apiKey.trim() !== '';

  const field = (label: string, key: keyof typeof form, type = 'text') => (
    <div>
      <div className="setting-label" style={{ marginBottom: '4px' }}>{label}</div>
      <input
        className="input-text"
        style={{ width: '100%' }}
        type={type}
        autoComplete="off"
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <Card title="Wyze scale">
      <p className="setting-desc" style={{ marginBottom: '16px' }}>
        Pulls your weight and body-fat readings in. Wyze has no public API, so this signs
        in as the phone app does — it needs an API Key alongside your login, which doubles
        as the second factor.
      </p>

      {!available ? (
        <p className="setting-desc">Wyze sync needs the desktop or Android app.</p>
      ) : status?.connected ? (
        <>
          <p className="setting-label" style={{ marginBottom: '12px' }}>
            Connected as {status.email}
            {status.lastSync && (
              <span className="setting-desc" style={{ marginTop: 0 }}>
                {' · last synced '}
                {new Date(Number(status.lastSync)).toLocaleString()}
              </span>
            )}
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => void sync()} disabled={state.kind === 'busy'} className="button-primary">
              Sync now
            </button>
            <button onClick={() => void disconnect()} className="button-small">
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
            {field('Email', 'email', 'email')}
            {field('Password', 'password', 'password')}
            {field('Key ID', 'keyId')}
            {field('API Key', 'apiKey')}
          </div>
          <p className="setting-desc" style={{ marginTop: '12px' }}>
            Generate a Key ID and API Key at developer-api-console.wyze.com → Create API Key.
            Credentials are stored in your OS keyring on desktop; on Android they live in the
            app's private database, which is sandboxed but not encrypted.
          </p>
          <button
            onClick={() => void connect()}
            disabled={!canConnect || state.kind === 'busy'}
            className="button-primary"
            style={{ marginTop: '16px' }}
          >
            Connect
          </button>
        </>
      )}

      {state.kind === 'busy' && <p className="setting-desc" style={{ marginTop: '12px' }}>{state.what}</p>}
      {state.kind === 'ok' && <p style={{ fontSize: '12px', color: 'var(--t-success)', marginTop: '12px' }}>{state.message}</p>}
      {state.kind === 'error' && <p style={{ fontSize: '12px', color: 'var(--t-danger)', marginTop: '12px' }}>{state.message}</p>}
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

function Card({
  title,
  span = false,
  children,
}: {
  title: string;
  span?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`settings-card${span ? ' span-2' : ''}`}>
      <h3 className="card-title">{title}</h3>
      {children}
    </div>
  );
}

function SettingItem({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
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
