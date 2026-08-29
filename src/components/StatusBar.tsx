import { forwardRef, useEffect, useState } from 'react';
import { CircleUser, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { stampLabel, timeAgo } from '../dates';
import { inTauri } from '../persistence';
import { cn } from '../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

/**
 * Height of the desktop status bar, in pixels. Exported because two other
 * layouts have to reserve it: the main content column's bottom padding and the
 * sidebar rail's height. Keep them in step through this constant rather than
 * repeating a literal.
 */
export const STATUS_BAR_H = 28;

/**
 * One module in the bar. Obsidian's are small, muted, and only announce
 * themselves on hover — the bar is a place to *glance*, never the main UI. A
 * module is a plain button unless it opens a drop-up, in which case the caller
 * wraps it in a `DropdownMenuTrigger asChild`. `forwardRef` is load-bearing for
 * that: Radix's `asChild` anchors its popper on the child's ref, and React 18
 * drops a ref passed to a plain function component — the menu then opens
 * nowhere and the trigger looks dead.
 */
const StatusItem = forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
  function StatusItem({ children, className, ...props }, ref) {
    return (
      <button
        type="button"
        ref={ref}
        {...props}
        className={cn(
          'h-full px-sm flex items-center gap-1.5 text-[11px] leading-none text-txt-faint hover:text-txt hover:bg-fill transition-colors cursor-default select-none',
          className
        )}
      >
        {children}
      </button>
    );
  }
);

/** The signed-in account, with a drop-up for the things you'd do to it. */
function AccountItem() {
  const { signedIn, syncAccount, setActiveView, reloadFromStore } = useApp();
  const [busy, setBusy] = useState(false);

  // Token-only setups sync perfectly well but have no account name to show —
  // the server identifies the device by its token alone (see sync.rs).
  const label = signedIn ? syncAccount ?? 'Sync token' : 'Not signed in';

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('sync_sign_out');
      // Rust cleared credentials and the shared cache underneath React.
      await reloadFromStore();
    } catch {
      // Settings → Account & sync is the surface that reports errors; the bar
      // has no room for a message, and the state it shows is re-derived anyway.
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <StatusItem title={signedIn ? `Signed in as ${label}` : 'Not signed in'}>
          <CircleUser size={13} strokeWidth={1.8} />
          <span className="max-w-[14rem] truncate">{label}</span>
        </StatusItem>
      </DropdownMenuTrigger>

      {/* A drop-up: the bar is pinned to the bottom edge, so `side="top"` is
          the only direction with room. */}
      <DropdownMenuContent side="top" align="end" sideOffset={6} className="min-w-[11rem]">
        <DropdownMenuLabel className="text-[11px] font-normal text-txt-faint">
          {signedIn ? 'Signed in as' : 'Account'}
        </DropdownMenuLabel>
        <DropdownMenuLabel className="pt-0 truncate">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setActiveView('settings')}>
          {signedIn ? 'Account settings' : 'Sign in…'}
        </DropdownMenuItem>
        {signedIn && inTauri() && (
          <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => { void signOut(); }}>
            Sign out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Last sync, and the button that runs one. Two readings of the same instant
 * because they answer different questions: the clock time says *which* sync
 * this was (the one before lunch, the one after the phone edit), and "5m ago"
 * says whether it is recent enough to trust without doing anything. The stamp
 * drops its date on the day it happened — see `stampLabel`.
 *
 * Only rendered when credentials exist: with no account there is nothing to
 * sync with, and a permanently dead button next to "Not signed in" would say
 * less than the account module already does.
 */
function SyncItem() {
  const { signedIn, lastSync, syncing, syncNow } = useApp();
  const [failed, setFailed] = useState(false);
  // Re-render on a timer so "5m ago" ages on its own. Half a minute keeps the
  // first minute honest without being a clock; nothing here reads the network.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!signedIn || !inTauri()) return null;

  async function sync() {
    if (syncing) return;
    setFailed(false);
    try {
      await syncNow();
    } catch {
      // The bar has room for a word, not a reason. Settings → Account & sync
      // runs the same call and reports what actually went wrong.
      setFailed(true);
    }
  }

  const label = syncing
    ? 'Syncing…'
    : failed
      ? 'Sync failed'
      : lastSync === null
        ? 'Never synced'
        : `${stampLabel(lastSync, now)} · ${timeAgo(lastSync, now)}`;

  const title = failed
    ? 'Sync failed — open Settings → Account & sync for the reason'
    : lastSync === null
      ? 'Sync now — this device has not synced yet'
      : `Last synced ${new Date(lastSync).toLocaleString()} — click to sync now`;

  return (
    <StatusItem
      title={title}
      onClick={() => { void sync(); }}
      className={failed ? 'text-danger' : undefined}
    >
      <RefreshCw size={12} strokeWidth={1.8} className={syncing ? 'animate-spin' : undefined} />
      <span>{label}</span>
    </StatusItem>
  );
}

/**
 * The running version, injected by Vite from package.json (see `define` in
 * vite.config.ts). Clicking it opens Settings, where the About card shows the
 * same number with the platform beside it — a module that did nothing on click
 * would be the only dead control in the bar.
 */
function VersionItem() {
  const { setActiveView } = useApp();
  return (
    <StatusItem
      title={`Albas v${__APP_VERSION__} — open Settings`}
      onClick={() => setActiveView('settings')}
    >
      <span>v{__APP_VERSION__}</span>
    </StatusItem>
  );
}

/**
 * Desktop-only bar across the whole bottom edge, in the spirit of Obsidian's:
 * one continuous strip of chrome — it runs under the sidebar rail too, which
 * is why the rail stops short of it rather than this bar stopping short of the
 * rail — carrying small modules at either end. Anything added later goes in
 * the same row; `justify-between` splits it, so a third module needs a
 * grouping element rather than just being appended.
 *
 * There is no mobile equivalent: a phone already spends its bottom edge on the
 * FAB and the system gesture bar, and `AppShell` simply doesn't mount this.
 */
export default function StatusBar() {
  return (
    <footer
      style={{ height: STATUS_BAR_H }}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-line bg-chrome flex items-center justify-between"
    >
      <VersionItem />
      {/* `justify-between` splits the bar in two, so the right-hand modules
          need this wrapper rather than being appended as siblings. */}
      <div className="h-full flex items-center">
        <SyncItem />
        <AccountItem />
      </div>
    </footer>
  );
}
