/**
 * Passkeys as a sign-in method.
 *
 * `load` asks the server what is *really* attached (`GET /passkeys`) rather
 * than inferring it from local state — a device holds a token, not a list of
 * credentials, and a passkey added on another device must still show up here.
 *
 * The action is a second door onto the same account: `POST /passkeys/{start,
 * finish}` authenticate with the bearer token this device already has, so
 * adding a key needs no admin-minted invite. It does need the OS authenticator,
 * which only exists inside Tauri — in the browser dev server the rows still
 * load but the button says why it cannot run.
 */
import { useState } from 'react';
import PinDialog from '../components/auth/PinDialog';
import { usePasskeyAuth } from '../components/auth/usePasskeyAuth';
import { inTauri } from '../persistence';
import { registerAuthMethod, type AuthMethodContext, type AuthMethodRow } from './registry';

/** What `GET /passkeys` returns. The server stores no device name, so `label`
 *  is derived from the credential id — see the handler's comment. */
interface PasskeyInfo {
  credId: string;
  label: string;
  createdAt: number;
}

function added(ms: number): string | undefined {
  if (!ms) return undefined;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return `added ${d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

async function load(ctx: AuthMethodContext): Promise<AuthMethodRow[]> {
  if (!ctx.token) return [];
  const res = await fetch(`${ctx.server}/passkeys`, {
    headers: { Authorization: `Bearer ${ctx.token}` },
  });
  if (!res.ok) {
    const message = (await res.text().catch(() => '')).trim();
    throw new Error(message || `Couldn't list passkeys (HTTP ${res.status}).`);
  }
  const list = (await res.json()) as PasskeyInfo[];
  return list.map(p => ({
    key: p.credId,
    name: p.label,
    type: 'Passkey' as const,
    detail: added(p.createdAt),
  }));
}

function AddPasskey({ ctx }: { ctx: AuthMethodContext }) {
  const auth = usePasskeyAuth();
  const [done, setDone] = useState(false);
  const tauri = inTauri();
  const busy = auth.state.kind === 'busy' ? auth.state.what : null;

  async function add() {
    setDone(false);
    // The hook reports failure through its own state rather than throwing, so
    // the boolean is what says whether a credential actually landed.
    if (!(await auth.addPasskey())) return;
    setDone(true);
    ctx.refresh();
  }

  // `done` gates on our own call finishing; the hook's state may still read
  // 'done' from an earlier sign-in on the same screen.
  const message =
    auth.state.kind === 'error'
      ? auth.state.message
      : (busy ??
        (done
          ? 'Passkey added.'
          : !tauri
            ? 'Passkeys need the Albas app — the browser dev server has no authenticator.'
            : null));

  return (
    <>
      <div>
        <button
          className="button-primary"
          disabled={!tauri || !ctx.token || busy !== null}
          onClick={() => void add()}
        >
          Add a passkey
        </button>
        {message && <p className="setting-desc">{message}</p>}
      </div>
      {auth.pin && (
        <PinDialog
          attemptsRemaining={auth.pin.attemptsRemaining}
          onSubmit={auth.submitPin}
          onCancel={auth.cancelPin}
        />
      )}
    </>
  );
}

registerAuthMethod({ id: 'passkey', order: 10, load, Action: AddPasskey });
