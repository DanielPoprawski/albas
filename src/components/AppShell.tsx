import { useEffect, useState } from 'react';
import { remindDueHabits } from '../notifications';
import TopBar from './TopBar';
import Sidebar from './Sidebar';
import Calendar from './Calendar';
import RightPanel from './RightPanel';
import AddModal from './AddModal';
import { useApp } from '../context/AppContext';
import TaskList from './TaskList';
import HabitTracker from './HabitTracker';

export default function AppShell() {
  const [showModal, setShowModal] = useState(false);
  const { activeView, habits, loaded } = useApp();

  // Remind about due habits on launch, then re-check periodically so a
  // long-running app still notifies after midnight.
  useEffect(() => {
    if (!loaded) return; // don't notify against empty pre-load state
    remindDueHabits(habits);
    const id = setInterval(() => remindDueHabits(habits), 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [habits, loaded]);

  if (!loaded) return null; // load is a few ms; avoids seed/empty flicker

  return (
    <div className="h-screen overflow-hidden" style={{ backgroundColor: '#0b1c30' }}>
      <TopBar />
      <Sidebar />

      <main className="ml-16 mr-[280px] pt-16 h-screen overflow-hidden">
        <div className="h-full p-md">
          {activeView === 'calendar' && <Calendar />}
          {activeView === 'tasks' && (
            <div className="glass-card rounded-2xl p-md h-full overflow-auto">
              <TaskList />
            </div>
          )}
          {activeView === 'habits' && (
            <div className="glass-card rounded-2xl p-md h-full overflow-auto">
              <HabitTracker />
            </div>
          )}
          {activeView === 'settings' && (
            <div className="flex items-center justify-center h-full">
              <p className="text-outline-variant text-body-md">Settings coming soon</p>
            </div>
          )}
        </div>
      </main>

      <RightPanel />

      {/* Floating Action Button */}
      <button
        onClick={() => setShowModal(true)}
        className="fixed bottom-md z-50 w-14 h-14 bg-primary text-on-primary rounded-full shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all"
        style={{ right: '300px' }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>add</span>
      </button>

      {showModal && <AddModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
