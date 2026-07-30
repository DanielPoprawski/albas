import { useApp } from '../context/AppContext';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';
import type { ActiveView } from '../types';

/**
 * `mobileLabel` renames Calendar to Home on a phone, where that destination
 * carries the calendar *and* the lists. To-Do has no entry there at all —
 * it's the same content one scroll further down, and a second way in is what
 * produced duplicate lists last time.
 */
const navItems: { icon: string; view: ActiveView; label: string; mobileLabel?: string; mobileOnly?: false; desktopOnly?: boolean }[] = [
  { icon: 'calendar_today', view: 'calendar', label: 'Calendar', mobileLabel: 'Home' },
  { icon: 'checklist', view: 'todos', label: 'To-Do', desktopOnly: true },
  { icon: 'monitor_weight', view: 'weight', label: 'Weight' },
  { icon: 'settings', view: 'settings', label: 'Settings' },
];

interface Props {
  /**
   * 'rail' is the always-visible desktop icon strip. 'drawer' slides in over
   * the content on phones and closes once a destination is picked.
   */
  variant: 'rail' | 'drawer';
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ variant, open = false, onClose }: Props) {
  const { activeView, setActiveView } = useApp();
  const isDrawer = variant === 'drawer';

  function go(view: ActiveView) {
    setActiveView(view);
    onClose?.();
  }

  // the drawer is the phone's nav, so it drops the desktop-only destinations
  const items = navItems.filter(i => !(isDrawer && i.desktopOnly));

  const nav = (
    <nav className={`flex flex-col gap-xs w-full ${isDrawer ? 'px-sm' : 'mt-4 px-base'}`}>
      {items.map(({ icon, view, label: fullLabel, mobileLabel }) => {
        const label = isDrawer ? mobileLabel ?? fullLabel : fullLabel;
        return (
        <button
          key={view}
          title={label}
          onClick={() => go(view)}
          className={`w-full flex items-center rounded-lg cursor-pointer transition-all duration-200 ${
            isDrawer ? 'gap-sm px-sm py-sm' : 'justify-center p-sm hover:translate-x-0.5'
          } ${
            activeView === view
              ? 'bg-primary text-on-primary shadow-lg'
              : 'text-txt-muted hover:bg-fill-strong'
          }`}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontVariationSettings: activeView === view ? "'FILL' 1" : "'FILL' 0" }}
          >
            {icon}
          </span>
          {isDrawer && <span className="text-body-sm font-medium">{label}</span>}
        </button>
        );
      })}
    </nav>
  );

  if (!isDrawer) {
    return (
      <aside className="fixed left-0 top-0 h-full w-16 z-50 border-r border-line bg-chrome flex flex-col items-center pt-20 pb-base gap-xs">
        {nav}
      </aside>
    );
  }

  return (
    // Radix keeps the drawer mounted through its exit animation, so the
    // hand-held scrim-that-stays-click-through trick is no longer needed; it
    // also traps focus inside the drawer, which the old markup did not.
    <Sheet open={open} onOpenChange={next => { if (!next) onClose?.(); }}>
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-64 border-r border-line pt-20 pb-base gap-xs"
      >
        {/* The drawer shows only icons and labels; the title is for screen
            readers, which Radix requires anyway. */}
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        {nav}
      </SheetContent>
    </Sheet>
  );
}
