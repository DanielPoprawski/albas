import type { Screen } from '../../App';

export function Splash({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  return (
    <div className="splash-container">
      <div className="splash-content">
        <Logo />
        <h1 className="splash-title">Albas</h1>
        <p className="splash-subtitle">Productivity Suite</p>
        <p className="splash-description">
          Organize your schedule, habits, and tasks in one intuitive workspace. Everything you need to do, in one place.
        </p>
      </div>

      <div className="splash-buttons">
        <button type="button" className="btn-primary" onClick={() => onNavigate('login')}>
          Sign In
        </button>
        <button type="button" className="btn-secondary" onClick={() => onNavigate('register')}>
          Create Account
        </button>
      </div>

      <div className="splash-offline">
        <button type="button" className="offline-link" onClick={() => onNavigate('offline')}>
          Use Offline — Set up later
        </button>
      </div>
    </div>
  );
}

export function Logo({ size = 56 }: { size?: number }) {
  return (
    <div className="logo">
      <svg viewBox="0 0 512 512" width={size} height={size}>
        <path
          d="M 352.64213,163.92994 413.28,52.08 l 58.95456,422.68234 -78.20532,-0.0413 z"
          fill="#fff"
          fillOpacity="0.55"
        />
        <path
          d="M 313.80273 46.6875 C 313.78856 46.714256 313.77394 46.740823 313.75977 46.767578 L 286.22266 46.767578 L 255.42969 105.83398 L 281.96094 105.83398 C 249.48628 165.31906 216.10526 224.31592 183.19531 283.55859 L 154.49609 283.55859 L 123.70312 342.625 L 150.38477 342.625 L 114.07422 409.05273 L 86.029297 409.05273 L 55.236328 468.11914 L 81.789062 468.11914 L 81.765625 468.16211 L 168.49414 468.36133 L 238.37305 342.625 L 475.24219 342.625 L 462.71484 283.55859 L 271.19922 283.55859 L 402.84375 46.6875 L 313.80273 46.6875 z"
          fill="#fff"
        />
      </svg>
    </div>
  );
}

export function OfflineInfo({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-card-header">
          <h2 className="auth-title">Use Albas Offline</h2>
          <p className="auth-subtitle">No account needed to get started</p>
        </div>

        <p className="copy-muted">
          Albas is local-first: on desktop and Android, a SQLite database on your own device is the source of truth, and
          the app is fully usable with no server at all. Install it on your device, skip sign-in, and everything — your
          schedule, habits and tasks — stays right there.
        </p>
        <p className="copy-muted">
          You can add sync later from Settings → Account & sync, on any device, whenever you're ready — nothing about
          setting up an account now is required up front.
        </p>

        <div className="offline-note">
          ⚠️ <strong>No cloud backup without an account:</strong> data stays on your device only until you sign in and
          sync. Back up your device regularly.
        </div>

        <div className="form-actions">
          <button type="button" className="btn-text" onClick={() => onNavigate('splash')}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
