import { useApp } from '../context/AppContext';
import DayPanel from './DayPanel';
import HabitTracker from './HabitTracker';
import TaskList from './TaskList';

export default function RightPanel() {
  const { activeView } = useApp();
  return (
    <aside
      className="fixed right-0 top-16 h-[calc(100%-64px)] w-[280px] z-30 border-l flex flex-col py-md px-sm overflow-y-auto scrollbar-hide"
      style={{ backgroundColor: '#0a121e', borderColor: 'rgba(195,198,215,0.1)' }}
    >
      <DayPanel />
      {activeView !== 'habits' && (
        <>
          <div className="h-px bg-white/10 mx-xs mb-lg flex-shrink-0" />
          <HabitTracker />
        </>
      )}
      {activeView !== 'tasks' && (
        <>
          <div className="h-px bg-white/10 mx-xs mb-lg flex-shrink-0" />
          <TaskList />
        </>
      )}
    </aside>
  );
}
