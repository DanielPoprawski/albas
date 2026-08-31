import type { Screen } from "../../screens";
import { Logo } from "./Logo";

export function Splash({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  return (
    <div className="splash-container">
      <div className="splash-content">
        <Logo />
        <h1 className="splash-title">Albas</h1>
        <p className="splash-subtitle">Productivity Suite</p>
        <p className="splash-description">
          Organize your schedule, habits, and tasks in one intuitive workspace. Everything you need to do, in one
          place.
        </p>
      </div>

      <div className="splash-buttons">
        <button type="button" className="btn-primary" onClick={() => onNavigate("login")}>
          Sign In
        </button>
        <button type="button" className="btn-secondary" onClick={() => onNavigate("register")}>
          Create Account
        </button>
      </div>

      <div className="splash-offline">
        <button type="button" className="offline-link" onClick={() => onNavigate("offline")}>
          Use Offline — Set up later
        </button>
      </div>
    </div>
  );
}
