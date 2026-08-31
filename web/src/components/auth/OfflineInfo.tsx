import type { Screen } from "../../screens";

export function OfflineInfo({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-card-header">
          <h2 className="auth-title">Use Albas Offline</h2>
          <p className="auth-subtitle">No account needed to get started</p>
        </div>

        <p style={{ color: "#6b7280", marginBottom: "20px", lineHeight: 1.6, fontSize: "14px" }}>
          Albas is local-first: on desktop and Android, a SQLite database on your own device is the source of truth,
          and the app is fully usable with no server at all. Install it on your device, skip sign-in, and everything
          — your schedule, habits and tasks — stays right there.
        </p>
        <p style={{ color: "#6b7280", marginBottom: "20px", lineHeight: 1.6, fontSize: "14px" }}>
          You can add sync later from Settings → Account & sync, on any device, whenever you're ready — nothing
          about setting up an account now is required up front.
        </p>

        <div className="offline-note">
          ⚠️ <strong>No cloud backup without an account:</strong> data stays on your device only until you sign in
          and sync. Back up your device regularly.
        </div>

        <div className="form-actions">
          <button type="button" className="btn-text" style={{ flex: 1 }} onClick={() => onNavigate("splash")}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
