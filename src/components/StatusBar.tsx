import { forwardRef, useState } from 'react';
import { CircleUser } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { inTauri } from '../persistence';
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
  function StatusItem({ children, ...props }, ref) {
    return (
      <button
        type="button"
        ref={ref}
        {...props}
        className="h-full px-sm flex items-center gap-1.5 text-[11px] leading-none text-txt-faint hover:text-txt hover:bg-fill transition-colors cursor-default select-none"
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
      <AccountItem />
    </footer>
  );
}
