import { useState } from "react";
import { loginWithPassword, saveSession, type Session, TotpRequiredError } from "../../lib/api";

export function PasswordLogin({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await loginWithPassword(name, password, needsCode ? code : undefined);
      saveSession(session);
      onSignedIn(session);
    } catch (e) {
      if (e instanceof TotpRequiredError) {
        setNeedsCode(true);
        setError(needsCode ? "That code didn't match. Try again." : null);
      } else {
        setError(e instanceof Error ? e.message : "Sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="form-group">
        <label htmlFor="pw-login-name">Account Name</label>
        <input
          id="pw-login-name"
          type="text"
          placeholder="your-account"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="pw-login-password">Password</label>
        <input
          id="pw-login-password"
          type="password"
          placeholder="••••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      {needsCode && (
        <div className="form-group">
          <label htmlFor="pw-login-code">2FA Code</label>
          <input
            id="pw-login-code"
            type="text"
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
          />
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      <button type="submit" className="btn-primary" style={{ width: "100%" }} disabled={busy}>
        {busy ? "Signing in…" : needsCode ? "Verify & Sign In" : "Sign In"}
      </button>
    </form>
  );
}
