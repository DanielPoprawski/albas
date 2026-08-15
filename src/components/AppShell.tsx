import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { remindDueEvents, remindDueTodos } from '../notifications';
import TopBar from './TopBar';
import Sidebar from './Sidebar';
import Calendar from './Calendar';
import HomeView from './HomeView';
import RightPanel from './RightPanel';
import AddModal from './AddModal';
import TodoPanel from './TodoPanel';
import WeightPanel from './WeightPanel';
import Settings from './Settings';
import Welcome from './Welcome';
import { useApp } from '../context/AppContext';
import { inTauri } from '../persistence';
import { useIsMobile } from '../useMedia';

function Fab({ onClick, className, style }: {
  onClick: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      aria-label="Add"
      style={style}
      className={`z-40 w-14 h-14 bg-primary text-on-primary rounded-full shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all ${className ?? ''}`}
    >
      <Plus size={28} strokeWidth={2.5} />
    </button>
  );
}

export default function AppShell() {
  const [showModal, setShowModal] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useIsMobile();
  const { activeView, calendarMode, todos, events, loaded, welcomeDone, firstDayOfWeek } = useApp();

  // Only the desktop month grid sizes itself; week/day fill the space as before
  const monthGridDesktop = !isMobile && activeView === 'calendar' && calendarMode === 'month';

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
  // Accounts are a Tauri-only feature (the browser dev server has no sync), so
  // the gate never appears there. Dismissing it or signing in flips welcomeDone.
  if (inTauri() && !welcomeDone) return <Welcome />;

  return (
    <div className="h-screen overflow-hidden bg-app-bg">
      <TopBar isMobile={isMobile} onOpenDrawer={() => setDrawerOpen(true)} />
      <Sidebar
        variant={isMobile ? 'drawer' : 'rail'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Desktop is a flex row so the right panel can absorb whatever the
          calendar doesn't need; mobile drops the rail offset and the panel
          entirely, since Home already carries both lists. */}
      <main
        className={`pt-16 h-screen overflow-hidden ${isMobile ? '' : 'ml-16 flex'}`}
      >
        {/* The calendar goes edge-to-edge on phones; the list views keep their
            own padding now that the glass-card wrappers are gone.

            `flex-none` for the desktop month grid is load-bearing: that grid
            sets its own width from its height to keep 3:2 day cells, and a
            flex-1 column would stretch past it and strand the leftover space
            instead of handing it to the panel. */}
        <div
          className={`h-full ${
            isMobile
              ? (activeView === 'calendar' ? 'p-0' : 'p-sm')
              : `relative p-md min-w-0 ${monthGridDesktop ? 'flex-none' : 'flex-1'}`
          }`}
        >
          {/* On a phone 'calendar' is the home page: the calendar with habits
              and tasks stacked under it. There is no separate to-do
              destination there — one list surface, as on desktop. Home also
              absorbs 'todos', so narrowing a desktop window while that view is
              open lands somewhere real instead of on a blank screen. */}
          {(activeView === 'calendar' || (isMobile && activeView === 'todos')) &&
            (isMobile ? <HomeView /> : <Calendar />)}
          {/* No habits here — this view is the to-dos, and the habit strips
              live beside the calendar (see RightPanel). Capped rather than
              full-bleed, too: without the panel beside it a to-do row would
              stretch the width of the monitor, stranding its due label a foot
              away from its name. */}
          {activeView === 'todos' && !isMobile && (
            <div className="h-full overflow-auto scrollbar-hide max-w-[46rem]">
              <TodoPanel />
            </div>
          )}
          {activeView === 'weight' && <WeightPanel />}
          {activeView === 'settings' && <Settings />}

          {/* Desktop FAB sits inside the content column, so it follows the
              calendar's edge instead of a hardcoded offset — the right panel's
              width is no longer fixed. */}
          {!isMobile && <Fab onClick={() => setShowModal(true)} className="absolute right-md bottom-md" />}
        </div>

        {/* Calendar only. Everywhere else the panel was a second copy of a
            list the main view already owns — or, in Settings and Weight, a
            list with nothing to do with what's on screen. */}
        {!isMobile && activeView === 'calendar' && <RightPanel />}
      </main>

      {/* On mobile it floats above the gesture bar. */}
      {isMobile && (
        <Fab
          onClick={() => setShowModal(true)}
          className="fixed z-50"
          style={{ right: 20, bottom: 'calc(20px + env(safe-area-inset-bottom))' }}
        />
      )}

      {showModal && (
        <AddModal
          defaultType={activeView === 'calendar' ? 'event' : 'todo'}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
