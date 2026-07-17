import { useApp } from '../context/AppContext';
import type { ActiveView } from '../types';

const navItems: { icon: string; view: ActiveView; label: string }[] = [
  { icon: 'calendar_today', view: 'calendar', label: 'Calendar' },
  { icon: 'check_circle', view: 'tasks', label: 'Tasks' },
  { icon: 'repeat', view: 'habits', label: 'Habits' },
  { icon: 'settings', view: 'settings', label: 'Settings' },
];

export default function Sidebar() {
  const { activeView, setActiveView } = useApp();

  return (
    <aside
      className="fixed left-0 top-0 h-full w-16 z-50 border-r flex flex-col items-center pt-20 pb-base gap-xs"
      style={{ backgroundColor: '#0a121e', borderColor: 'rgba(195,198,215,0.1)' }}
    >
      <nav className="flex flex-col gap-xs mt-4 w-full px-base">
        {navItems.map(({ icon, view, label }) => (
          <button
            key={view}
            title={label}
            onClick={() => setActiveView(view)}
            className={`w-full flex items-center justify-center p-sm rounded-lg cursor-pointer transition-all duration-200 hover:translate-x-0.5 ${
              activeView === view
                ? 'bg-primary text-white shadow-lg'
                : 'text-outline-variant hover:bg-white/10'
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontVariationSettings: activeView === view ? "'FILL' 1" : "'FILL' 0" }}
            >
              {icon}
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
