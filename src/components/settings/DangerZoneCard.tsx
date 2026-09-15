import { errorMessage } from '@/lib/utils';
import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import * as ipc from '../../ipc';
import { FormMessage } from '../ui/field';
import { Card } from './shared';

interface WipeSpec {
  /** Button label; also, lower-cased, the phrase the user has to type. */
  label: string;
  what: string;
  run: () => void;
}

/**
 * Settings' last card: everything here is irreversible and syncs. The three
 * wipes are gated GitHub-style — the exact phrase has to be typed before the
 * button enables — because a single "are you sure?" is answered on reflex.
 * Deleting the account keeps its password gate (the server needs it anyway)
 * and only shows while signed in.
 */
export function DangerZoneCard({ onAccountDeleted }: { onAccountDeleted: () => Promise<void> }) {
  const { deleteAllEvents, deleteAllTodos, signedIn, syncToken } = useApp();

  const wipes: WipeSpec[] = [
    { label: 'Delete all events', what: 'every event on your calendar', run: deleteAllEvents },
    { label: 'Delete all tasks', what: 'every one-time to-do, done or not', run: () => deleteAllTodos('task') },
    {
      label: 'Delete all habits',
      what: 'every habit along with its whole completion history',
      run: () => deleteAllTodos('habit'),
    },
  ];

  return (
    <Card title="Danger zone" span>
      <p className="setting-desc mb-4">
        These cannot be undone. If you're signed in, the deletion syncs to your other devices too; shared calendars from
        other people are never touched.
      </p>
      <div className="flex flex-col gap-5">
        {wipes.map((w) => (
          <WipeRow key={w.label} spec={w} />
        ))}
        {signedIn && (
          <div className="pt-5 border-t border-line">
            <DeleteAccount enabled={!!syncToken} onDeleted={onAccountDeleted} />
          </div>
        )}
      </div>
    </Card>
  );
}

function WipeRow({ spec }: { spec: WipeSpec }) {
  const [expanded, setExpanded] = useState(false);
  const [typed, setTyped] = useState('');
  const phrase = spec.label.toLowerCase();
  const armed = typed.trim().toLowerCase() === phrase;

  function cancel() {
    setExpanded(false);
    setTyped('');
  }

  function confirm() {
    if (!armed) return;
    spec.run();
    cancel();
  }

  if (!expanded) {
    return (
      <div>
        <button className="button-small button-danger" onClick={() => setExpanded(true)}>
          {spec.label}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[25rem]">
      <p className="setting-desc mb-2">
        This removes {spec.what} from this device and, if signed in, from your account. Type{' '}
        <code className="select-all text-ink">{phrase}</code> to confirm.
      </p>
      <input
        type="text"
        className="field-input max-w-[15rem] block mb-2"
        autoComplete="off"
        spellCheck={false}
        placeholder={phrase}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirm();
          if (e.key === 'Escape') cancel();
        }}
      />
      <div className="flex gap-2">
        <button className="button-small button-danger" onClick={confirm} disabled={!armed}>
          {spec.label}
        </button>
        <button className="button-small" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Permanently deletes the signed-in account server-side. Deliberately no
 * `window.confirm` — the password field itself, disabled until non-empty, is
 * the confirmation gate.
 */
function DeleteAccount({ enabled, onDeleted }: { enabled: boolean; onDeleted: () => Promise<void> }) {
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
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!expanded) {
    return (
      <div>
        <button className="button-small button-danger" onClick={() => setExpanded(true)} disabled={!enabled}>
          Delete account
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[25rem]">
      <p className="setting-desc mb-2">
        This permanently deletes your account and everything synced to it - events, tasks, habits, shares, and every
        sign-in method - from the server. Local data on this device stays until you reset the app, but will no longer
        sync anywhere. This cannot be undone.
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
  );
}
