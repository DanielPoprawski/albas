// Shared fetch transport for web/src/lib/api.ts (and any future caller). Owns
// the `/api` base URL join, JSON request headers, `res.ok` checking, and
// error-body parsing so callers don't each reimplement it slightly differently.

/** Base error for every non-2xx response from `request()`. `status` is the
 * HTTP status code; `body` is the raw (trimmed) response text, when any —
 * callers that need the untouched body (e.g. a lockout's fallback copy) read
 * that instead of `message`, which always has a generic fallback baked in. */
export class ApiError extends Error {
  status: number;
  body?: string;
  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  method?: string;
  /** Bearer token, sent as `authorization: Bearer <token>`. */
  token?: string;
  /** JSON-serialized and sent with `content-type: application/json` when set. */
  body?: unknown;
  headers?: Record<string, string>;
}

/** The server's error bodies are plain text today (see `sync-server/src/
 * password.rs` et al. — every handler returns `(StatusCode, String)`), but
 * this also accepts a JSON `{error}`/`{message}` body without extra callers
 * needing to know which shape came back. */
function errorMessageFrom(raw: string): string {
  if (!raw) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.error === 'string') return obj.error;
      if (typeof obj.message === 'string') return obj.message;
    }
  } catch {
    // Not JSON — the plain-text case, which is the common one.
  }
  return raw;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method, token, body, headers } = options;
  const finalHeaders: Record<string, string> = { ...headers };
  if (token) finalHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined) finalHeaders['content-type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers: Object.keys(finalHeaders).length > 0 ? finalHeaders : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const raw = (await res.text().catch(() => '')).trim();
    const message = errorMessageFrom(raw) || `Request failed (${res.status}).`;
    throw new ApiError(message, res.status, raw || undefined);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
