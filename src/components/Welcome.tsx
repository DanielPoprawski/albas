import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useBrowserSignIn, type BrowserSignInState } from './auth/useBrowserSignIn';

type Screen = 'splash' | 'signin' | 'register' | 'offline';

/**
 * Entry point: splash screen + three auth cards (sign in, register, offline).
 * Full-screen gate rendering instead of the app while awaiting welcomeDone.
 *
 * Sign-in and account creation both happen in the system browser now — see
 * `useBrowserSignIn` — since passkeys, password + TOTP and (later) Google
 * OAuth all live on the public site rather than an in-app WebAuthn ceremony.
 */
export default function Welcome() {
  const { setSetting } = useApp();
  const browser = useBrowserSignIn();
  const [screen, setScreen] = useState<Screen>('splash');

  const handleUseOffline = () => {
    setSetting('__welcome_done', '1');
  };

  const busy = browser.state.kind === 'starting' || browser.state.kind === 'waiting';

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-[var(--t-page)] to-[var(--t-page-shade)]">
      {screen === 'splash' && (
        <SplashScreen
          onSignIn={() => setScreen('signin')}
          onCreateAccount={() => setScreen('register')}
          onUseOffline={() => setScreen('offline')}
        />
      )}

      {screen === 'signin' && (
        <BrowserAuthCard
          mode="login"
          state={browser.state}
          onStart={() => void browser.start('login')}
          onCancel={() => void browser.cancel()}
          onBack={() => {
            void browser.cancel();
            setScreen('splash');
          }}
          onFooterClick={() => setScreen('register')}
        />
      )}

      {screen === 'register' && (
        <BrowserAuthCard
          mode="register"
          state={browser.state}
          onStart={() => void browser.start('register')}
          onCancel={() => void browser.cancel()}
          onBack={() => {
            void browser.cancel();
            setScreen('splash');
          }}
          onFooterClick={() => setScreen('signin')}
        />
      )}

      {screen === 'offline' && (
        <OfflineCard
          onStart={handleUseOffline}
          onBack={() => setScreen('splash')}
          busy={busy}
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

/**
 * Sign-in / create-account card for the browser flow. The ceremony happens
 * on the public site (login or register screen, picked by `mode`), so this
 * card's job is to open it, show the code that proves the page belongs to
 * *this* request, and let the user give up.
 */
function BrowserAuthCard({
  mode,
  state,
  onStart,
  onCancel,
  onBack,
  onFooterClick,
}: {
  mode: 'login' | 'register';
  state: BrowserSignInState;
  onStart: () => void;
  onCancel: () => void;
  onBack: () => void;
  onFooterClick: () => void;
}) {
  const waiting = state.kind === 'waiting';
  const busy = waiting || state.kind === 'starting';
  const isLogin = mode === 'login';

  return (
    <div className="h-full flex items-center justify-center px-[20px]">
      <div className="bg-white w-full max-w-[420px] p-[40px] shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
        <div className="text-center mb-[32px]">
          <h2 className="text-[28px] font-bold font-heading text-[var(--t-ink)] mb-[8px]">
            {isLogin ? 'Welcome Back' : 'Get Started'}
          </h2>
          <p className="text-[14px] text-[var(--t-ink-muted)]">
            {waiting
              ? `Finish ${isLogin ? 'signing in' : 'creating your account'} in your browser`
              : isLogin
                ? 'Sign in through your browser'
                : 'Create your account in your browser'}
          </p>
        </div>

        {waiting ? (
          <div className="bg-[var(--t-cat-purple-tint)] border-l-4 border-[var(--t-accent)] px-[16px] py-[12px] text-[13px] text-[var(--t-cat-purple-ink)] mb-[20px] leading-relaxed">
            Your browser should show this code:
            <div className="text-[28px] font-bold font-heading tracking-[0.3em] my-[8px]">
              {state.code}
            </div>
            If it shows a different code, cancel here — that request was started somewhere else.
          </div>
        ) : (
          <div className="bg-[var(--t-cat-purple-tint)] border-l-4 border-[var(--t-accent)] px-[16px] py-[12px] text-[13px] text-[var(--t-cat-purple-ink)] mb-[20px] leading-relaxed">
            🔐 Your browser handles passkeys, passwords and two-factor codes, so you can use whichever you set up.
          </div>
        )}

        <div className="flex gap-[12px] mt-[28px]">
          <button
            onClick={waiting ? onCancel : onStart}
            disabled={state.kind === 'starting'}
            className="flex-1 px-[12px] py-[12px] text-white font-semibold text-[16px] cursor-pointer transition-all duration-300 hover:translate-y-[-2px] disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: 'linear-gradient(135deg, var(--t-accent) 0%, var(--t-accent-deep) 100%)' }}
          >
            {waiting ? 'Cancel' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
          <button
            onClick={onBack}
            disabled={state.kind === 'starting'}
            className="flex-1 px-[12px] py-[12px] bg-transparent text-[var(--t-accent)] font-semibold text-[16px] cursor-pointer transition-colors duration-300 hover:bg-[var(--t-cat-purple-tint)] disabled:opacity-40 disabled:pointer-events-none"
          >
            Back
          </button>
        </div>

        {state.kind === 'starting' && (
          <p className="text-[14px] text-[var(--t-ink-muted)] mt-[20px]">Opening your browser…</p>
        )}
        {state.kind === 'waiting' && (
          <p className="text-[14px] text-[var(--t-ink-muted)] mt-[20px]">Waiting for your browser…</p>
        )}
        {state.kind === 'error' && (
          <p className="text-[14px] text-[var(--t-danger)] mt-[20px]">{state.message}</p>
        )}

        <div className="text-center mt-[24px] pt-[24px] border-t border-[var(--t-border)]">
          <p className="text-[13px] text-[var(--t-ink-muted)] leading-relaxed">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={onFooterClick}
              disabled={busy}
              className="text-[var(--t-accent)] font-semibold cursor-pointer hover:underline disabled:opacity-40"
            >
              {isLogin ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
