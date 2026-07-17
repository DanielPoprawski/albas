import { useApp } from '../context/AppContext';
import type { ActiveView } from '../types';

const tabs: { label: string; view: ActiveView }[] = [
  { label: 'Calendar', view: 'calendar' },
  { label: 'Tasks', view: 'tasks' },
  { label: 'Habits', view: 'habits' },
];

export default function TopBar() {
  const { activeView, setActiveView } = useApp();

  return (
    <header
      className="fixed top-0 left-0 right-0 h-16 z-40 border-b flex items-center px-margin"
      style={{ backgroundColor: '#0a121e', borderColor: 'rgba(195,198,215,0.1)' }}
    >
      <div className="flex items-center gap-xl ml-16">
        <span className="text-headline-lg font-bold text-primary-fixed-dim">Albas</span>
        <nav className="flex gap-sm">
          {tabs.map(({ label, view }) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={`text-body-sm font-medium px-2 pb-1 cursor-pointer transition-colors ${
                activeView === view
                  ? 'text-primary-fixed-dim font-bold border-b-2 border-primary'
                  : 'text-outline-variant hover:text-on-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
