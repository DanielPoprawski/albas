import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { inTauri } from '../persistence';
import { parseIcs } from '../ics';
import { inputClass, labelClass } from './forms/shared';
import type { FirstDayOfWeek, ThemeName, WeightEntry, WeightUnit } from '../types';

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

      <div className="max-w-[34rem] space-y-md">
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

        <WyzeCard />
      </div>
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
