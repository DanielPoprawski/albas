// Fetch client for the public site's auth flows. Talks to the real
// sync-server endpoints (see web/CLAUDE.md, "The public site: auth flows")
// through the `/api` prefix nginx strips before proxying.

import {
  type AuthenticationChallenge,
  prepareCreationOptions,
  prepareRequestOptions,
  type RegistrationChallenge,
  serializeAssertedCredential,
  serializeCreatedCredential,
} from "./webauthn";

const SESSION_KEY = "albas-session";

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

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** `login/password`'s signal to prompt for a TOTP code and retry with it set. */
export class TotpRequiredError extends Error {
  constructor() {
    super("A two-factor code is required.");
    this.name = "TotpRequiredError";
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new ApiError(text || `Request failed (${res.status}).`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new ApiError(text || `Request failed (${res.status}).`, res.status);
  }
  return (await res.json()) as T;
}

// --- Passkey ---

function registerStart(name: string): Promise<RegistrationChallenge> {
  return post<RegistrationChallenge>("/register/start", { name });
}

function registerFinish(regId: string, credential: PublicKeyCredential): Promise<Session> {
  return post<Session>("/register/finish", { regId, credential: serializeCreatedCredential(credential) });
}

function loginStart(): Promise<AuthenticationChallenge> {
  return post<AuthenticationChallenge>("/login/start");
}

function loginFinish(authId: string, credential: PublicKeyCredential): Promise<Session> {
  return post<Session>("/login/finish", { authId, credential: serializeAssertedCredential(credential) });
}

/** Full passkey registration ceremony: start -> navigator.credentials.create() -> finish. */
export async function registerWithPasskey(name: string): Promise<Session> {
  const { regId, options } = await registerStart(name);
  const credential = (await navigator.credentials.create(
    prepareCreationOptions(options.publicKey),
  )) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey creation was cancelled.");
  return registerFinish(regId, credential);
}

/** Full passkey login ceremony. Usernameless — the authenticator identifies the account. */
export async function loginWithPasskey(): Promise<Session> {
  const { authId, options } = await loginStart();
  const credential = (await navigator.credentials.get(
    prepareRequestOptions(options.publicKey),
  )) as PublicKeyCredential | null;
  if (!credential) throw new Error("Sign-in was cancelled.");
  return loginFinish(authId, credential);
}

// --- Password / TOTP backup login ---

export async function loginWithPassword(name: string, password: string, code?: string): Promise<Session> {
  try {
    return await post<Session>("/login/password", code ? { name, password, code } : { name, password });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && e.message === "A two-factor code is required.") {
      throw new TotpRequiredError();
    }
    throw e;
  }
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
  return get<AuthConfig>("/auth/config");
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
  const qs = appSession ? `?app_session=${encodeURIComponent(appSession)}` : "";
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

export async function claimAppSession(nonce: string, token: string): Promise<AppSessionClaim> {
  const res = await fetch("/api/app-session/claim", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ nonce }),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new ApiError(text || `Request failed (${res.status}).`, res.status);
  }
  return (await res.json()) as AppSessionClaim;
}
