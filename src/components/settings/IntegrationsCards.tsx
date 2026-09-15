import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { inTauri } from '../../persistence';
import { parseIcs } from '../../ics';
import * as ipc from '../../ipc';
import type { SharesRes } from '../../ipc';
import { Switch } from '../ui/switch';
import { AsyncMessage, Card, ROW_INSET, useAsyncState } from './shared';

/* ── Calendar import ─────────────────────────────────────────────────────*/

export function ImportCard() {
  const { importEvents } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const { state, run, busy } = useAsyncState();

  /** Parses and imports; the success line, or a thrown error for the message. */
  function runImport(text: string): string {
    const { events, skipped } = parseIcs(text);
    if (events.length === 0) throw new Error('No events found — is that an iCalendar (.ics) file?');
    importEvents(events);
    return `Imported ${events.length} event${events.length === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} skipped)` : ''}.`;
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    await run('Importing…', async () => runImport(await file.text()));
    if (fileRef.current) fileRef.current.value = ''; // allow re-picking the same file
  }

  function handleUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    void run('Importing…', async () => runImport(await ipc.fetchIcs(trimmed)));
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
          <button type="button" onClick={handleUrl} disabled={!inTauri() || busy} className="button-primary shrink-0">
            Import
          </button>
        </div>
        {!inTauri() && (
          <p className="setting-desc mt-2">URL import needs the desktop app — use the file import in the browser.</p>
        )}
      </div>

      <AsyncMessage state={state} />
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
export function SharingCard() {
  const { signedIn, hiddenOwners, toggleOwnerHidden, syncNow } = useApp();
  const [shares, setShares] = useState<SharesRes | null>(null);
  const { state, run, busy } = useAsyncState();
  const [newName, setNewName] = useState('');

  const available = inTauri() && signedIn;

  async function load() {
    setShares(await ipc.sharesList());
  }

  useEffect(() => {
    if (!available) return;
    void run('', load);
  }, [available, run]);

  async function setShare(name: string, calendar: boolean, todos: boolean) {
    await run('Saving…', async () => {
      await ipc.sharesSet(name, calendar, todos);
      await load();
    });
  }

  async function addShare() {
    const name = newName.trim();
    if (!name) return;
    await setShare(name, true, false);
    setNewName('');
  }

  /** Their next sync is what actually moves data; ours only re-reads grants. */
  function refreshIncoming() {
    void run('Syncing…', async () => {
      await syncNow();
      await load();
    });
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
          disabled={busy || newName.trim() === ''}
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
        <button onClick={refreshIncoming} disabled={busy} className="button-small mt-3">
          Refresh
        </button>
      </div>

      <AsyncMessage state={state} />
    </Card>
  );
}
