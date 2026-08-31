import { useEffect, useState } from "react";
import "./admin.css";
import type { Account, Share, SyncRow } from "./types/admin";
import {
  AdminAuthError,
  clearAdminToken,
  createAccount,
  deleteAccount,
  deleteShare,
  getAdminToken,
  listAccounts,
  listRows,
  listShares,
  putShare,
} from "./lib/adminApi";
import { TokenGate } from "./components/admin/TokenGate";

type Panel = "accounts" | "shares" | "rows";

// The six tables sync.rs's TABLES declares. No endpoint enumerates these — see
// web/CLAUDE.md, "Maintenance & Protocol Updates": add a new one here too.
const KNOWN_TABLES = ["events", "periods", "habits", "habit_completions", "tasks", "weights"] as const;

interface ShareModalState {
  mode: "create" | "edit";
  owner: string;
  grantee: string;
  calendar: boolean;
  todos: boolean;
}

export function AdminConsole() {
  const [adminToken, setAdminTokenState] = useState<string | null>(() => getAdminToken());
  const [gateError, setGateError] = useState<string | null>(null);

  const [activePanel, setActivePanel] = useState<Panel>("accounts");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [rows, setRows] = useState<SyncRow[]>([]);
  const [panelError, setPanelError] = useState<string | null>(null);

  const [rowFilterAccount, setRowFilterAccount] = useState("all");
  const [rowFilterTable, setRowFilterTable] = useState("all");

  const [queryInput, setQueryInput] = useState("");
  const [queryOutput, setQueryOutput] = useState("");

  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newToken, setNewToken] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null);

  const [shareModal, setShareModal] = useState<ShareModalState | null>(null);

  const handleAuthError = (e: AdminAuthError) => {
    clearAdminToken();
    setAdminTokenState(null);
    setGateError(e.message);
  };

  const refreshAccounts = async () => {
    try {
      setAccounts(await listAccounts());
    } catch (e) {
      if (e instanceof AdminAuthError) handleAuthError(e);
      else setPanelError(e instanceof Error ? e.message : "Failed to load accounts.");
    }
  };

  const refreshShares = async () => {
    try {
      setShares(await listShares());
    } catch (e) {
      if (e instanceof AdminAuthError) handleAuthError(e);
      else setPanelError(e instanceof Error ? e.message : "Failed to load shares.");
    }
  };

  const refreshRows = async () => {
    try {
      setRows(await listRows({ account: rowFilterAccount, table: rowFilterTable, limit: 500 }));
    } catch (e) {
      if (e instanceof AdminAuthError) handleAuthError(e);
      else setPanelError(e instanceof Error ? e.message : "Failed to load rows.");
    }
  };

  useEffect(() => {
    if (!adminToken) return;
    setPanelError(null);
    void refreshAccounts();
    void refreshShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  useEffect(() => {
    if (!adminToken) return;
    void refreshRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, rowFilterAccount, rowFilterTable]);

  if (!adminToken) {
    return (
      <TokenGate
        error={gateError}
        onTokenSet={() => {
          setGateError(null);
          setAdminTokenState(getAdminToken());
        }}
      />
    );
  }

  // --- Account actions ---

  const openAddAccount = () => {
    setModalError(null);
    setNewAccountName("");
    setNewToken("");
    setShowAddAccountModal(true);
  };

  const submitCreateAccount = async () => {
    const name = newAccountName.trim();
    if (!name) {
      setModalError("Name is required.");
      return;
    }
    try {
      const created = await createAccount(name);
      setNewToken(created.token);
      setModalError(null);
      await refreshAccounts();
    } catch (e) {
      if (e instanceof AdminAuthError) {
        handleAuthError(e);
        return;
      }
      setModalError(e instanceof Error ? e.message : "Failed to create account.");
    }
  };

  const confirmDeleteAccount = async () => {
    if (!accountToDelete) return;
    try {
      await deleteAccount(accountToDelete.name);
      setAccountToDelete(null);
      await refreshAccounts();
      await refreshShares();
    } catch (e) {
      if (e instanceof AdminAuthError) {
        handleAuthError(e);
        return;
      }
      setModalError(e instanceof Error ? e.message : "Failed to delete account.");
    }
  };

  // --- Share actions ---

  const openAddShare = () => {
    setModalError(null);
    setShareModal({ mode: "create", owner: "", grantee: "", calendar: false, todos: false });
  };

  const openEditShare = (share: Share) => {
    setModalError(null);
    setShareModal({ mode: "edit", owner: share.ownerName, grantee: share.granteeName, calendar: share.calendar, todos: share.todos });
  };

  const saveShare = async () => {
    if (!shareModal) return;
    const owner = shareModal.owner.trim();
    const grantee = shareModal.grantee.trim();
    if (!owner || !grantee) {
      setModalError("Both accounts are required.");
      return;
    }
    if (owner === grantee) {
      setModalError("Owner and grantee must be different accounts.");
      return;
    }
    try {
      await putShare(owner, grantee, { calendar: shareModal.calendar, todos: shareModal.todos });
      setShareModal(null);
      await refreshShares();
    } catch (e) {
      if (e instanceof AdminAuthError) {
        handleAuthError(e);
        return;
      }
      setModalError(e instanceof Error ? e.message : "Failed to save grant — check both account names exist.");
    }
  };

  const revokeShare = async (share: Share) => {
    if (!window.confirm(`Revoke ${share.ownerName} → ${share.granteeName}?`)) return;
    try {
      await deleteShare(share.ownerName, share.granteeName);
      await refreshShares();
    } catch (e) {
      if (e instanceof AdminAuthError) {
        handleAuthError(e);
        return;
      }
      setPanelError(e instanceof Error ? e.message : "Failed to revoke grant.");
    }
  };

  // --- Formatting ---

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  const formatDateTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${formatDate(timestamp)} · ${time}`;
  };

  const getPanelTitle = () => (activePanel === "shares" ? "Shares" : activePanel === "rows" ? "Sync Data" : "Accounts");

  const getPanelSub = () => {
    if (activePanel === "shares") return `${shares.length} active grant${shares.length === 1 ? "" : "s"}`;
    if (activePanel === "rows") return "rows table · generic (account, tbl, pk) store";
    return `${accounts.length} account${accounts.length === 1 ? "" : "s"} · isolated row sets`;
  };

  // --- Console (client-side filter over already-fetched `rows`; sync-server exposes no SQL endpoint) ---

  const executeQuery = () => {
    const q = queryInput.trim();
    if (!q) {
      setQueryOutput("Type a query and press Run.");
      return;
    }
    const accountMatch = q.match(/account_id\s*=\s*'?(\w+)'?/i) || q.match(/account\s*=\s*'?(\w+)'?/i);
    const tblMatch = q.match(/tbl\s*=\s*'?(\w+)'?/i) || q.match(/FROM\s+(\w+)/i);
    let matched = rows;
    if (accountMatch) matched = matched.filter((r) => r.accountName === accountMatch[1]);
    if (tblMatch && tblMatch[1] !== "rows") matched = matched.filter((r) => r.tbl === tblMatch[1]);

    if (matched.length === 0) {
      setQueryOutput("No matching rows in the currently loaded set.");
    } else {
      const lines = matched.map(
        (r) => `${r.accountName.padEnd(8)} ${r.tbl.padEnd(18)} ${r.pk.padEnd(10)} seq=${r.seq}${r.deleted ? " [deleted]" : ""}`,
      );
      setQueryOutput(lines.join("\n") + `\n\n${matched.length} row(s) — filtered from the rows already loaded above.`);
    }
  };

  return (
    <div className="admin-shell">
      <div className="admin-body">
        <div className="sidebar">
          <div className="sidebar-logo">
            <span className="logo-mark">
              <svg viewBox="0 0 100 100" width="20" height="20">
                <path d="M76 9 C40 18 8 55 13 93 C28 72 58 50 76 9 Z" fill="#fff" />
                <path d="M78 12 L94 9 L79 94 L64 96 Z" fill="#fff" fillOpacity="0.55" />
                <path d="M18 66 L97 38 L97 56 L18 84 Z" fill="#fff" />
              </svg>
            </span>
            Albas Admin
          </div>
          <div className="sidebar-menu">
            <div className="sidebar-section-label">Sync Server</div>
            <div className={`menu-item ${activePanel === "accounts" ? "active" : ""}`} onClick={() => setActivePanel("accounts")}>
              Accounts
            </div>
            <div className={`menu-item ${activePanel === "shares" ? "active" : ""}`} onClick={() => setActivePanel("shares")}>
              Shares
            </div>
            <div className={`menu-item ${activePanel === "rows" ? "active" : ""}`} onClick={() => setActivePanel("rows")}>
              Sync Data
            </div>
          </div>
          <div className="sidebar-note">
            Reflects the <b>rows</b>/<b>accounts</b>/<b>tokens</b>/<b>shares</b> tables in <b>sync-server</b>. No
            free-form SQL is exposed by the server — every action here maps to a real admin endpoint. There is no
            Invites panel — signup is open, not invite-gated (see root CLAUDE.md, "Project direction").
          </div>
        </div>

        <div className="content">
          <div className="top-bar">
            <div>
              <div className="top-bar-title">{getPanelTitle()}</div>
              <div className="top-bar-sub">{getPanelSub()}</div>
            </div>
            <div className="top-bar-buttons">
              {activePanel === "accounts" && (
                <button className="btn-primary" onClick={openAddAccount}>
                  + New Account
                </button>
              )}
              {activePanel === "shares" && (
                <button className="btn-primary" onClick={openAddShare}>
                  + New Grant
                </button>
              )}
            </div>
          </div>

          <div className="panels">
            {panelError && (
              <div className="panel-content">
                <div className="panel-error">{panelError}</div>
              </div>
            )}

            {!panelError && activePanel === "accounts" && (
              <div className="panel active">
                <div className="panel-content">
                  <div className="schema-note">
                    Backed by <b>accounts</b> (id, name, created_at, grant_rev) joined with <b>tokens</b> and{" "}
                    <b>passkeys</b>. Deleting an account cascades to its rows, tokens, passkeys and shares — the
                    server forgets it, devices keep their local copy.
                  </div>
                  {accounts.length === 0 ? (
                    <div className="panel-empty">No accounts yet.</div>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Name</th>
                          <th>Created</th>
                          <th>Grant Rev</th>
                          <th>Tokens</th>
                          <th>Passkeys</th>
                          <th>Rows</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accounts.map((account) => (
                          <tr key={account.id}>
                            <td className="mono">{account.id}</td>
                            <td>
                              <b>{account.name}</b>
                              {account.name === "owner" && (
                                <span className="badge badge-owner" style={{ marginLeft: "6px" }}>
                                  env
                                </span>
                              )}
                            </td>
                            <td>{formatDate(account.createdAt)}</td>
                            <td className="mono">{account.grantRev}</td>
                            <td>
                              <div className="chip-row">
                                {account.tokens.map((token) => (
                                  <span key={token.id} className="chip">
                                    {token.label}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="mono">{account.passkeys.length}</td>
                            <td className="mono-strong">{account.rowCount}</td>
                            <td className="row-actions">
                              <button
                                className="btn-sm"
                                onClick={() => {
                                  setModalError(null);
                                  setSelectedAccount(account);
                                }}
                              >
                                View
                              </button>
                              <button
                                className="btn-sm btn-danger"
                                onClick={() => {
                                  setModalError(null);
                                  setAccountToDelete(account);
                                }}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {!panelError && activePanel === "shares" && (
              <div className="panel active">
                <div className="panel-content">
                  <div className="schema-note">
                    Backed by <b>shares</b> (owner_id, grantee_id, calendar, todos). A grant change bumps the
                    grantee's <b>grant_rev</b> so their next sync rebuilds the shared snapshot. Weights are never
                    shareable — there's no column for them here.
                  </div>
                  {shares.length === 0 ? (
                    <div className="panel-empty">No grants yet.</div>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Owner</th>
                          <th>Grantee</th>
                          <th>Calendar</th>
                          <th>Todos</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shares.map((share) => (
                          <tr key={`${share.ownerId}-${share.granteeId}`}>
                            <td>
                              <b>{share.ownerName}</b>
                            </td>
                            <td>{share.granteeName}</td>
                            <td>
                              <span className={share.calendar ? "badge badge-on" : "badge badge-off"}>
                                {share.calendar ? "events + periods" : "none"}
                              </span>
                            </td>
                            <td>
                              <span className={share.todos ? "badge badge-on" : "badge badge-off"}>
                                {share.todos ? "habits + tasks" : "none"}
                              </span>
                            </td>
                            <td className="row-actions">
                              <button className="btn-sm" onClick={() => openEditShare(share)}>
                                Edit
                              </button>
                              <button className="btn-sm btn-danger" onClick={() => revokeShare(share)}>
                                Revoke
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {!panelError && activePanel === "rows" && (
              <div className="panel active">
                <div className="panel-content">
                  <div className="schema-note">
                    Backed by the generic <b>rows</b> store (account_id, tbl, pk, payload, updated_at, deleted, seq)
                    — the server never parses payloads, so this is table/pk/seq only, not the app data itself.
                  </div>
                  <div className="filter-bar">
                    <select value={rowFilterAccount} onChange={(e) => setRowFilterAccount(e.target.value)}>
                      <option value="all">All accounts</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.name}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <select value={rowFilterTable} onChange={(e) => setRowFilterTable(e.target.value)}>
                      <option value="all">All tables</option>
                      {KNOWN_TABLES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  {rows.length === 0 ? (
                    <div className="panel-empty">No rows match this filter.</div>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th>Table</th>
                          <th>PK</th>
                          <th>Updated</th>
                          <th>Seq</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={`${row.accountId}-${row.tbl}-${row.pk}`}>
                            <td>{row.accountName}</td>
                            <td className="mono">{row.tbl}</td>
                            <td className="mono">{row.pk}</td>
                            <td>{formatDateTime(row.updatedAt)}</td>
                            <td className="mono">{row.seq}</td>
                            <td>
                              <span className={row.deleted ? "badge badge-deleted" : "badge badge-live"}>
                                {row.deleted ? "tombstone" : "live"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="console-half">
            <div className="console-bar">
              <div style={{ display: "flex", flexDirection: "row", gap: "12px", alignItems: "center" }}>
                <div className="console-bar-title">Sync-Server Console</div>
                <button className="btn-primary" onClick={executeQuery}>
                  Run
                </button>
                <button onClick={() => setQueryOutput("")}>Clear</button>
              </div>
              <div className="top-bar-sub" style={{ textAlign: "right" }}>
                read-only · filters the {rows.length} row(s) already loaded above — the real server exposes no SQL
                endpoint
              </div>
            </div>
            <div className="console-body">
              <div className="console-input">
                <textarea
                  className="console-textarea"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="SELECT tbl, pk, seq FROM rows WHERE account_id = 2 ORDER BY seq DESC LIMIT 5;"
                  style={{ width: "100%", height: "100%" }}
                />
              </div>
              <div className="console-output">
                <div className="output-box" style={{ width: "100%", height: "100%" }}>
                  <div className="console-label">Result</div>
                  <span className="output-empty">{queryOutput || "Results will appear here…"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Account Modal */}
      {showAddAccountModal && (
        <div className="modal-overlay active">
          <div className="modal">
            {newToken ? (
              <>
                <div className="modal-title">New Account</div>
                <div className="modal-sub">account "{newAccountName || "…"}" created</div>
                <div className="token-warning">
                  Shown once. This account's token is hashed on the server and cannot be recovered — copy it now.
                </div>
                <div className="token-reveal">{newToken}</div>
                <div className="modal-actions">
                  <button
                    className="btn-primary"
                    onClick={() => {
                      setShowAddAccountModal(false);
                      setNewToken("");
                    }}
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-title">New Account</div>
                <div className="modal-sub">POST /accounts</div>
                <div className="modal-field">
                  <label className="modal-label">Name</label>
                  <input
                    className="modal-input"
                    type="text"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    placeholder="lowercase, letters/numbers/-/_ only"
                    autoFocus
                  />
                </div>
                {modalError && <div className="panel-error">{modalError}</div>}
                <div className="modal-actions">
                  <button onClick={() => setShowAddAccountModal(false)}>Cancel</button>
                  <button className="btn-primary" onClick={submitCreateAccount}>
                    Create Account
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Account Detail Drawer */}
      {selectedAccount && (
        <div className="modal-overlay active">
          <div className="modal">
            <div className="modal-title">{selectedAccount.name}</div>
            <div className="modal-sub">accounts · tokens · passkeys</div>
            <div className="drawer-section">
              <div className="drawer-section-title">Tokens</div>
              {selectedAccount.tokens.length > 0 ? (
                selectedAccount.tokens.map((token) => (
                  <div key={token.id} className="drawer-item">
                    <span className="drawer-item-label">{token.label}</span>
                    <span className="drawer-item-meta">{formatDate(token.createdAt)}</span>
                  </div>
                ))
              ) : (
                <div className="drawer-item-meta">No tokens</div>
              )}
            </div>
            <div className="drawer-section">
              <div className="drawer-section-title">Passkeys</div>
              {selectedAccount.passkeys.length > 0 ? (
                selectedAccount.passkeys.map((passkey) => (
                  <div key={passkey.id} className="drawer-item">
                    <span className="drawer-item-label mono">{passkey.credId}</span>
                    <span className="drawer-item-meta">{formatDate(passkey.createdAt)}</span>
                  </div>
                ))
              ) : (
                <div className="drawer-item-meta">No passkeys</div>
              )}
            </div>
            <div className="modal-actions">
              <button onClick={() => setSelectedAccount(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirm */}
      {accountToDelete && (
        <div className="modal-overlay active">
          <div className="modal" style={{ width: "420px" }}>
            <div className="modal-title">Delete account?</div>
            <div className="modal-sub">DELETE /accounts/{accountToDelete.name}</div>
            <p style={{ fontSize: "12px", color: "#6b7280", lineHeight: 1.6, marginBottom: "8px" }}>
              This removes the account's rows, tokens, passkeys, and shares in both directions. It is revocation,
              not archival — devices keep their local copy, the server just forgets it.
            </p>
            {modalError && <div className="panel-error">{modalError}</div>}
            <div className="modal-actions">
              <button onClick={() => setAccountToDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={confirmDeleteAccount}>
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Grant / Edit Share Modal */}
      {shareModal && (
        <div className="modal-overlay active">
          <div className="modal">
            <div className="modal-title">
              {shareModal.mode === "create" ? "New Grant" : `${shareModal.owner} → ${shareModal.grantee}`}
            </div>
            <div className="modal-sub">
              {shareModal.mode === "create" ? "PUT /admin/shares/:owner/:grantee" : `PUT /admin/shares/${shareModal.owner}/${shareModal.grantee}`}
            </div>

            {shareModal.mode === "create" && (
              <>
                <div className="modal-field">
                  <label className="modal-label">Owner</label>
                  <input
                    className="modal-input"
                    type="text"
                    value={shareModal.owner}
                    onChange={(e) => setShareModal({ ...shareModal, owner: e.target.value })}
                    placeholder="account sharing its data"
                    autoFocus
                  />
                </div>
                <div className="modal-field">
                  <label className="modal-label">Grantee</label>
                  <input
                    className="modal-input"
                    type="text"
                    value={shareModal.grantee}
                    onChange={(e) => setShareModal({ ...shareModal, grantee: e.target.value })}
                    placeholder="account receiving read access"
                  />
                </div>
              </>
            )}

            <div className="modal-toggle-row">
              <div>
                <div className="modal-toggle-label">Calendar</div>
                <div className="modal-toggle-desc">events + periods</div>
              </div>
              <div
                className={`toggle-switch ${shareModal.calendar ? "on" : ""}`}
                onClick={() => setShareModal({ ...shareModal, calendar: !shareModal.calendar })}
              >
                <div className="dot" />
              </div>
            </div>
            <div className="modal-toggle-row">
              <div>
                <div className="modal-toggle-label">Todos</div>
                <div className="modal-toggle-desc">habits + habit_completions + tasks</div>
              </div>
              <div
                className={`toggle-switch ${shareModal.todos ? "on" : ""}`}
                onClick={() => setShareModal({ ...shareModal, todos: !shareModal.todos })}
              >
                <div className="dot" />
              </div>
            </div>

            {modalError && <div className="panel-error">{modalError}</div>}

            <div className="modal-actions">
              <button onClick={() => setShareModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveShare}>
                Save Grant
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bottom-bar">
        <div className="bar-version">Albas Admin</div>
        <div className="bar-right">
          <span className="bar-sync">↻ {new Date().toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  );
}
