import { useState } from "react";
import { setAdminToken } from "../../lib/adminApi";

export function TokenGate({ error, onTokenSet }: { error: string | null; onTokenSet: () => void }) {
  const [token, setToken] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;
    setAdminToken(trimmed);
    onTokenSet();
  };

  return (
    <div className="gate-container">
      <div className="gate-card">
        <div className="gate-title">Albas Admin</div>
        <div className="gate-sub">
          Enter the server's <code>ALBAS_SYNC_ADMIN_TOKEN</code> to continue. It's kept in this browser only.
        </div>
        <form onSubmit={submit}>
          <div className="modal-field">
            <label className="modal-label" htmlFor="admin-token-input">
              Admin Token
            </label>
            <input
              id="admin-token-input"
              className="modal-input"
              type="password"
              autoFocus
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="paste the token"
            />
          </div>
          {error && <div className="gate-error">{error}</div>}
          <div className="modal-actions">
            <button type="submit" className="btn-primary" style={{ width: "100%" }}>
              Continue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
