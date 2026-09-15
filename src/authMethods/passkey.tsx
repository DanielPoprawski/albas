/**
 * Passkeys as a sign-in method.
 *
 * `load` asks the server what is *really* attached (`GET /passkeys`) rather
 * than inferring it from local state — a device holds a token, not a list of
 * credentials, and a passkey added on another device must still show up here.
 *
 * Adding a passkey is no longer an in-app ceremony: `tauri-plugin-webauthn`
 * is gone, so the action just sends the user to the browser sign-in portal.
 * They sign in there with their password (the mandatory first credential)
 * and the signed-in page offers "Add a passkey". This method is otherwise
 * informational — it lists what's attached, it doesn't drive attaching one.
 */
import { inTauri } from '../persistence';
import { apiError, apiRequest, portalUrl } from '../syncServer';
import type { AuthMethod, AuthMethodContext, AuthMethodRow } from './registry';

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
  const res = await apiRequest('GET', '/passkeys', undefined, ctx);
  if (res.status < 200 || res.status >= 300) throw new Error(apiError(res, "Couldn't list passkeys"));
  const list = res.body as PasskeyInfo[];
  return list.map((p) => ({
    key: p.credId,
    name: p.label,
    type: 'Passkey' as const,
    detail: added(p.createdAt),
  }));
}

/** Opens the portal for `ctx.server` — a self-hoster's own, not the hosted one. */
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
      <button
        type="button"
        className="button-primary"
        disabled={!ctx.token}
        onClick={() => void openPortal(ctx.server)}
      >
        Add a passkey in browser
      </button>
      <p className="setting-desc">
        Sign in on the web page with your password, then choose "Add a passkey". Passkeys need a browser with passkey
        support (Chrome, Edge, Safari, or Android).
      </p>
    </div>
  );
}

export const passkeyMethod: AuthMethod = { id: 'passkey', order: 10, load, Action: AddPasskey };
