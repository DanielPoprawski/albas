import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { usePasskeyAuth } from './auth/usePasskeyAuth';
import PinDialog from './auth/PinDialog';

type Screen = 'splash' | 'signin' | 'register' | 'offline';

/**
 * Entry point: splash screen + three auth cards (sign in, register, offline).
 * Full-screen gate rendering instead of the app while awaiting welcomeDone.
 * All flows preserve the existing passkey/password auth via usePasskeyAuth.
 */
export default function Welcome() {
  const { setSetting } = useApp();
  const auth = usePasskeyAuth();
  const [screen, setScreen] = useState<Screen>('splash');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');

  const busy = auth.state.kind === 'busy';

  const handleUseOffline = () => {
    setSetting('__welcome_done', '1');
  };

  const handleSignIn = async () => {
    await auth.signIn();
  };

  const handleCreateAccount = async () => {
    if (name.trim()) {
      await auth.createAccount(name.trim(), invite.trim() || null);
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-[var(--t-page)] to-[var(--t-page-shade)]">
      {screen === 'splash' && (
        <SplashScreen
          onSignIn={() => setScreen('signin')}
          onCreateAccount={() => {
            setName('');
            setInvite('');
            setScreen('register');
          }}
          onUseOffline={() => setScreen('offline')}
        />
      )}

      {screen === 'signin' && (
        <AuthCard
          title="Welcome Back"
          subtitle="Sign in with your passkey"
          methodCount="4 ways to sign in · Passkey, Password, OAuth, 2FA"
          onBack={() => setScreen('splash')}
          onSubmit={handleSignIn}
          submitLabel="Sign In"
          footerText="Don't have an account?"
          footerLink="Create one"
          onFooterClick={() => setScreen('register')}
          busy={busy}
          state={auth.state}
          showPasskeyNote
        />
      )}

      {screen === 'register' && (
        <RegisterCard
          name={name}
          setName={setName}
          invite={invite}
          setInvite={setInvite}
          onBack={() => setScreen('splash')}
          onSubmit={handleCreateAccount}
          busy={busy}
          state={auth.state}
          footerLink={() => setScreen('signin')}
        />
      )}

      {screen === 'offline' && (
        <OfflineCard
          onStart={handleUseOffline}
          onBack={() => setScreen('splash')}
          busy={busy}
        />
      )}

      {auth.pin && (
        <PinDialog
          attemptsRemaining={auth.pin.attemptsRemaining}
          onSubmit={auth.submitPin}
          onCancel={auth.cancelPin}
        />
      )}
    </div>
  );
}

/**
 * Full-bleed splash screen with logo, title, buttons.
 */
function SplashScreen({
  onSignIn,
  onCreateAccount,
  onUseOffline,
}: {
  onSignIn: () => void;
  onCreateAccount: () => void;
  onUseOffline: () => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-[40px] px-[20px]">
      <div className="text-center max-w-[500px]">
        {/* Logo */}
        <div
          className="w-[80px] h-[80px] mx-auto mb-[24px] flex items-center justify-center text-white font-bold text-[48px] font-heading"
          style={{ background: 'linear-gradient(135deg, var(--t-accent) 0%, var(--t-accent-deep) 100%)' }}
        >
          <svg viewBox="0 0 100 100" width="56" height="56">
            <path d="M76 9 C40 18 8 55 13 93 C28 72 58 50 76 9 Z" fill="#fff"></path>
            <path d="M78 12 L94 9 L79 94 L64 96 Z" fill="#fff" fillOpacity="0.55"></path>
            <path d="M18 66 L97 38 L97 56 L18 84 Z" fill="#fff"></path>
          </svg>
        </div>

        {/* Title */}
        <h1 className="text-[42px] font-bold font-heading text-[var(--t-ink)] mb-[8px] tracking-tight">
          Albas
        </h1>

        {/* Subtitle */}
        <p className="text-[18px] text-[var(--t-ink-secondary)] font-medium mb-[12px]">
          Productivity Suite
        </p>

        {/* Description */}
        <p className="text-[14px] text-[var(--t-ink-muted)] mb-[40px] leading-relaxed">
          Organize your schedule, habits, and tasks in one intuitive workspace. Everything you need to do, in one place.
        </p>
      </div>

      {/* Button stack */}
      <div className="flex flex-col gap-[12px] w-full max-w-[300px]">
        <button
          onClick={onSignIn}
          className="px-[24px] py-[12px] text-white font-semibold text-[16px] cursor-pointer transition-all duration-300 hover:translate-y-[-2px] hover:shadow-lg shadow-[0_4px_16px_rgba(168,85,247,0.3)]"
          style={{ background: 'linear-gradient(135deg, var(--t-accent) 0%, var(--t-accent-deep) 100%)' }}
        >
          Sign In
        </button>
        <button
          onClick={onCreateAccount}
          className="px-[24px] py-[12px] bg-white text-[var(--t-accent)] border-2 border-[var(--t-accent)] font-semibold text-[16px] cursor-pointer transition-all duration-300 hover:bg-[var(--t-cat-purple-tint)]"
        >
          Create Account
        </button>
      </div>

      {/* Offline link */}
      <div className="mt-[24px] pt-[24px] border-t border-[var(--t-border)]">
        <button
          onClick={onUseOffline}
          className="text-[13px] text-[var(--t-ink-muted)] cursor-pointer transition-colors duration-300 hover:text-[var(--t-accent)] text-center"
        >
          ⚙️ Use Offline — Set up later
        </button>
      </div>
    </div>
  );
}

/**
 * Auth card for sign in screen.
 */
function AuthCard({
  title,
  subtitle,
  methodCount,
  onBack,
  onSubmit,
  submitLabel,
  footerText,
  footerLink,
  onFooterClick,
  busy,
  state,
  showPasskeyNote,
}: {
  title: string;
  subtitle: string;
  methodCount?: string;
  onBack: () => void;
  onSubmit: () => void;
  submitLabel: string;
  footerText: string;
  footerLink: string;
  onFooterClick: () => void;
  busy: boolean;
  state: any;
  showPasskeyNote?: boolean;
}) {
  return (
    <div className="h-full flex items-center justify-center px-[20px]">
      <div className="bg-white w-full max-w-[420px] p-[40px] shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
        {/* Header */}
        <div className="text-center mb-[32px]">
          <h2 className="text-[28px] font-bold font-heading text-[var(--t-ink)] mb-[8px]">
            {title}
          </h2>
          <p className="text-[14px] text-[var(--t-ink-muted)]">{subtitle}</p>
          {methodCount && (
            <p className="text-[12px] text-[var(--t-accent)] font-semibold mt-[10px]">{methodCount}</p>
          )}
        </div>

        {/* Passkey note */}
        {showPasskeyNote && (
          <div className="bg-[var(--t-cat-purple-tint)] border-l-4 border-[var(--t-accent)] px-[16px] py-[12px] text-[13px] text-[var(--t-cat-purple-ink)] mb-[20px] leading-relaxed">
            🔐 Your passkey (security key, fingerprint, or face unlock) is your password. It never leaves your device.
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-[12px] mt-[28px]">
          <button
            onClick={onSubmit}
            disabled={busy}
            className="flex-1 px-[12px] py-[12px] text-white font-semibold text-[16px] cursor-pointer transition-all duration-300 hover:translate-y-[-2px] disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: 'linear-gradient(135deg, var(--t-accent) 0%, var(--t-accent-deep) 100%)' }}
          >
            {submitLabel}
          </button>
          <button
            onClick={onBack}
            disabled={busy}
            className="flex-1 px-[12px] py-[12px] bg-transparent text-[var(--t-accent)] font-semibold text-[16px] cursor-pointer transition-colors duration-300 hover:bg-[var(--t-cat-purple-tint)] disabled:opacity-40 disabled:pointer-events-none"
          >
            Back
          </button>
        </div>

        {/* Status messages */}
        {state.kind === 'busy' && (
          <p className="text-[14px] text-[var(--t-ink-muted)] mt-[20px]">{state.what}</p>
        )}
        {state.kind === 'error' && (
          <p className="text-[14px] text-[var(--t-danger)] mt-[20px]">{state.message}</p>
        )}

        {/* Footer */}
        <div className="text-center mt-[24px] pt-[24px] border-t border-[var(--t-border)]">
          <p className="text-[13px] text-[var(--t-ink-muted)] leading-relaxed">
            {footerText}{' '}
            <button
              onClick={onFooterClick}
              className="text-[var(--t-accent)] font-semibold cursor-pointer hover:underline"
            >
              {footerLink}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Register card with account name and invite fields.
 */
function RegisterCard({
  name,
  setName,
  invite,
  setInvite,
  onBack,
  onSubmit,
  busy,
  state,
  footerLink,
}: {
  name: string;
  setName: (v: string) => void;
  invite: string;
  setInvite: (v: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  busy: boolean;
  state: any;
  footerLink: () => void;
}) {
  return (
    <div className="h-full flex items-center justify-center px-[20px]">
      <div className="bg-white w-full max-w-[420px] p-[40px] shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
        {/* Header */}
        <div className="text-center mb-[32px]">
          <h2 className="text-[28px] font-bold font-heading text-[var(--t-ink)] mb-[8px]">
            Get Started
          </h2>
          <p className="text-[14px] text-[var(--t-ink-muted)]">Create your Albas account</p>
        </div>

        {/* Form fields */}
        <div className="space-y-[20px] mb-[20px]">
          {/* Account name */}
          <div>
            <label className="block text-[13px] font-semibold text-[var(--t-ink)] uppercase tracking-wider mb-[8px]">
              Account Name
            </label>
            <input
              type="text"
              placeholder="letters, digits, - or _"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              className="w-full px-[16px] py-[12px] border-2 border-[var(--t-border)] text-[14px] font-body placeholder:text-[var(--t-ink-muted)] focus:outline-none focus:border-[var(--t-accent)] focus:shadow-[0_0_0_3px_rgba(168,85,247,0.1)] transition-all duration-300"
            />
          </div>

          {/* Invite code */}
          <div>
            <label className="block text-[13px] font-semibold text-[var(--t-ink)] uppercase tracking-wider mb-[8px]">
              Invite Code (Optional)
            </label>
            <input
              type="text"
              placeholder="Leave blank if not required"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              disabled={busy}
              className="w-full px-[16px] py-[12px] border-2 border-[var(--t-border)] text-[14px] font-body placeholder:text-[var(--t-ink-muted)] focus:outline-none focus:border-[var(--t-accent)] focus:shadow-[0_0_0_3px_rgba(168,85,247,0.1)] transition-all duration-300"
            />
          </div>
        </div>

        {/* Passkey note */}
        <div className="bg-[var(--t-cat-purple-tint)] border-l-4 border-[var(--t-accent)] px-[16px] py-[12px] text-[13px] text-[var(--t-cat-purple-ink)] mb-[20px] leading-relaxed">
          🔐 You'll create a passkey to protect your account. No password needed.
        </div>

        {/* Actions */}
        <div className="flex gap-[12px] mt-[28px]">
          <button
            onClick={onSubmit}
            disabled={busy || name.trim() === ''}
            className="flex-1 px-[12px] py-[12px] text-white font-semibold text-[16px] cursor-pointer transition-all duration-300 hover:translate-y-[-2px] disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: 'linear-gradient(135deg, var(--t-accent) 0%, var(--t-accent-deep) 100%)' }}
          >
            Create Account
          </button>
          <button
            onClick={onBack}
            disabled={busy}
            className="flex-1 px-[12px] py-[12px] bg-transparent text-[var(--t-accent)] font-semibold text-[16px] cursor-pointer transition-colors duration-300 hover:bg-[var(--t-cat-purple-tint)] disabled:opacity-40 disabled:pointer-events-none"
          >
            Back
          </button>
        </div>

        {/* Status messages */}
        {state.kind === 'busy' && (
          <p className="text-[14px] text-[var(--t-ink-muted)] mt-[20px]">{state.what}</p>
        )}
        {state.kind === 'error' && (
          <p className="text-[14px] text-[var(--t-danger)] mt-[20px]">{state.message}</p>
        )}

        {/* Footer */}
        <div className="text-center mt-[24px] pt-[24px] border-t border-[var(--t-border)]">
          <p className="text-[13px] text-[var(--t-ink-muted)] leading-relaxed">
            Already have an account?{' '}
            <button
              onClick={footerLink}
              className="text-[var(--t-accent)] font-semibold cursor-pointer hover:underline"
            >
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Offline entry card with warning callout.
 */
function OfflineCard({
  onStart,
  onBack,
  busy,
}: {
  onStart: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  return (
    <div className="h-full flex items-center justify-center px-[20px]">
      <div className="bg-white w-full max-w-[420px] p-[40px] shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
        {/* Header */}
        <div className="text-center mb-[32px]">
          <h2 className="text-[28px] font-bold font-heading text-[var(--t-ink)] mb-[8px]">
            Use Offline
          </h2>
          <p className="text-[14px] text-[var(--t-ink-muted)]">Get started without signing in</p>
        </div>

        {/* Description */}
        <p className="text-[13px] text-[var(--t-ink-muted)] mb-[20px] leading-relaxed">
          Albas works fully offline on your device. Your data stays on your machine unless you set up sync later in Settings.
        </p>

        {/* Warning callout */}
        <div className="bg-[var(--t-cat-amber-tint)] border-l-4 border-[var(--t-cat-amber)] px-[16px] py-[12px] text-[13px] text-[var(--t-warn-ink)] mb-[20px] leading-relaxed">
          ⚠️ <strong>No cloud backup:</strong> Your data is stored locally only. Back up your device regularly.
        </div>

        {/* Actions */}
        <div className="flex gap-[12px] mt-[28px]">
          <button
            onClick={onStart}
            disabled={busy}
            className="flex-1 px-[12px] py-[12px] text-white font-semibold text-[16px] cursor-pointer transition-all duration-300 hover:translate-y-[-2px] disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: 'linear-gradient(135deg, var(--t-accent) 0%, var(--t-accent-deep) 100%)' }}
          >
            Start Using Albas
          </button>
          <button
            onClick={onBack}
            disabled={busy}
            className="flex-1 px-[12px] py-[12px] bg-transparent text-[var(--t-accent)] font-semibold text-[16px] cursor-pointer transition-colors duration-300 hover:bg-[var(--t-cat-purple-tint)] disabled:opacity-40 disabled:pointer-events-none"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
