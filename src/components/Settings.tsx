import { useEffect, useRef, useState } from 'react';
import { KeyRound, UserPlus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { inTauri } from '../persistence';
import { parseIcs } from '../ics';
import { inputClass, labelClass } from './forms/shared';
import { Switch } from './ui/switch';
import { usePasskeyAuth } from './auth/usePasskeyAuth';
import PinDialog from './auth/PinDialog';
import { DEFAULT_SYNC_URL, syncEndpoint } from '../syncServer';
import type { FirstDayOfWeek, ShareGrant, ThemeName, WeightEntry, WeightUnit } from '../types';

const PRIMARY_BTN =
  'px-md py-xs bg-primary text-on-primary rounded-lg font-semibold text-body-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none';
const GHOST_BTN =
  'px-md py-xs rounded-lg font-semibold text-body-sm text-txt-muted border border-line hover:bg-fill-strong transition-colors';

/** Mirrors the `WyzeStatus` struct returned by the `wyze_status` command. */
interface WyzeStatus {
  connected: boolean;
  email: string | null;
  lastSync: string | null;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; imported: number; skipped: number }
  | { kind: 'error'; message: string };

/** Swatch preview colours mirror each theme's chrome/sheet/accent from App.css. */
const THEME_OPTIONS: { value: ThemeName; label: string; swatch: [string, string, string] }[] = [
  { value: 'dark', label: 'Dark', swatch: ['#0a121e', '#0f2440', '#004ac6'] },
  { value: 'light', label: 'Light', swatch: ['#ffffff', '#eef1f6', '#1d4ed8'] },
  { value: 'grey-high', label: 'Grey · high contrast', swatch: ['#000000', '#141414', '#2563eb'] },
  { value: 'grey-low', label: 'Grey · low contrast', swatch: ['#23262a', '#33373d', '#3f6fd8'] },
];

export default function Settings() {
  const { importEvents, theme, weightUnit, firstDayOfWeek, setSetting } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  function runImport(text: string) {
    const { events, skipped } = parseIcs(text);
    if (events.length === 0) {
      setStatus({ kind: 'error', message: 'No events found — is that an iCalendar (.ics) file?' });
      return;
    }
    importEvents(events);
    setStatus({ kind: 'done', imported: events.length, skipped });
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setStatus({ kind: 'busy' });
    try {
      runImport(await file.text());
    } catch (err) {
      setStatus({ kind: 'error', message: `Couldn't read file: ${err}` });
    }
    if (fileRef.current) fileRef.current.value = ''; // allow re-picking the same file
  }

  async function handleUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setStatus({ kind: 'busy' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      runImport(await invoke<string>('fetch_ics', { url: trimmed }));
    } catch (err) {
      setStatus({ kind: 'error', message: `Fetch failed: ${err}` });
    }
  }

  return (
    <div className="h-full overflow-auto scrollbar-hide">
      <h3 className="text-label-md text-txt-muted mb-md uppercase tracking-wider">Settings</h3>

      {/* Two columns from `lg` up. The cards are independent of one another, so
          stacking them in one 34rem strip left most of a desktop window empty
          and pushed Wyze below the fold. `items-start` keeps each card at its
          own content height instead of stretching it to match its neighbour. */}
      <div className="grid gap-md items-start grid-cols-1 lg:grid-cols-2 max-w-[72rem] pb-lg">
        <div className="p-md rounded-xl bg-fill">
          <h4 className="text-body-md font-semibold text-txt mb-xs">Appearance</h4>
          <p className="text-body-sm text-txt-muted mb-md">
            Applies immediately and is remembered across launches.
          </p>
          <div className="grid grid-cols-2 gap-sm">
            {THEME_OPTIONS.map(({ value, label, swatch }) => (
              <button
                key={value}
                onClick={() => setSetting('theme', value)}
                className={`flex items-center gap-sm p-sm rounded-lg border transition-all text-left ${
                  theme === value
                    ? 'border-primary bg-fill-strong'
                    : 'border-line hover:bg-fill-strong'
                }`}
              >
                <span className="flex-shrink-0 flex rounded overflow-hidden border border-line">
                  {swatch.map(c => (
                    <span key={c} className="w-3 h-6 block" style={{ backgroundColor: c }} />
                  ))}
                </span>
                <span className="text-body-sm text-txt">{label}</span>
              </button>
            ))}
          </div>

          <label className={`${labelClass} mt-md block`}>Weight unit</label>
          <div className="flex gap-xs bg-fill-strong p-xs rounded-lg w-fit">
            {(['lb', 'kg'] as WeightUnit[]).map(u => (
              <button
                key={u}
                onClick={() => setSetting('weightUnit', u)}
                className={`px-md py-xs rounded text-label-md font-semibold transition-colors ${
                  weightUnit === u ? 'bg-primary text-on-primary' : 'text-txt-muted hover:text-txt'
                }`}
              >
                {u}
              </button>
            ))}
          </div>

          <label className={`${labelClass} mt-md block`}>Week starts on</label>
          <div className="flex gap-xs bg-fill-strong p-xs rounded-lg w-fit">
            {([[1, 'Monday'], [0, 'Sunday']] as [FirstDayOfWeek, string][]).map(([day, label]) => (
              <button
                key={day}
                onClick={() => setSetting('firstDayOfWeek', String(day))}
                className={`px-md py-xs rounded text-label-md font-semibold transition-colors ${
                  firstDayOfWeek === day ? 'bg-primary text-on-primary' : 'text-txt-muted hover:text-txt'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-txt-muted mt-xs">
            Changes the calendar and the weekly strips. A “N times per week” to-do
            counts its completions inside this week, so its progress can shift.
          </p>
        </div>

        <div className="p-md rounded-xl bg-fill">
          <h4 className="text-body-md font-semibold text-txt mb-xs">
            Import from Google Calendar
          </h4>
          <p className="text-body-sm text-txt-muted mb-md">
            Imported entries become regular Albas events (matched by ID, so importing
            again updates instead of duplicating). Two ways to get your data:
          </p>

          <div className="space-y-md">
            <div>
              <label className={labelClass}>From an exported file</label>
              <p className="text-[11px] text-txt-muted mb-xs">
                Google Calendar → gear icon → Settings → Import &amp; export → Export,
                then unzip and pick the .ics file for a calendar.
              </p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-md py-xs bg-primary text-on-primary rounded-lg font-semibold text-body-sm hover:bg-primary/90 active:scale-95 transition-all"
              >
                Choose .ics file…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".ics,text/calendar"
                className="hidden"
                onChange={e => handleFile(e.target.files?.[0])}
              />
            </div>

            <div>
              <label className={labelClass}>From a calendar URL</label>
              <p className="text-[11px] text-txt-muted mb-xs">
                Google Calendar → Settings → your calendar → Integrate calendar →
                "Secret address in iCal format". Keep this URL private.
              </p>
              <div className="flex gap-sm">
                <input
                  className={inputClass}
                  placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  disabled={!inTauri()}
                />
                <button
                  type="button"
                  onClick={handleUrl}
                  disabled={!inTauri() || status.kind === 'busy'}
                  className="px-md py-xs bg-primary text-on-primary rounded-lg font-semibold text-body-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none flex-shrink-0"
                >
                  Import
                </button>
              </div>
              {!inTauri() && (
                <p className="text-[11px] text-txt-muted mt-xs">
                  URL import needs the desktop app — use the file import in the browser.
                </p>
              )}
            </div>
          </div>

          {status.kind === 'busy' && (
            <p className="text-body-sm text-txt-muted mt-md">Importing…</p>
          )}
          {status.kind === 'done' && (
            <p className="text-body-sm text-success mt-md">
              Imported {status.imported} event{status.imported === 1 ? '' : 's'}
              {status.skipped > 0 ? ` (${status.skipped} skipped)` : ''}.
            </p>
          )}
          {status.kind === 'error' && (
            <p className="text-body-sm text-danger mt-md">{status.message}</p>
          )}
        </div>

        <AccountCard />

        <SharingCard />

        <WyzeCard />

        <AboutCard />
      </div>
    </div>
  );
}

/** Mirrors the `SyncStatus` struct returned by the `sync_status` command. */
interface SyncStatusInfo {
  configured: boolean;
  url: string | null;
  account: string | null;
  lastSync: string | null;
}

/** Mirrors `SyncOutcome` from `sync_now`. */
interface SyncOutcome {
  pushed: number;
  pulled: number;
  skipped: number;
  sharedChanged: boolean;
  lastSync: string | null;
}

type SyncState =
  | { kind: 'idle' }
  | { kind: 'busy'; what: string }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

/**
 * Account + sync. Signing in is a passkey ceremony against the server, which
 * mints a token for this device; the older "paste a token" path is kept behind
 * a disclosure for token-only accounts and for servers without passkeys
 * configured.
 */
function AccountCard() {
  const { setSetting, reloadFromStore } = useApp();
  const auth = usePasskeyAuth();
  const [status, setStatus] = useState<SyncStatusInfo | null>(null);
  const [state, setState] = useState<SyncState>({ kind: 'idle' });
  const [form, setForm] = useState({ url: DEFAULT_SYNC_URL, token: '' });
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [manual, setManual] = useState(false);

  const available = inTauri();
  const busy = state.kind === 'busy' || auth.state.kind === 'busy';

  async function refreshStatus() {
    const { invoke } = await import('@tauri-apps/api/core');
    setStatus(await invoke<SyncStatusInfo>('sync_status'));
  }

  useEffect(() => {
    if (!available) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const s = await invoke<SyncStatusInfo>('sync_status');
        setStatus(s);
        setForm(f => ({ ...f, url: s.url ?? DEFAULT_SYNC_URL }));
      } catch {
        // backend not ready — the card still renders in its unconfigured state
      }
    })();
    // A finished ceremony wrote credentials from Rust; pick them up here too.
  }, [available, auth.state.kind]);

  async function connectManually() {
    setState({ kind: 'busy', what: 'Saving…' });
    try {
      // Written through setSetting so React state and SQLite agree. The `__`
      // prefix keeps both keys out of the synced payload — the token must
      // never be uploaded to the server it authenticates against.
      setSetting('__sync_url', syncEndpoint(form.url));
      setSetting('__sync_token', form.token.trim());
      setSetting('__sync_account', '');
      setSetting('__welcome_done', '1');
      await refreshStatus();
      setState({ kind: 'idle' });
      await sync();
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  }

  async function sync() {
    setState({ kind: 'busy', what: 'Syncing…' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const out = await invoke<SyncOutcome>('sync_now');
      // Rust merged straight into SQLite, so pull the rows back into React.
      if (out.pulled > 0 || out.sharedChanged) await reloadFromStore();
      await refreshStatus();
      const parts = [`sent ${out.pushed}`, `received ${out.pulled}`];
      if (out.skipped > 0) parts.push(`${out.skipped} skipped`);
      setState({
        kind: out.skipped > 0 ? 'error' : 'ok',
        message:
          out.skipped > 0
            ? `Synced (${parts.join(', ')}). Skipped rows come from a newer version of Albas — update this device.`
            : `Synced — ${parts.join(', ')}.`,
      });
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  }

  async function signOut() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('sync_sign_out');
      await reloadFromStore();
      await refreshStatus();
      setForm({ url: form.url, token: '' });
      setState({ kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  }

  return (
    <div className="p-md rounded-xl bg-fill">
      <h4 className="text-body-md font-semibold text-txt mb-xs">Account &amp; sync</h4>
      <p className="text-body-sm text-txt-muted mb-md">
        Keeps your to-dos, events and weights in step across devices via your own
        server. Albas stays fully offline-capable — edits are made locally and
        reconciled on the next sync, with the most recent edit winning.
      </p>

      {!available ? (
        <p className="text-[11px] text-txt-muted">Sync needs the desktop or Android app.</p>
      ) : status?.configured ? (
        <>
          <p className="text-body-sm text-txt mb-md">
            {status.account
              ? <>Signed in as <span className="font-semibold">{status.account}</span></>
              : <>Connected with a sync token</>}
            <span className="text-txt-muted"> · {status.url}</span>
            {status.lastSync && (
              <span className="text-txt-muted">
                {' · last synced '}
                {new Date(Number(status.lastSync)).toLocaleString()}
              </span>
            )}
          </p>
          <div className="flex gap-sm">
            <button onClick={sync} disabled={busy} className={PRIMARY_BTN}>
              Sync now
            </button>
            <button onClick={signOut} className={GHOST_BTN}>
              Sign out
            </button>
          </div>
          <p className="text-[11px] text-txt-muted mt-sm">
            Signing out clears this device's credentials and anything shared with you.
            Your own data stays on this device.
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-sm">
            <div>
              <label className={labelClass}>Server</label>
              <input
                className={inputClass}
                autoComplete="off"
                placeholder={DEFAULT_SYNC_URL}
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                disabled={busy}
              />
            </div>

            {mode === 'create' && (
              <>
                <div>
                  <label className={labelClass}>Account name</label>
                  <input
                    className={inputClass}
                    autoComplete="off"
                    placeholder="letters, digits, - or _"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className={labelClass}>Invite code (only if the server requires one)</label>
                  <input
                    className={inputClass}
                    autoComplete="off"
                    value={invite}
                    onChange={e => setInvite(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </>
            )}

            <div className="flex gap-sm">
              {mode === 'signin' ? (
                <>
                  <button
                    onClick={() => auth.signIn(form.url)}
                    disabled={busy || form.url.trim() === ''}
                    className={`${PRIMARY_BTN} flex items-center gap-xs`}
                  >
                    <KeyRound size={14} /> Sign in with passkey
                  </button>
                  <button onClick={() => setMode('create')} disabled={busy} className={`${GHOST_BTN} flex items-center gap-xs`}>
                    <UserPlus size={14} /> Create account
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => auth.createAccount(form.url, name.trim(), invite.trim() || null)}
                    disabled={busy || form.url.trim() === '' || name.trim() === ''}
                    className={PRIMARY_BTN}
                  >
                    Create account
                  </button>
                  <button onClick={() => setMode('signin')} disabled={busy} className={GHOST_BTN}>
                    Back
                  </button>
                </>
              )}
            </div>
          </div>

          <button
            onClick={() => setManual(m => !m)}
            className="text-[11px] text-txt-muted hover:text-txt transition-colors mt-md"
          >
            {manual ? '▾' : '▸'} Advanced: connect with a sync token
          </button>
          {manual && (
            <div className="mt-sm">
              <label className={labelClass}>Sync token</label>
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                value={form.token}
                onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
              />
              <p className="text-[11px] text-txt-muted mt-xs">
                For accounts minted with <code>/accounts</code>, or a server without passkeys
                configured. The server field may be the base URL or the <code>/sync</code>{' '}
                endpoint. Only https:// is accepted (http:// works for localhost while testing),
                since the token is the only credential.
              </p>
              <button
                onClick={connectManually}
                disabled={busy || form.url.trim() === '' || form.token.trim() === ''}
                className={`${PRIMARY_BTN} mt-sm`}
              >
                Connect
              </button>
            </div>
          )}
        </>
      )}

      {auth.state.kind === 'busy' && <p className="text-body-sm text-txt-muted mt-md">{auth.state.what}</p>}
      {auth.state.kind === 'error' && <p className="text-body-sm text-danger mt-md">{auth.state.message}</p>}
      {state.kind === 'busy' && <p className="text-body-sm text-txt-muted mt-md">{state.what}</p>}
      {state.kind === 'ok' && <p className="text-body-sm text-success mt-md">{state.message}</p>}
      {state.kind === 'error' && <p className="text-body-sm text-danger mt-md">{state.message}</p>}

      {auth.pin && (
        <PinDialog
          attemptsRemaining={auth.pin.attemptsRemaining}
          onSubmit={auth.submitPin}
          onCancel={auth.cancelPin}
        />
      )}
    </div>
  );
}

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
    <div className="p-md rounded-xl bg-fill">
      <h4 className="text-body-md font-semibold text-txt mb-xs">Sharing</h4>
      <p className="text-body-sm text-txt-muted mb-md">
        Let another account on this server see your calendar or your to-dos and habits.
        Sharing is <span className="font-semibold">read-only</span> — they can't edit or
        check anything off. Weight data is never shared.
      </p>

      <label className={labelClass}>You share with</label>
      {shares?.outgoing.length === 0 && (
        <p className="text-[11px] text-txt-muted mb-sm">Nobody yet.</p>
      )}
      <div className="space-y-xs mb-md">
        {shares?.outgoing.map(g => (
          <div key={g.name} className="flex items-center gap-sm p-xs rounded-lg bg-fill-strong">
            <span className="text-body-sm text-txt flex-1 min-w-0 truncate">{g.name}</span>
            <label className="flex items-center gap-xs text-[11px] text-txt-muted">
              <Switch
                checked={g.calendar}
                onCheckedChange={v => setShare(g.name, v, g.todos)}
              />
              Calendar
            </label>
            <label className="flex items-center gap-xs text-[11px] text-txt-muted">
              <Switch
                checked={g.todos}
                onCheckedChange={v => setShare(g.name, g.calendar, v)}
              />
              To-dos &amp; habits
            </label>
          </div>
        ))}
      </div>

      <label className={labelClass}>Share with someone</label>
      <div className="flex gap-sm">
        <input
          className={inputClass}
          autoComplete="off"
          placeholder="their account name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addShare(); }}
        />
        <button
          onClick={addShare}
          disabled={state.kind === 'busy' || newName.trim() === ''}
          className={`${PRIMARY_BTN} flex-shrink-0`}
        >
          Share
        </button>
      </div>
      <p className="text-[11px] text-txt-muted mt-xs">
        Starts with the calendar shared; switch either category off any time. Turning both
        off removes the share entirely.
      </p>

      <div className="mt-md pt-md border-t border-line">
        <label className={labelClass}>Shared with you</label>
        {shares?.incoming.length === 0 ? (
          <p className="text-[11px] text-txt-muted">
            Nothing yet. Ask them to share with your account name in their Settings.
          </p>
        ) : (
          <div className="space-y-xs">
            {shares?.incoming.map(g => (
              <div key={g.name} className="flex items-center gap-sm p-xs rounded-lg bg-fill-strong">
                <span className="text-body-sm text-txt flex-1 min-w-0 truncate">
                  {g.name}
                  <span className="text-[11px] text-txt-muted">
                    {' · '}
                    {[g.calendar && 'calendar', g.todos && 'to-dos & habits']
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </span>
                <label className="flex items-center gap-xs text-[11px] text-txt-muted">
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
        <button onClick={refreshIncoming} disabled={state.kind === 'busy'} className={`${GHOST_BTN} mt-sm`}>
          Refresh
        </button>
      </div>

      {state.kind === 'busy' && <p className="text-body-sm text-txt-muted mt-md">{state.what}</p>}
      {state.kind === 'error' && <p className="text-body-sm text-danger mt-md">{state.message}</p>}
    </div>
  );
}

type WyzeState =
  | { kind: 'idle' }
  | { kind: 'busy'; what: string }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

function WyzeCard() {
  const { importWeights } = useApp();
  const [status, setStatus] = useState<WyzeStatus | null>(null);
  const [state, setState] = useState<WyzeState>({ kind: 'idle' });
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

  return (
    <div className="p-md rounded-xl bg-fill">
      <h4 className="text-body-md font-semibold text-txt mb-xs">Wyze Scale</h4>
      <p className="text-body-sm text-txt-muted mb-md">
        Pulls your weight and body-fat readings into the Weight view. Wyze has no public
        API, so this signs in as the phone app does — it needs an API Key alongside your
        login, which doubles as the second factor.
      </p>

      {!available ? (
        <p className="text-[11px] text-txt-muted">
          Wyze sync needs the desktop or Android app.
        </p>
      ) : status?.connected ? (
        <>
          <p className="text-body-sm text-txt mb-md">
            Connected as <span className="font-semibold">{status.email}</span>
            {status.lastSync && (
              <span className="text-txt-muted">
                {' · last synced '}
                {new Date(Number(status.lastSync)).toLocaleString()}
              </span>
            )}
          </p>
          <div className="flex gap-sm">
            <button
              onClick={sync}
              disabled={state.kind === 'busy'}
              className="px-md py-xs bg-primary text-on-primary rounded-lg font-semibold text-body-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              Sync now
            </button>
            <button
              onClick={disconnect}
              className="px-md py-xs rounded-lg font-semibold text-body-sm text-txt-muted border border-line hover:bg-fill-strong transition-colors"
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-sm">
            <div>
              <label className={labelClass}>Email</label>
              <input
                className={inputClass}
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelClass}>Password</label>
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelClass}>Key ID</label>
              <input
                className={inputClass}
                autoComplete="off"
                value={form.keyId}
                onChange={e => setForm(f => ({ ...f, keyId: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelClass}>API Key</label>
              <input
                className={inputClass}
                autoComplete="off"
                value={form.apiKey}
                onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-[11px] text-txt-muted mt-sm">
            Generate a Key ID and API Key at developer-api-console.wyze.com → Create API Key.
            Credentials are stored in your OS keyring on desktop; on Android they live in the
            app's private database, which is sandboxed but not encrypted.
          </p>
          <button
            onClick={connect}
            disabled={!canConnect || state.kind === 'busy'}
            className="mt-md px-md py-xs bg-primary text-on-primary rounded-lg font-semibold text-body-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            Connect
          </button>
        </>
      )}

      {state.kind === 'busy' && <p className="text-body-sm text-txt-muted mt-md">{state.what}</p>}
      {state.kind === 'ok' && <p className="text-body-sm text-success mt-md">{state.message}</p>}
      {state.kind === 'error' && <p className="text-body-sm text-danger mt-md">{state.message}</p>}
    </div>
  );
}

/**
 * The one place the running version is visible. `__APP_VERSION__` is injected
 * by Vite from package.json (see `define` in vite.config.ts), which is the
 * single source every other version file is derived from — so if this number
 * is right, the bundle, the installer and the APK all agree.
 *
 * Deliberately does *not* repeat the server URL: Account & sync above owns
 * that, and showing it twice invites the two displays to disagree.
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
    <div className="p-md rounded-xl bg-fill">
      <h4 className="text-body-md font-semibold text-txt mb-xs">About</h4>
      <p className="text-body-sm text-txt-muted">
        Albas <span className="font-semibold text-txt">v{__APP_VERSION__}</span>
        <span> · {platform}</span>
      </p>
    </div>
  );
}
