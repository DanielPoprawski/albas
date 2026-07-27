import { useEffect, useState } from 'react';
import { remindDueEvents, remindDueTodos } from '../notifications';
import TopBar from './TopBar';
import Sidebar from './Sidebar';
import Calendar from './Calendar';
import RightPanel from './RightPanel';
import AddModal from './AddModal';
import TodoPanel from './TodoPanel';
import WeightPanel from './WeightPanel';
import Settings from './Settings';
import { useApp } from '../context/AppContext';
import { useIsMobile } from '../useMedia';

export default function AppShell() {
  const [showModal, setShowModal] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useIsMobile();
  const { activeView, todos, events, loaded, firstDayOfWeek } = useApp();

  // Remind about due to-dos and upcoming events on launch, then re-check
  // periodically. 5-minute cadence so short event offsets (10 min) can't
  // fall between polls; to-do reminders self-dedupe to once a day.
  useEffect(() => {
    if (!loaded) return; // don't notify against empty pre-load state
    const check = () => {
      remindDueTodos(todos, firstDayOfWeek);
      remindDueEvents(events);
    };
    check();
    const id = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [todos, events, loaded, firstDayOfWeek]);

  if (!loaded) return null; // load is a few ms; avoids seed/empty flicker

  return (
    <div className="h-screen overflow-hidden bg-app-bg">
      <TopBar isMobile={isMobile} onOpenDrawer={() => setDrawerOpen(true)} />
      <Sidebar
        variant={isMobile ? 'drawer' : 'rail'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Desktop keeps the three-pane frame; mobile drops the rail offset and
          the right panel, whose two sections become drawer destinations. */}
      <main
        className={`pt-16 h-screen overflow-hidden ${isMobile ? '' : 'ml-16 mr-[280px]'}`}
      >
        {/* The calendar goes edge-to-edge on phones; the list views keep their
            own padding now that the glass-card wrappers are gone. */}
        <div
          className={`h-full ${
            isMobile ? (activeView === 'calendar' ? 'p-0' : 'p-sm') : 'p-md'
          }`}
        >
          {activeView === 'calendar' && <Calendar isMobile={isMobile} />}
          {activeView === 'todos' && (
            <div className="h-full overflow-auto scrollbar-hide">
              <TodoPanel />
            </div>
          )}
          {activeView === 'weight' && <WeightPanel />}
          {activeView === 'settings' && <Settings />}
        </div>
      </main>

      {!isMobile && <RightPanel />}

      {/* Floating Action Button. On desktop it clears the 280px right panel;
          on mobile it sits above the gesture bar. */}
      <button
        onClick={() => setShowModal(true)}
        className="fixed z-50 w-14 h-14 bg-primary text-on-primary rounded-full shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all"
        style={
          isMobile
            ? { right: 20, bottom: 'calc(20px + env(safe-area-inset-bottom))' }
            : { right: 300, bottom: 24 }
        }
      >
        <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>add</span>
      </button>

      {showModal && (
        <AddModal
          defaultType={activeView === 'calendar' ? 'event' : 'todo'}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
