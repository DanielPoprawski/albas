// Fetch client for the public site's auth flows. Talks to the real
// sync-server endpoints (see web/CLAUDE.md, "The public site: auth flows")
// through the `/api` prefix nginx strips before proxying.

import { ApiError, request } from './http';
import {
  type AuthenticationChallenge,
  prepareCreationOptions,
  prepareRequestOptions,
  type RegistrationChallenge,
  serializeAssertedCredential,
  serializeCreatedCredential,
} from './webauthn';

export { ApiError };

const SESSION_KEY = 'albas-session';

export interface Session {
  name: string;
  token: string;
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/** `login/password`'s signal to prompt for a TOTP code and retry with it set. */
export class TotpRequiredError extends ApiError {
  constructor() {
    super('A two-factor code is required.', 428);
    this.name = 'TotpRequiredError';
  }
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body });
}

function get<T>(path: string, token?: string): Promise<T> {
  return request<T>(path, { token });
}

/** `post`, with the signed-in session's bearer token. */
function postAuthed<T>(path: string, token: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', token, body });
}

// --- Password: the mandatory first credential ---

/** `POST /register/password`: creates the account and signs this browser in. */
export function registerWithPassword(name: string, password: string): Promise<Session> {
  return post<Session>('/register/password', { name, password });
}

/** Thrown by `loginWithPassword`/`enrollTotp` on a `423` — the account (or
 * this specific credential on it) is temporarily locked out after repeated
 * failures. See `sync-server/src/lockout.rs`. */
export class LockedOutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockedOutError';
  }
}

/**
 * `code` and `recoveryCode` are mutually exclusive — pass whichever the user
 * is entering. Both are ignored server-side unless the account has confirmed
 * TOTP.
 */
export async function loginWithPassword(
  name: string,
  password: string,
  code?: string,
  recoveryCode?: string,
): Promise<Session> {
  try {
    const body: Record<string, string> = { name, password };
    if (code) body.code = code;
    if (recoveryCode) body.recovery_code = recoveryCode;
    return await post<Session>('/login/password', body);
  } catch (e) {
    if (e instanceof ApiError && e.status === 423) {
      throw new LockedOutError(e.message || 'Too many failed attempts. Try again in a few minutes.');
    }
    // 428 is the server's "confirmed authenticator, no code sent" — distinct
    // from a wrong password, which stays 401. (Older servers said 401 with
    // this exact message; both are matched.)
    if (
      e instanceof ApiError &&
      (e.status === 428 || (e.status === 401 && e.message === 'A two-factor code is required.'))
    ) {
      throw new TotpRequiredError();
    }
    throw e;
  }
}

// --- Passkey ---

/**
 * The challenge half of passkey login, split out so the page can fetch it
 * *before* the click: WebKit (Safari, GNOME Web) drops the user gesture across
 * an `await`, and `navigator.credentials.get()` outside a gesture rejects with
 * NotAllowedError. Passing the prefetched challenge to `loginWithPasskey`
 * keeps `get()` synchronous with the click.
 */
export function loginStart(): Promise<AuthenticationChallenge> {
  return post<AuthenticationChallenge>('/login/start');
}

function loginFinish(authId: string, credential: PublicKeyCredential): Promise<Session> {
  return post<Session>('/login/finish', { authId, credential: serializeAssertedCredential(credential) });
}

/** Full passkey login ceremony. Usernameless — the authenticator identifies the account. */
export async function loginWithPasskey(challenge?: AuthenticationChallenge): Promise<Session> {
  const { authId, options } = challenge ?? (await loginStart());
  const credential = (await navigator.credentials.get(
    prepareRequestOptions(options.publicKey),
  )) as PublicKeyCredential | null;
  if (!credential) throw new Error('Sign-in was cancelled.');
  return loginFinish(authId, credential);
}

/** What `GET /passkeys` lists for the signed-in account. */
export interface PasskeyInfo {
  credId: string;
  label: string;
  createdAt: number;
}

export function listPasskeys(token: string): Promise<PasskeyInfo[]> {
  return get<PasskeyInfo[]>('/passkeys', token);
}

/**
 * Attaches a passkey to the signed-in account: the self-service
 * `/passkeys/start` + `/finish` pair. The account already exists (created
 * with a password), so unlike the old passkey *registration* this mints no
 * session — the browser keeps the one it has.
 */
