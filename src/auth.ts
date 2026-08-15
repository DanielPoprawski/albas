// Passkey ceremony driver, shared by the Welcome screen and Settings → Account.
//
// The shape of a ceremony: our Rust command fetches the challenge from the sync
// server (`auth_*_start`), `tauri-plugin-webauthn` runs it against the platform
// authenticator (CTAP2 USB key on Linux, Credential Manager on Android), and
// the finish command posts the credential back and stores the minted token.
//
// On Linux a security key may demand its PIN mid-ceremony; the plugin surfaces
// that as events, forwarded here through `onEvent` so the caller can show a
// dialog and answer with `sendPin`.

/** The subset of plugin events the UI reacts to. */
export type PasskeyEvent =
  | { kind: 'pinRequired'; attemptsRemaining: number | null }
  | { kind: 'blocked'; message: string };

type RawEvent = { type?: string; event?: { type?: string; attemptsRemaining?: number | null } };

function translate(raw: RawEvent): PasskeyEvent | null {
  if (raw?.type !== 'pinEvent') return null;
  switch (raw.event?.type) {
    case 'pinRequired':
      return { kind: 'pinRequired', attemptsRemaining: null };
    case 'invalidPin':
      return { kind: 'pinRequired', attemptsRemaining: raw.event.attemptsRemaining ?? null };
    case 'pinAuthBlocked':
    case 'pinBlocked':
      return { kind: 'blocked', message: 'The security key has locked PIN entry — unplug and replug it, or reset the PIN.' };
    default:
      return null;
  }
}

/** Scheme+host+port of the server, which is the WebAuthn origin the platform asserts. */
function originOf(url: string): string {
  let base = url.trim().replace(/\/+$/, '');
  if (base.endsWith('/sync')) base = base.slice(0, -'/sync'.length).replace(/\/+$/, '');
  return new URL(base).origin;
}

interface StartRes {
  options: { publicKey: Record<string, unknown> };
}

async function ceremony(
  url: string,
  onEvent: (e: PasskeyEvent) => void,
  run: (wa: typeof import('tauri-plugin-webauthn-api'), origin: string) => Promise<{ name: string }>
): Promise<{ name: string }> {
  const wa = await import('tauri-plugin-webauthn-api');
  const unlisten = await wa.registerListener(raw => {
    const e = translate(raw as RawEvent);
    if (e) onEvent(e);
  });
  try {
    return await run(wa, originOf(url));
  } finally {
    unlisten();
  }
}

/** Usernameless sign-in: the authenticator identifies the account. */
export async function signIn(
  url: string,
  onEvent: (e: PasskeyEvent) => void
): Promise<{ name: string }> {
  const { invoke } = await import('@tauri-apps/api/core');
  const start = await invoke<StartRes & { authId: string }>('auth_login_start', { url });
  return ceremony(url, onEvent, async (wa, origin) => {
    const credential = await wa.authenticate(origin, start.options.publicKey as never);
    return invoke<{ name: string }>('auth_login_finish', { authId: start.authId, credential });
  });
}

/** Creates an account (or attaches a passkey, with a name-pinned invite). */
export async function createAccount(
  url: string,
  name: string,
  invite: string | null,
  onEvent: (e: PasskeyEvent) => void
): Promise<{ name: string }> {
  const { invoke } = await import('@tauri-apps/api/core');
  const start = await invoke<StartRes & { regId: string }>('auth_register_start', {
    url,
    name,
    invite: invite || null,
  });
  return ceremony(url, onEvent, async (wa, origin) => {
    // webauthn-rs only *prefers* a resident key, and a security key may honour
    // that as "no" — but usernameless login needs one, so insist.
    const pk = start.options.publicKey;
    pk.authenticatorSelection = {
      ...((pk.authenticatorSelection as object) ?? {}),
      residentKey: 'required',
      requireResidentKey: true,
    };
    const credential = await wa.register(origin, pk as never);
    return invoke<{ name: string }>('auth_register_finish', { regId: start.regId, credential });
  });
}

/** Answers a security key's PIN prompt (Linux). */
export async function submitPin(pin: string): Promise<void> {
  const wa = await import('tauri-plugin-webauthn-api');
  await wa.sendPin(pin);
}

/** Aborts the ceremony in progress (closing the PIN dialog, for instance). */
export async function cancelCeremony(): Promise<void> {
  try {
    const wa = await import('tauri-plugin-webauthn-api');
    await wa.cancel();
  } catch {
    // nothing in flight — fine
  }
}
