/**
 * Passkeys as a sign-in method.
 *
 * `load` asks the server what is *really* attached (`GET /passkeys`) rather
 * than inferring it from local state — a device holds a token, not a list of
 * credentials, and a passkey added on another device must still show up here.
 *
 * Adding a passkey is no longer an in-app ceremony: `tauri-plugin-webauthn`
 * is gone, so the action just sends the user to the browser sign-in portal,
 * where passkeys, password and TOTP all live now. This method is otherwise
 * informational — it lists what's attached, it doesn't drive attaching one.
 */
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

/** The portal that serves `/login`, mirroring `portal_base()` in
 *  `account.rs`: the API base with its `/api` prefix (stripped by nginx
 *  before proxying) dropped.
 *
 *  Derived from `ctx.server` rather than `DEFAULT_SYNC_URL` so a self-hoster
 *  is sent to their own portal, not the hosted one. */
function portalUrl(server: string): string {
  return server.replace(/\/api\/?$/, '');
}

async function openPortal(server: string) {
  const url = portalUrl(server);
  if (inTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

function AddPasskey({ ctx }: { ctx: AuthMethodContext }) {
  return (
    <div>
      <button className="button-primary" disabled={!ctx.token} onClick={() => void openPortal(ctx.server)}>
        Manage in browser
      </button>
      <p className="setting-desc">Passkeys are added and removed from the browser sign-in page.</p>
    </div>
  );
}

registerAuthMethod({ id: 'passkey', order: 10, load, Action: AddPasskey });
