import React, { useState, useEffect } from 'react';
import './admin.css';
import { Account, Token, Passkey, Share, Invite, SyncRow } from './types/admin';

interface AccountDrawerData extends Account {
  tokens: Token[];
  passkeys: Passkey[];
}

export function AdminConsole() {
  const [activePanel, setActivePanel] = useState('accounts');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [rows, setRows] = useState<SyncRow[]>([]);
  const [filteredRows, setFilteredRows] = useState<SyncRow[]>([]);

  const [rowFilterAccount, setRowFilterAccount] = useState('all');
  const [rowFilterTable, setRowFilterTable] = useState('all');

  const [queryInput, setQueryInput] = useState('');
  const [queryOutput, setQueryOutput] = useState('');

  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showAccountDrawer, setShowAccountDrawer] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditShareModal, setShowEditShareModal] = useState(false);

  const [newAccountName, setNewAccountName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<AccountDrawerData | null>(null);
  const [accountToDelete, setAccountToDelete] = useState('');

  const [editShareOwner, setEditShareOwner] = useState('');
  const [editShareGrantee, setEditShareGrantee] = useState('');
  const [editShareCalendar, setEditShareCalendar] = useState(false);
  const [editShareTodos, setEditShareTodos] = useState(false);

  // Load mock data
  useEffect(() => {
    const mockAccounts: Account[] = [
      {
        id: 1,
        name: 'owner',
        created_at: 1727788800000,
        grant_rev: 0,
        tokens: [{ id: 1, account_id: 1, label: 'env', created_at: 1727788800000 }],
        passkeys: [],
        row_count: 342,
      },
      {
        id: 2,
        name: 'daniel',
        created_at: 1727961600000,
        grant_rev: 2,
        tokens: [
          { id: 2, account_id: 2, label: 'admin', created_at: 1727961600000 },
          { id: 3, account_id: 2, label: 'passkey', created_at: 1727961600000 },
          { id: 4, account_id: 2, label: 'passkey', created_at: 1736817600000 },
        ],
        passkeys: [
          { id: 1, account_id: 2, cred_id: 'cred_4a91…e02c', created_at: 1727961600000 },
          { id: 2, account_id: 2, cred_id: 'cred_9910…7bf1', created_at: 1736817600000 },
        ],
        row_count: 128,
      },
      {
        id: 3,
        name: 'sarah',
        created_at: 1728134400000,
        grant_rev: 0,
        tokens: [{ id: 5, account_id: 3, label: 'passkey', created_at: 1728134400000 }],
        passkeys: [{ id: 3, account_id: 3, cred_id: 'cred_10ee…33ab', created_at: 1728134400000 }],
        row_count: 64,
      },
      {
        id: 4,
        name: 'james',
        created_at: 1727702400000,
        grant_rev: 1,
        tokens: [
          { id: 6, account_id: 4, label: 'passkey', created_at: 1727702400000 },
          { id: 7, account_id: 4, label: 'admin', created_at: 1730380800000 },
        ],
        passkeys: [{ id: 4, account_id: 4, cred_id: 'cred_7702…af90', created_at: 1727702400000 }],
        row_count: 21,
      },
    ];
    setAccounts(mockAccounts);

    const mockShares: Share[] = [
      {
        owner_id: 1,
        grantee_id: 2,
        owner_name: 'owner',
        grantee_name: 'daniel',
        calendar: true,
        todos: true,
      },
      {
        owner_id: 2,
        grantee_id: 3,
        owner_name: 'daniel',
        grantee_name: 'sarah',
        calendar: true,
        todos: false,
      },
      {
        owner_id: 4,
        grantee_id: 1,
        owner_name: 'james',
        grantee_name: 'owner',
        calendar: false,
        todos: true,
      },
    ];
    setShares(mockShares);

    const mockInvites: Invite[] = [
      {
        id: 1,
        code_hash: 'inv_7f3a…c92e',
        name: "Sarah's invite",
        created_at: 1728048000000,
        expires_at: 1728652800000,
        used_at: 1728220800000,
      },
      {
        id: 2,
        code_hash: 'inv_1d90…44ab',
        name: null,
        created_at: 1729308800000,
        expires_at: 1729913600000,
        used_at: null,
      },
      {
        id: 3,
        code_hash: 'inv_ae21…f00c',
        name: "James' plus-one",
        created_at: 1756876800000,
        expires_at: 1757481600000,
        used_at: null,
      },
    ];
    setInvites(mockInvites);

    const mockRows: SyncRow[] = [
      {
        account_id: 2,
        account_name: 'daniel',
        tbl: 'tasks',
        pk: 't_88a1',
        updated_at: 1725098040000,
        deleted: false,
        seq: 4102,
      },
      {
        account_id: 2,
        account_name: 'daniel',
        tbl: 'habits',
        pk: 'h_2c9f',
        updated_at: 1725097920000,
        deleted: false,
        seq: 4099,
      },
      {
        account_id: 1,
        account_name: 'owner',
        tbl: 'events',
        pk: 'e_5510',
        updated_at: 1725094680000,
        deleted: false,
        seq: 4087,
      },
      {
        account_id: 3,
        account_name: 'sarah',
        tbl: 'tasks',
        pk: 't_11ff',
        updated_at: 1725090000000,
        deleted: true,
        seq: 4071,
      },
      {
        account_id: 1,
        account_name: 'owner',
        tbl: 'periods',
        pk: 'p_0021',
        updated_at: 1724964120000,
        deleted: false,
        seq: 3944,
      },
      {
        account_id: 4,
        account_name: 'james',
        tbl: 'habit_completions',
        pk: 'hc_9a01',
        updated_at: 1724899800000,
        deleted: false,
        seq: 3810,
      },
      {
        account_id: 2,
        account_name: 'daniel',
        tbl: 'weights',
        pk: 'w_3f20',
        updated_at: 1724712120000,
        deleted: false,
        seq: 3702,
      },
    ];
    setRows(mockRows);
    setFilteredRows(mockRows);
  }, []);

  const applyRowFilter = () => {
    const filtered = rows.filter((row) => {
      const acctMatch = rowFilterAccount === 'all' || row.account_name === rowFilterAccount;
      const tblMatch = rowFilterTable === 'all' || row.tbl === rowFilterTable;
      return acctMatch && tblMatch;
    });
    setFilteredRows(filtered);
  };

  useEffect(() => {
    applyRowFilter();
  }, [rowFilterAccount, rowFilterTable, rows]);

  const executeQuery = () => {
    const q = queryInput.trim();
    if (!q) {
      setQueryOutput('Type a query and press Run.');
      return;
    }

    // Simple mock query executor
    const accountMatch = q.match(/account_id\s*=\s*'?(\w+)'?/i) || q.match(/account\s*=\s*'?(\w+)'?/i);
    const tblMatch = q.match(/tbl\s*=\s*'?(\w+)'?/i) || q.match(/FROM\s+(\w+)/i);
    let matched = rows;

    if (accountMatch) {
      const accountName = accountMatch[1];
      matched = matched.filter((r) => r.account_name === accountName);
    }

    if (tblMatch && tblMatch[1] !== 'rows') {
      matched = matched.filter((r) => r.tbl === tblMatch[1]);
    }

    if (matched.length === 0) {
      setQueryOutput('No matching rows in the sample set.');
    } else {
      const lines = matched.map(
        (r) => `${r.account_name.padEnd(8)} ${r.tbl.padEnd(18)} ${r.pk.padEnd(10)} seq=${r.seq}${r.deleted ? ' [deleted]' : ''}`
      );
      setQueryOutput(lines.join('\n') + `\n\n${matched.length} row(s) — sample data, not a live query.`);
    }
  };

  const generateToken = () => {
    return Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  };

  const createAccount = () => {
    const name = newAccountName.trim() || 'new-account';
    const token = generateToken();
    setNewToken(token);
    setNewAccountName('');
  };

  const openAccountDrawer = (account: Account) => {
    setSelectedAccount(account as AccountDrawerData);
    setShowAccountDrawer(true);
  };

  const openEditShare = (ownerName: string, granteeName: string, calendar: boolean, todos: boolean) => {
    setEditShareOwner(ownerName);
    setEditShareGrantee(granteeName);
    setEditShareCalendar(calendar);
    setEditShareTodos(todos);
    setShowEditShareModal(true);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatDateTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const format = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    return `${format} · ${time}`;
  };

  const getInviteStatus = (invite: Invite) => {
    if (invite.used_at) return 'used';
    if (invite.expires_at < Date.now()) return 'expired';
    return 'active';
  };

  const getPanelTitle = () => {
    switch (activePanel) {
      case 'shares':
        return 'Shares';
      case 'invites':
        return 'Invites';
      case 'rows':
        return 'Sync Data';
      default:
        return 'Accounts';
    }
  };

  const getPanelSub = () => {
    switch (activePanel) {
      case 'shares':
        return '3 active grants';
      case 'invites':
        return 'Invite-only signups';
      case 'rows':
        return 'rows table · generic (account, tbl, pk) store';
      default:
        return '4 accounts · isolated row sets';
    }
  };

  return (
    <div className="admin-shell">
      <div className="admin-body">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-mark">
              <svg viewBox="0 0 100 100" width="20" height="20">
                <path d="M76 9 C40 18 8 55 13 93 C28 72 58 50 76 9 Z" fill="#fff"></path>
                <path d="M78 12 L94 9 L79 94 L64 96 Z" fill="#fff" fillOpacity="0.55"></path>
                <path d="M18 66 L97 38 L97 56 L18 84 Z" fill="#fff"></path>
              </svg>
            </div>
            Albas Admin
          </div>
          <div className="sidebar-menu">
            <div className="sidebar-section-label">Sync Server</div>
            <div
              className={`menu-item ${activePanel === 'accounts' ? 'active' : ''}`}
              onClick={() => setActivePanel('accounts')}
            >
              Accounts
            </div>
            <div
              className={`menu-item ${activePanel === 'shares' ? 'active' : ''}`}
              onClick={() => setActivePanel('shares')}
            >
              Shares
            </div>
            <div
              className={`menu-item ${activePanel === 'invites' ? 'active' : ''}`}
              onClick={() => setActivePanel('invites')}
            >
              Invites
            </div>
            <div
              className={`menu-item ${activePanel === 'rows' ? 'active' : ''}`}
              onClick={() => setActivePanel('rows')}
            >
              Sync Data
            </div>
          </div>
          <div className="sidebar-note">
            Reflects the <b>rows</b>/<b>accounts</b>/<b>tokens</b>/<b>shares</b>/<b>invites</b> tables in{' '}
            <b>sync-server</b>. No free-form SQL is exposed by the server — every action here maps to a real admin
            endpoint.
          </div>
        </div>

        {/* Content */}
        <div className="content">
          {/* Top Bar */}
          <div className="top-bar">
            <div>
              <div className="top-bar-title">{getPanelTitle()}</div>
              <div className="top-bar-sub">{getPanelSub()}</div>
            </div>
            <div className="top-bar-buttons">
              {activePanel === 'accounts' && (
                <button className="btn-primary" onClick={() => setShowAddAccountModal(true)}>
                  + New Account
                </button>
              )}
            </div>
          </div>

          {/* Panels */}
          <div className="panels">
            {/* Accounts Panel */}
            {activePanel === 'accounts' && (
              <div className="panel active">
                <div className="panel-content">
                  <div className="schema-note">
                    Backed by <b>accounts</b> (id, name, created_at, grant_rev) joined with <b>tokens</b> and{' '}
                    <b>passkeys</b>. Deleting an account cascades to its rows, tokens, passkeys and shares — the server
                    forgets it, devices keep their local copy.
                  </div>
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
                            {account.name === 'owner' && (
                              <span className="badge badge-owner" style={{ marginLeft: '6px' }}>
                                env
                              </span>
                            )}
                          </td>
                          <td>{formatDate(account.created_at)}</td>
                          <td className="mono">{account.grant_rev}</td>
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
                          <td className="mono-strong">{account.row_count}</td>
                          <td className="row-actions">
                            <button className="btn-sm" onClick={() => openAccountDrawer(account)}>
                              View
                            </button>
                            <button
                              className="btn-sm btn-danger"
                              onClick={() => {
                                setAccountToDelete(account.name);
                                setShowDeleteModal(true);
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Shares Panel */}
            {activePanel === 'shares' && (
              <div className="panel active">
                <div className="panel-content">
                  <div className="schema-note">
                    Backed by <b>shares</b> (owner_id, grantee_id, calendar, todos). A grant change bumps the
                    grantee's <b>grant_rev</b> so their next sync rebuilds the shared snapshot. Weights are never
                    shareable — there's no column for them here.
                  </div>
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
                        <tr key={`${share.owner_id}-${share.grantee_id}`}>
                          <td>
                            <b>{share.owner_name}</b>
                          </td>
                          <td>{share.grantee_name}</td>
                          <td>
                            <span className={share.calendar ? 'badge badge-on' : 'badge badge-off'}>
                              {share.calendar ? 'events + periods' : 'none'}
                            </span>
                          </td>
                          <td>
                            <span className={share.todos ? 'badge badge-on' : 'badge badge-off'}>
                              {share.todos ? 'habits + tasks' : 'none'}
                            </span>
                          </td>
                          <td className="row-actions">
                            <button
                              className="btn-sm"
                              onClick={() => openEditShare(share.owner_name, share.grantee_name, share.calendar, share.todos)}
                            >
                              Edit
                            </button>
                            <button className="btn-sm btn-danger">Revoke</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Invites Panel */}
            {activePanel === 'invites' && (
              <div className="panel active">
                <div className="panel-content">
                  <div className="schema-note">
                    Backed by <b>invites</b> (code_hash, name, created_at, expires_at, used_at). Only used when
                    signups are invite-only — codes are hashed at rest, so a revoked/expired invite can't be recovered,
                    only reissued.
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Name</th>
                        <th>Created</th>
                        <th>Expires</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map((invite) => (
                        <tr key={invite.id}>
                          <td className="mono">{invite.code_hash}</td>
                          <td>{invite.name || '—'}</td>
                          <td>{formatDate(invite.created_at)}</td>
                          <td>{formatDate(invite.expires_at)}</td>
                          <td>
                            <span className={`badge badge-${getInviteStatus(invite)}`}>
                              {getInviteStatus(invite)}
                            </span>
                          </td>
                          <td className="row-actions">
                            <button
                              className="btn-sm"
                              disabled={getInviteStatus(invite) !== 'active'}
                              style={{ opacity: getInviteStatus(invite) !== 'active' ? 0.4 : 1 }}
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Sync Data Panel */}
            {activePanel === 'rows' && (
              <div className="panel active">
                <div className="panel-content">
                  <div className="schema-note">
                    Backed by the generic <b>rows</b> store (account_id, tbl, pk, payload, updated_at, deleted, seq)
                    — the server never parses payloads, so this is table/pk/seq only, not the app data itself.
                  </div>
                  <div className="filter-bar">
                    <select value={rowFilterAccount} onChange={(e) => setRowFilterAccount(e.target.value)}>
                      <option value="all">All accounts</option>
                      <option value="owner">owner</option>
                      <option value="daniel">daniel</option>
                      <option value="sarah">sarah</option>
                      <option value="james">james</option>
                    </select>
                    <select value={rowFilterTable} onChange={(e) => setRowFilterTable(e.target.value)}>
                      <option value="all">All tables</option>
                      <option value="events">events</option>
                      <option value="periods">periods</option>
                      <option value="habits">habits</option>
                      <option value="habit_completions">habit_completions</option>
                      <option value="tasks">tasks</option>
                      <option value="weights">weights</option>
                    </select>
                  </div>
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
                      {filteredRows.map((row, idx) => (
                        <tr key={idx}>
                          <td>{row.account_name}</td>
                          <td className="mono">{row.tbl}</td>
                          <td className="mono">{row.pk}</td>
                          <td>{formatDateTime(row.updated_at)}</td>
                          <td className="mono">{row.seq}</td>
                          <td>
                            <span className={row.deleted ? 'badge badge-deleted' : 'badge badge-live'}>
                              {row.deleted ? 'tombstone' : 'live'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Console */}
          <div className="console-half">
            <div className="console-bar">
              <div style={{ display: 'flex', flexDirection: 'row', gap: '12px', alignItems: 'center' }}>
                <div className="console-bar-title">Sync-Server Console</div>
                <button className="btn-primary" onClick={executeQuery}>
                  Run
                </button>
                <button onClick={() => setQueryOutput('')}>Clear</button>
              </div>
              <div className="top-bar-sub" style={{ textAlign: 'right' }}>
                read-only · queries the rows / accounts tables shown above — the real server exposes no SQL endpoint
              </div>
            </div>
            <div className="console-body">
              <div className="console-input">
                <textarea
                  className="console-textarea"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="SELECT tbl, pk, seq FROM rows WHERE account_id = 2 ORDER BY seq DESC LIMIT 5;"
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
              <div className="console-output">
                <div className="output-box" style={{ width: '100%', height: '100%' }}>
                  <div className="console-label">Result</div>
                  <span className="output-empty">{queryOutput || 'Results will appear here…'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}

      {/* Add Account Modal */}
      {showAddAccountModal && (
        <div className="modal-overlay active">
          <div className="modal">
            {newToken ? (
              <>
                <div className="modal-title">New Account</div>
                <div className="modal-sub">account created</div>
                <div className="token-warning">Shown once. This account's token is hashed on the server and cannot be recovered — copy it now.</div>
                <div className="token-reveal">{newToken}</div>
                <div className="modal-actions">
                  <button className="btn-primary" onClick={() => { setShowAddAccountModal(false); setNewToken(''); }}>
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
                  />
                </div>
                <div className="modal-actions">
                  <button onClick={() => { setShowAddAccountModal(false); setNewAccountName(''); }}>Cancel</button>
                  <button className="btn-primary" onClick={createAccount}>Create Account</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Account Drawer Modal */}
      {showAccountDrawer && selectedAccount && (
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
                    <span className="drawer-item-meta">{formatDate(token.created_at)}</span>
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
                    <span className="drawer-item-label mono">{passkey.cred_id}</span>
                    <span className="drawer-item-meta">{formatDate(passkey.created_at)}</span>
                  </div>
                ))
              ) : (
                <div className="drawer-item-meta">No passkeys</div>
              )}
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowAccountDrawer(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="modal-overlay active">
          <div className="modal" style={{ width: '420px' }}>
            <div className="modal-title">Delete account?</div>
            <div className="modal-sub">DELETE /accounts/{accountToDelete}</div>
            <p style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.6, marginBottom: '8px' }}>
              This removes the account's rows, tokens, passkeys, and shares in both directions. It is revocation, not archival
              — devices keep their local copy, the server just forgets it.
            </p>
            <div className="modal-actions">
              <button onClick={() => setShowDeleteModal(false)}>Cancel</button>
              <button className="btn-danger" onClick={() => setShowDeleteModal(false)}>Delete Account</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Share Modal */}
      {showEditShareModal && (
        <div className="modal-overlay active">
          <div className="modal">
            <div className="modal-title">{editShareOwner} → {editShareGrantee}</div>
            <div className="modal-sub">PUT /shares/{editShareGrantee}</div>
            <div className="modal-toggle-row">
              <div>
                <div className="modal-toggle-label">Calendar</div>
                <div className="modal-toggle-desc">events + periods</div>
              </div>
              <div
                className={`toggle-switch ${editShareCalendar ? 'on' : ''}`}
                onClick={() => setEditShareCalendar(!editShareCalendar)}
              >
                <div className="dot"></div>
              </div>
            </div>
            <div className="modal-toggle-row">
              <div>
                <div className="modal-toggle-label">Todos</div>
                <div className="modal-toggle-desc">habits + habit_completions + tasks</div>
              </div>
              <div
                className={`toggle-switch ${editShareTodos ? 'on' : ''}`}
                onClick={() => setEditShareTodos(!editShareTodos)}
              >
                <div className="dot"></div>
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowEditShareModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => setShowEditShareModal(false)}>Save Grant</button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Taskbar */}
      <div className="bottom-bar">
        <div className="bar-version">v1.9.0</div>
        <div className="bar-right">
          <span className="bar-sync">↻ 11:12 PM · just now</span>
          <span className="bar-divider"></span>
          <span className="bar-user">
            <span className="bar-user-icon">DP</span>
            Daniel P
          </span>
        </div>
      </div>
    </div>
  );
}
