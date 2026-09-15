import { errorMessage } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { inTauri } from '../persistence';
import * as ipc from '../ipc';
import type { SyncStatusInfo } from '../ipc';
import { useBrowserSignIn, usePasswordSignIn } from './auth/signInHooks';
import { normalizeSyncUrl, syncEndpoint } from '../syncServer';
import { AccountSigninCard, ProfileCard, SessionCard, SessionsCard } from './settings/AccountCards';
import { AppearanceCard } from './settings/AppearanceCard';
import { CategoriesCard } from './settings/CategoriesCard';
import { DangerZoneCard } from './settings/DangerZoneCard';
import { ImportCard, SharingCard } from './settings/IntegrationsCards';
import { AboutCard, PreferencesCard, ShortcutsCard } from './settings/misc';
import type { SyncState } from './settings/shared';

export default function Settings() {
  const { setSetting, syncNow, reloadFromStore, syncToken } = useApp();
  const [status, setStatus] = useState<SyncStatusInfo | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({ kind: 'idle' });
  const [token, setToken] = useState('');
  const [manual, setManual] = useState(false);
  // Blank means "use the default server" (`normalizeSyncUrl`), never
  // prefilled from `status.url` — so clearing the field can't read back as
  // whatever custom value was last saved.
  const [url, setUrl] = useState('');

  const available = inTauri();
  const browser = useBrowserSignIn();
  const password = usePasswordSignIn();
  const busy =
    syncState.kind === 'busy' ||
    browser.state.kind === 'starting' ||
    browser.state.kind === 'waiting' ||
    password.state.kind === 'busy';

  useEffect(() => {
    if (!available) return;
    (async () => {
      try {
        setStatus(await ipc.syncStatus());
      } catch {
        // backend not ready
      }
    })();
  }, [available, browser.state.kind, password.state.kind]);

  async function sync() {
    setSyncState({ kind: 'busy', what: 'Syncing' });
    try {
      const out = await syncNow();
      await refreshStatus();
      const parts = [`sent ${out.pushed}`, `received ${out.pulled}`];
      if (out.skipped > 0) parts.push(`${out.skipped} skipped`);
      setSyncState({
        kind: out.skipped > 0 ? 'error' : 'ok',
        message:
          out.skipped > 0
            ? `Synced (${parts.join(', ')}). Skipped rows come from a newer version of Albas.`
            : `Synced - ${parts.join(', ')}.`,
      });
    } catch (err) {
      setSyncState({ kind: 'error', message: errorMessage(err) });
    }
  }

  /**
   * The local-state half of leaving an account, shared by `signOut()` and a
   * successful account deletion — both end with Rust having already cleared
   * the stored token, and the React tree needing to catch up the same way.
   * Order matters: persistence writes go through a serial queue that
   * `reloadFromStore()` does not join, so clearing the flag *before*
   * reloading would race the read-back and be clobbered by the stale '1'.
   * Without this the user is signed out but never returns to the splash,
   * because `welcomeDone` is `__welcome_done || signedIn`.
   */
  async function afterLeavingAccount() {
    await reloadFromStore();
    setSetting('__welcome_done', '0');
    await refreshStatus();
    setToken('');
    setSyncState({ kind: 'idle' });
  }

  async function signOut() {
    try {
      await ipc.syncSignOut();
      await afterLeavingAccount();
    } catch (err) {
      setSyncState({ kind: 'error', message: errorMessage(err) });
    }
  }

  async function refreshStatus() {
    try {
      setStatus(await ipc.syncStatus());
    } catch {
      // backend not ready
    }
  }

  async function connectManually() {
    setSyncState({ kind: 'busy', what: 'Saving' });
    try {
      // Rust owns the token (keyring on desktop) and the signed-in marker;
      // `set_setting` refuses both keys, so this goes through the same
      // adoption path as every other sign-in. React learns of the marker on
      // the reload below.
      await ipc.syncConnectToken(syncEndpoint(normalizeSyncUrl(url)), token);
      setSetting('__welcome_done', '1');
      await reloadFromStore();
      await refreshStatus();
      setSyncState({ kind: 'idle' });
      await sync();
    } catch (err) {
      setSyncState({ kind: 'error', message: errorMessage(err) });
    }
  }

  return (
    <div className="w-full max-w-[75rem] mx-auto">
      <div className="mb-6">
        <h1 className="mb-1.5 font-heading text-[1.375rem] font-bold text-ink">Settings</h1>
        <p className="text-sm text-ink-secondary">Manage your account and preferences</p>
      </div>

      <div className="grid grid-cols-2 items-start gap-5 max-md:grid-cols-1">
        <ProfileCard />

        {status?.configured && (
          <SessionCard syncState={syncState} status={status} onSync={sync} onSignOut={signOut} busy={busy} />
        )}

        <AccountSigninCard
          browser={browser}
          password={password}
          busy={busy}
          token={token}
          setToken={setToken}
          url={url}
          setUrl={setUrl}
          manual={manual}
          setManual={setManual}
          onConnect={connectManually}
          status={status}
          syncToken={syncToken}
        />

        {status?.configured && <SessionsCard status={status} syncToken={syncToken} />}

        <AppearanceCard />

        <CategoriesCard />

        <PreferencesCard />

        <ShortcutsCard />

        <ImportCard />

        <SharingCard />

        <AboutCard />

        <DangerZoneCard onAccountDeleted={afterLeavingAccount} />
      </div>
    </div>
  );
}
