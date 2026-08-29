import { useState } from 'react';
import { KeyRound, UserPlus, WifiOff } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { inputClass, labelClass } from './forms/shared';
import { usePasskeyAuth } from './auth/usePasskeyAuth';
import PinDialog from './auth/PinDialog';

type Mode = 'menu' | 'signin' | 'create';

const PRIMARY_BTN =
  'px-md py-xs bg-primary text-on-primary rounded-lg font-semibold text-body-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none';
const GHOST_BTN =
  'px-md py-xs rounded-lg font-semibold text-body-sm text-txt-muted border border-line hover:bg-fill-strong transition-colors';

/**
 * First-launch gate, deliberately optional: the app is local-first and stays
 * fully usable offline. Rendered instead of the shell (a plain full-screen
 * element, not a Dialog — a login gate must not be Escape-dismissable while
 * half-done). It unmounts by itself once `welcomeDone` flips, which signing in
 * or "Use offline" both do.
 */
export default function Welcome() {
  const { setSetting } = useApp();
  const auth = usePasskeyAuth();
  const [mode, setMode] = useState<Mode>('menu');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');

  const busy = auth.state.kind === 'busy';

  return (
    <div className="h-screen overflow-y-auto bg-app-bg flex items-center justify-center p-md">
      <div className="w-full max-w-[26rem] p-md rounded-xl bg-fill">
        <h1 className="text-headline-lg font-title font-normal text-txt mb-xs">Albas</h1>
        <p className="text-body-sm text-txt-muted mb-md">
          Calendar, to-dos and habits — yours, on your devices.
        </p>

        {mode === 'menu' && (
          <div className="flex flex-col gap-sm">
            <button onClick={() => setMode('signin')} className={`${PRIMARY_BTN} flex items-center gap-sm justify-center`}>
              <KeyRound size={16} /> Sign in with passkey
            </button>
            <button onClick={() => setMode('create')} className={`${GHOST_BTN} flex items-center gap-sm justify-center`}>
              <UserPlus size={16} /> Create an account
            </button>
            <button
              onClick={() => setSetting('__welcome_done', '1')}
              className="text-[11px] text-txt-muted hover:text-txt transition-colors mt-xs flex items-center gap-xs justify-center"
            >
              <WifiOff size={12} /> Use offline — you can sign in later in Settings
            </button>
          </div>
        )}

        {mode !== 'menu' && (
          <div className="flex flex-col gap-sm">
            {mode === 'create' && (
              <>
                <div>
                  <label className={labelClass}>Account name</label>
                  <input
                    className={inputClass}
                    autoComplete="off"
                    placeholder="letters, digits, - or _"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className={labelClass}>Invite code (only to add a passkey to an account you already have)</label>
                  <input
                    className={inputClass}
                    autoComplete="off"
                    value={invite}
                    onChange={e => setInvite(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </>
            )}

            <p className="text-[11px] text-txt-muted">
              {mode === 'signin'
                ? 'Your passkey — a security key, fingerprint or face unlock — signs you in; there is no password.'
                : 'Your account is protected by a passkey created on this device — a security key, fingerprint or face unlock. No password to remember.'}
            </p>

            <div className="flex gap-sm">
              <button
                onClick={() =>
                  mode === 'signin'
                    ? auth.signIn()
                    : auth.createAccount(name.trim(), invite.trim() || null)
                }
                disabled={busy || (mode === 'create' && name.trim() === '')}
                className={PRIMARY_BTN}
              >
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
              <button onClick={() => setMode('menu')} disabled={busy} className={GHOST_BTN}>
                Back
              </button>
            </div>
          </div>
        )}

        {auth.state.kind === 'busy' && (
          <p className="text-body-sm text-txt-muted mt-md">{auth.state.what}</p>
        )}
        {auth.state.kind === 'error' && (
          <p className="text-body-sm text-danger mt-md">{auth.state.message}</p>
        )}
      </div>

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
