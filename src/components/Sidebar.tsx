import { useApp } from '../context/AppContext';
import type { ActiveView } from '../types';

const navItems: { icon: string; view: ActiveView; label: string }[] = [
  { icon: 'calendar_today', view: 'calendar', label: 'Calendar' },
  { icon: 'checklist', view: 'todos', label: 'To-Do' },
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

  const nav = (
    <nav className={`flex flex-col gap-xs w-full ${isDrawer ? 'px-sm' : 'mt-4 px-base'}`}>
      {navItems.map(({ icon, view, label }) => (
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
      ))}
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
    <>
      {/* Scrim stays mounted but click-through when closed, so the drawer can
          animate out instead of vanishing with it. */}
      <div
        onClick={onClose}
        aria-hidden={!open}
        className={`fixed inset-0 z-[55] bg-scrim transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        className={`fixed left-0 top-0 h-full w-64 z-[56] border-r border-line bg-chrome flex flex-col pt-20 pb-base transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {nav}
      </aside>
    </>
  );
}