export async function addPasskey(token: string): Promise<{ name: string; credId: string }> {
  const { regId, options } = await postAuthed<RegistrationChallenge>('/passkeys/start', token);
  const credential = (await navigator.credentials.create(
    prepareCreationOptions(options.publicKey),
  )) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey creation was cancelled.');
  return postAuthed('/passkeys/finish', token, { regId, credential: serializeCreatedCredential(credential) });
}

// --- Google sign-in (server-side OAuth; see sync-server/src/google.rs) ---

/**
 * What the server reports it's configured for. Google sign-in needs a
 * client id/secret pair the app never sees, so a self-hoster without a
 * Google Cloud project simply doesn't set them — `google` comes back false
 * and the button that would call `startGoogleSignIn` should not render.
 */
export interface AuthConfig {
  google: boolean;
}

export function getAuthConfig(): Promise<AuthConfig> {
  return get<AuthConfig>('/auth/config');
}

/**
 * Sends the browser to Google's own consent screen — this can't happen via
 * `fetch`; it's a full-page navigation, same as any other OAuth confidential-
 * client flow. `appSession` (the nonce this page may have been opened with,
 * see `claimAppSession` below) is forwarded as a query param so the server
 * can hand it back once Google redirects here again; from there the flow
 * rejoins the ordinary one below unchanged.
 */
export function startGoogleSignIn(appSession?: string | null): void {
  const qs = appSession ? `?app_session=${encodeURIComponent(appSession)}` : '';
  window.location.href = `/api/auth/google/start${qs}`;
}

/**
 * One-time pickup of the session the server minted after Google's callback.
 * The callback redirects back into this app with `?google_ticket=<ticket>`
 * rather than the bearer token itself; this exchanges that single-use ticket
 * for `{name, token}`, the same shape every other login method resolves to.
 */
export function claimGoogleTicket(ticket: string): Promise<Session> {
  return get<Session>(`/auth/google/session/${encodeURIComponent(ticket)}`);
}

// --- App session handoff ---

/**
 * What the desktop/Android app is waiting for. The app opened this page with a
 * nonce it generated and is polling the server; claiming binds that nonce to
 * the account this browser is signed in as, and mints the app its own token.
 *
 * The code comes back from the server rather than being derived here so the
 * app and the browser cannot disagree about what to show the user.
 */
export interface AppSessionClaim {
  code: string;
  account: string;
}

export function claimAppSession(nonce: string, token: string): Promise<AppSessionClaim> {
  return request<AppSessionClaim>('/app-session/claim', { method: 'POST', token, body: { nonce } });
}

// --- TOTP (two-factor authentication) ---
//
// Enrollment/management from the signed-in page (`SignedIn.tsx`) — a second
// factor for password login only, never for passkeys (see
// sync-server/src/totp.rs's module doc comment for why).

async function authedRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  token: string,
  body?: unknown,
): Promise<T> {
  try {
    return await request<T>(path, { method, token, body });
  } catch (e) {
    if (e instanceof ApiError && e.status === 423) {
      throw new LockedOutError(e.body || 'Too many failed attempts. Try again in a few minutes.');
    }
    throw e;
  }
}

export interface TotpStatus {
  enrolled: boolean;
  confirmed: boolean;
}

export function getTotpStatus(token: string): Promise<TotpStatus> {
  return authedRequest<TotpStatus>('GET', '/totp', token);
}

export interface TotpEnrollment {
  secret: string;
  uri: string;
}

/** Requires the account's current password again — see `sync-server/src/
 * totp.rs`'s `enroll_start` doc comment for why a bearer token alone isn't
 * treated as proof enough to mint a fresh 2FA secret. */
export function enrollTotp(token: string, password: string): Promise<TotpEnrollment> {
  return authedRequest<TotpEnrollment>('POST', '/totp/enroll', token, { password });
}

export interface TotpConfirmation {
  confirmed: true;
  /** Eight one-time codes, shown exactly once — the caller must display
   * these to the user now; the server never hands them back again. */
  recoveryCodes: string[];
}

export function confirmTotp(token: string, code: string): Promise<TotpConfirmation> {
  return authedRequest<TotpConfirmation>('POST', '/totp/confirm', token, { code });
}

export function disableTotp(token: string): Promise<void> {
  return authedRequest<void>('DELETE', '/totp', token);
}

// --- Sessions (Settings -> Sessions equivalent for the web portal) ---
