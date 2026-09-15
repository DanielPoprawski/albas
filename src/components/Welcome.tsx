import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useBrowserSignIn, usePasswordSignIn } from './auth/signInHooks';
import PasswordForm from './auth/PasswordForm';
import { SignedOutPanel } from './auth/CrossDevice';
import { Card } from './ui/card';
import { Logo } from './Logo';

type Screen = 'splash' | 'signin' | 'register' | 'offline';

/**
 * Entry point: splash screen + three auth cards (sign in, register, offline).
 * Full-screen gate rendering instead of the app while awaiting welcomeDone.
 *
 * Username + password is the mandatory first credential and runs in-app
 * (`usePasswordSignIn`). Passkeys and Google still live on the public site
 * and are reached through `useBrowserSignIn`; a QR handoff covers signing in
 * with another device (`auth/CrossDevice.tsx`).
 */
export default function Welcome() {
  const { setSetting, seedDemoIfEmpty } = useApp();
  const browser = useBrowserSignIn();
  const password = usePasswordSignIn();
  const [screen, setScreen] = useState<Screen>('splash');

  const leave = (next: Screen) => {
    void browser.cancel();
    password.reset();
    setScreen(next);
  };

  const handleUseOffline = () => {
    setSetting('__welcome_done', '1');
    // The starter to-dos are only ever written here: seeding on load would
    // hand them to whichever account a sign-in from this screen picks.
    seedDemoIfEmpty();
  };

  const busy = browser.state.kind === 'starting' || browser.state.kind === 'waiting' || password.state.kind === 'busy';

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-page to-page-shade">
      {screen === 'splash' && (
        <SplashScreen
          onSignIn={() => setScreen('signin')}
          onCreateAccount={() => setScreen('register')}
          onUseOffline={() => setScreen('offline')}
        />
      )}

      {screen === 'signin' && (
        <AuthCard
          mode="login"
          password={password}
          browser={browser}
          onBack={() => leave('splash')}
          onFooterClick={() => leave('register')}
        />
      )}

      {screen === 'register' && (
        <AuthCard
          mode="register"
          password={password}
          browser={browser}
          onBack={() => leave('splash')}
          onFooterClick={() => leave('signin')}
        />
      )}

      {screen === 'offline' && (
        <OfflineCard onStart={handleUseOffline} onBack={() => setScreen('splash')} busy={busy} />
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
    <div className="h-full flex flex-col items-center justify-center gap-[2.5rem] px-[1.25rem]">
      <div className="text-center max-w-[31.25rem]">
        {/* Logo */}
        <div className="w-[5rem] h-[5rem] mx-auto mb-[1.5rem] flex items-center justify-center text-on-accent font-bold text-5xl font-heading gradient-accent">
          <Logo variant="bw" width={56} height={56} />
        </div>

        {/* Title */}
        <h1 className="text-4xl font-bold font-heading text-ink mb-[0.5rem] tracking-tight">Albas</h1>

        {/* Subtitle */}
        <p className="text-lg text-ink-secondary font-medium mb-[0.75rem]">Productivity Suite</p>

        {/* Description */}
        <p className="text-base text-ink-muted mb-[2.5rem] leading-relaxed">
          Organize your schedule, habits, and tasks in one intuitive workspace. Everything you need to do, in one place.
        </p>
      </div>

      {/* Button stack */}
      <div className="flex flex-col gap-[0.75rem] w-full max-w-[18.75rem]">
        <button
          type="button"
          onClick={onSignIn}
          className="px-[1.5rem] py-[0.75rem] text-on-accent font-semibold text-lg cursor-pointer transition-all duration-300 hover:translate-y-[-2px] hover:shadow-pop shadow-accent gradient-accent"
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={onCreateAccount}
          className="px-[1.5rem] py-[0.75rem] bg-surface text-accent border-2 border-accent font-semibold text-lg cursor-pointer transition-all duration-300 hover:bg-accent-tint"
        >
          Create Account
        </button>
      </div>

      {/* Offline link */}
      <div className="mt-[1.5rem] pt-[1.5rem] border-t border-line">
        <button
          type="button"
          onClick={onUseOffline}
          className="text-sm text-ink-muted cursor-pointer transition-colors duration-300 hover:text-accent text-center"
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
function OfflineCard({ onStart, onBack, busy }: { onStart: () => void; onBack: () => void; busy: boolean }) {
  return (
    <div className="h-full flex items-center justify-center px-[1.25rem]">
      <Card className="border-0 w-full max-w-[26.25rem] p-[2.5rem] shadow-modal">
        {/* Header */}
        <div className="text-center mb-[2rem]">
          <h2 className="text-3xl font-bold font-heading text-ink mb-[0.5rem]">Use Offline</h2>
          <p className="text-base text-ink-muted">Get started without signing in</p>
        </div>

        {/* Description */}
        <p className="text-sm text-ink-muted mb-[1.25rem] leading-relaxed">
          Albas works fully offline on your device. Your data stays on your machine unless you set up sync later in
          Settings.
        </p>

        {/* Warning callout */}
        <div className="bg-warn-tint border-l-4 border-warn px-[1rem] py-[0.75rem] text-sm text-warn-ink mb-[1.25rem] leading-relaxed">
          ⚠️ <strong>No cloud backup:</strong> Your data is stored locally only. Back up your device regularly.
        </div>

        {/* Actions */}
        <div className="flex gap-[0.75rem] mt-[1.75rem]">
          <button
            type="button"
            onClick={onStart}
            disabled={busy}
            className="flex-1 px-[0.75rem] py-[0.75rem] text-on-accent font-semibold text-lg cursor-pointer transition-all duration-300 hover:translate-y-[-2px] disabled:opacity-40 disabled:pointer-events-none gradient-accent"
          >
            Start Using Albas
          </button>
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="flex-1 px-[0.75rem] py-[0.75rem] bg-transparent text-accent font-semibold text-lg cursor-pointer transition-colors duration-300 hover:bg-accent-tint disabled:opacity-40 disabled:pointer-events-none"
          >
            Back
          </button>
        </div>
      </Card>
    </div>
  );
}

/**
 * Sign-in / create-account card. Username + password happen right here, in
 * the app (`usePasswordSignIn`); the browser handoff and the QR flows are
 * the secondary options underneath (`SignedOutPanel`).
 */
function AuthCard({
  mode,
  password,
  browser,
  onBack,
  onFooterClick,
}: {
  mode: 'login' | 'register';
  password: ReturnType<typeof usePasswordSignIn>;
  browser: ReturnType<typeof useBrowserSignIn>;
  onBack: () => void;
  onFooterClick: () => void;
}) {
  const isLogin = mode === 'login';
  const browserBusy = browser.state.kind === 'starting' || browser.state.kind === 'waiting';
  const busy = password.state.kind === 'busy' || browserBusy;

  return (
    <div className="h-full flex items-center justify-center px-[1.25rem] overflow-y-auto">
      <Card className="border-0 w-full max-w-[26.25rem] p-[2.5rem] shadow-modal my-[1.25rem]">
        <div className="text-center mb-[1.5rem]">
          <h2 className="text-3xl font-bold font-heading text-ink mb-[0.5rem]">
            {isLogin ? 'Welcome Back' : 'Get Started'}
          </h2>
          <p className="text-base text-ink-muted">
            {isLogin ? 'Sign in to sync your schedule, habits and tasks' : 'Create your Albas account'}
          </p>
        </div>

        {!browserBusy && (
          <PasswordForm
            mode={mode}
            state={password.state}
            onLogin={(n, p, c, rc) => void password.login(n, p, c, rc)}
            onRegister={(n, p, c) => void password.register(n, p, c)}
            submitClass="w-full px-[0.75rem] py-[0.75rem] text-on-accent font-semibold text-lg cursor-pointer transition-all duration-300 hover:translate-y-[-2px] disabled:opacity-40 disabled:pointer-events-none gradient-accent"
          />
        )}

        {!isLogin && !browserBusy && (
          <p className="text-sm text-ink-muted mt-[0.75rem] leading-relaxed">
            You can add a passkey or an authenticator app afterwards in Settings.
          </p>
        )}

        {isLogin && (
          <div className="mt-[1.25rem] pt-[1.25rem] border-t border-line">
            <SignedOutPanel browser={browser} busy={busy} />
          </div>
        )}

        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="w-full mt-[1rem] px-[0.75rem] py-[0.625rem] bg-transparent text-accent font-semibold text-base cursor-pointer transition-colors duration-300 hover:bg-accent-tint disabled:opacity-40 disabled:pointer-events-none"
        >
          Back
        </button>

        <div className="text-center mt-[1rem] pt-[1rem] border-t border-line">
          <p className="text-sm text-ink-muted leading-relaxed">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={onFooterClick}
              disabled={busy}
              className="text-accent font-semibold cursor-pointer hover:underline disabled:opacity-40"
            >
              {isLogin ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </div>
      </Card>
    </div>
  );
}
