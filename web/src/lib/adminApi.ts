// Fetch client for the sync-server admin endpoints (/accounts, /admin/shares,
// /admin/rows). Every call attaches the admin bearer token from localStorage;
// a 401/403 is surfaced as AdminAuthError so the console can drop back to the
// token-entry screen instead of showing an empty/broken panel.

import type { Account, CreateAccountResponse, Share, SyncRow, UpdateShareRequest } from "../types/admin";

const ADMIN_TOKEN_KEY = "albas-admin-token";

export class AdminAuthError extends Error {
  constructor(message = "Admin token missing or rejected.") {
    super(message);
    this.name = "AdminAuthError";
  }
}

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  if (!token) throw new AdminAuthError("No admin token set.");

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init?.body) headers["content-type"] = "application/json";

  const res = await fetch(`/api${path}`, { ...init, headers });

  if (res.status === 401 || res.status === 403) {
    throw new AdminAuthError("Admin token missing or rejected.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function listAccounts(): Promise<Account[]> {
  return adminFetch<Account[]>("/accounts");
}

export function createAccount(name: string): Promise<CreateAccountResponse> {
  return adminFetch<CreateAccountResponse>("/accounts", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteAccount(name: string): Promise<void> {
  return adminFetch<void>(`/accounts/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function listShares(): Promise<Share[]> {
  return adminFetch<Share[]>("/admin/shares");
}

export function putShare(owner: string, grantee: string, body: UpdateShareRequest): Promise<void> {
  return adminFetch<void>(`/admin/shares/${encodeURIComponent(owner)}/${encodeURIComponent(grantee)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteShare(owner: string, grantee: string): Promise<void> {
  return adminFetch<void>(`/admin/shares/${encodeURIComponent(owner)}/${encodeURIComponent(grantee)}`, {
    method: "DELETE",
  });
}

export function listRows(params: { account?: string; table?: string; limit?: number }): Promise<SyncRow[]> {
  const q = new URLSearchParams();
  if (params.account && params.account !== "all") q.set("account", params.account);
  if (params.table && params.table !== "all") q.set("table", params.table);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return adminFetch<SyncRow[]>(`/admin/rows${qs ? `?${qs}` : ""}`);
}
