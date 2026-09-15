import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LayoutGrid, ListChecks, Settings as SettingsIcon, Target } from 'lucide-react';
import { remindDueEvents, remindDueTodos } from '../notifications';
import MonthView from './calendar/MonthView';
import WeekView from './calendar/WeekView';
import DayView from './calendar/DayView';
import HomeView from './HomeView';
import RightPanel from './RightPanel';
import TodoViewRedesign from './TodoViewRedesign';
import HabitsView from './HabitsView';
import Settings from './Settings';
import Welcome from './Welcome';
import AddModal from './AddModal';
import ResizeHandle from './ResizeHandle';
import { Logo } from './Logo';
import { LAYOUT_LIMITS, clampRem } from '../appearance';
import { goToday, stepMonth, stepYear } from '../calendarNav';
import { useApp } from '../context/AppContext';
import { fmt, stampLabel, timeAgo } from '../dates';
import { cn, initialsOf } from '@/lib/utils';
import { inTauri } from '../persistence';
import { useIsMobile } from '../useMedia';
import { useEditorMode, useShortcuts } from '../shortcuts';
import SidebarCategories from './sidebar/SidebarCategories';
import type { ActiveView, AddType } from '../types';

/**
 * The four destinations the redesign's sidebar has. They are the shell's own
 * vocabulary rather than `ActiveView`'s: Habits is a new screen (package 04)
 * that the stored view type doesn't name yet, and Dashboard/To-Do read better
 * here than the old calendar/todos.
 */
type Route = 'dashboard' | 'todo' | 'habits' | 'settings';

/** Route → the stored view. */
const VIEW_OF: Record<Route, ActiveView> = {
  dashboard: 'calendar',
  todo: 'todos',
  habits: 'habits',
  settings: 'settings',
};

/** The stored view → this shell's route. */
function routeOf(view: ActiveView): Route {
  if (view === 'todos') return 'todo';
  if (view === 'habits') return 'habits';
  if (view === 'settings') return 'settings';
  return 'dashboard';
}

/* ── Sidebar ─────────────────────────────────────────────────────────────*/

/** A titled group of rows inside the sidebar (Menu, the page's slot). */
const SIDEBAR_SECTION = 'flex flex-col gap-2';

/**
 * The full-width content column: a padded, independently scrolling flex child
 * of the content slot. 2rem, dropping to 1.25rem under the breakpoint.
 */
const MAIN_COLUMN = 'min-w-0 flex-1 overflow-y-auto p-8 max-md:p-5';

const NAV: { route: Route; label: string; icon: ReactNode }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: <LayoutGrid size="1rem" /> },
  { route: 'todo', label: 'To-Dos', icon: <ListChecks size="1rem" /> },
  { route: 'habits', label: 'Habits', icon: <Target size="1rem" /> },
  { route: 'settings', label: 'Settings', icon: <SettingsIcon size="1rem" /> },
];

/** The three content screens; Settings is drawn on its own at the foot of the sidebar. */
const CONTENT_NAV = NAV.filter((n) => n.route !== 'settings');
const SETTINGS_NAV = NAV[NAV.length - 1];

function NavLink({
  item,
  current,
  onNavigate,
}: {
  item: (typeof NAV)[number];
  current: Route;
  onNavigate: (r: Route) => void;
}) {
  const { route, label, icon } = item;
  return (
    // Real anchors, so a destination has a hover target, a focus ring
    // and a middle-click affordance. The href is the hash the route
    // would have if this app ever grows a router; navigation itself is
    // still state, hence the preventDefault.
    <a
      href={`#/${route}`}
      aria-current={current === route ? 'page' : undefined}
      className={`sidebar-item${current === route ? ' active' : ''}`}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(route);
      }}
    >
      {icon}
      {label}
    </a>
  );
}

function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (route: Route) => void }) {
  return (
    <aside className="sidebar max-md:hidden">
      <div className="flex items-center gap-2 font-heading text-base font-bold text-ink">
        <span className="gradient-accent text-on-accent flex size-5 shrink-0 items-center justify-center font-heading text-xs font-bold">
          {/* The app mark, drawn rather than lettered — same glyph as
              public/icons/albas-mark-glyph.svg, in white on the purple square. */}
          <Logo variant="bw" width={20} height={20} aria-hidden="true" />
        </span>
        Albas
      </div>

      <div className={SIDEBAR_SECTION}>
        <div className="sidebar-title">Menu</div>
        {CONTENT_NAV.map((item) => (
          <NavLink key={item.route} item={item} current={route} onNavigate={onNavigate} />
        ))}
      </div>

      {/* Categories sit directly under the screens they filter, on every route. */}
      <div className={SIDEBAR_SECTION}>
        <SidebarCategories showCompletedRow={route === 'todo'} />
      </div>

      <div className={cn(SIDEBAR_SECTION, 'mt-auto')}>
        <NavLink item={SETTINGS_NAV} current={route} onNavigate={onNavigate} />
      </div>
    </aside>
  );
}

/* ── Bottom taskbar ──────────────────────────────────────────────────────*/

/**
 * The strip along the bottom edge: version on the left, sync state and the
 * account on the right. Identical on every route — it belongs to the shell,
 * not to any screen.
 */
function BottomBar() {
  const { signedIn, syncAccount, lastSync, syncing, syncNow, mode } = useApp();
  // Re-render on a timer so "5m ago" ages on its own without a sync running.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const canSync = signedIn && inTauri();
  const label = syncing
    ? 'Syncing…'
    : lastSync
      ? `${stampLabel(lastSync, now)} · ${timeAgo(lastSync, now)}`
      : canSync
        ? 'Never synced'
        : 'Not signed in';

  const name = syncAccount ?? (signedIn ? 'Sync token' : 'Local');

  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-t border-line bg-surface px-4 text-xs text-ink-secondary max-md:hidden">
      <div className="flex items-center gap-3">
        {/* Vim-style statusline: NORMAL = the single-key shortcuts are live,
            INSERT = an input has the keyboard, VISUAL = items are selected. */}
        <span
          className={cn(
            'micro-label px-1.5 py-0.5',
            mode === 'INSERT' && 'bg-accent text-on-accent',
            mode === 'VISUAL' && 'bg-selection text-selection-ink',
            mode === 'NORMAL' && 'bg-subtle text-ink-secondary',
          )}
          aria-live="polite"
        >
          {mode}
        </span>
        <span className="font-semibold text-ink">v{__APP_VERSION__}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1.5 hover:text-accent"
          disabled={!canSync || syncing}
          title={canSync ? 'Sync now' : 'Sync is off until an account is set up'}
          onClick={() => {
            // The bar has room for a word, not a reason; Settings → Account &
            // sync runs the same call and reports what went wrong.
            if (canSync && !syncing) void syncNow().catch(() => {});
          }}
        >
          <span aria-hidden="true">↻</span>
          {label}
        </button>
        <span className="h-3.5 w-px bg-line" />
        <span className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center bg-accent text-xs font-semibold text-on-accent">
            {initialsOf(name)}
          </span>
          {name}
        </span>
      </div>
    </div>
  );
}

/* ── Shell ───────────────────────────────────────────────────────────────*/

export default function AppShell() {
  const isMobile = useIsMobile();
  const {
    activeView,
    setActiveView,
    calendarMode,
    todos,
    events,
    loaded,
    welcomeDone,
    firstDayOfWeek,
    selectedDate,
    setSelectedDate,
    setCurrentMonth,
    getSetting,
    setSetting,
    setInserting,
    setSelectedKeys,
  } = useApp();
  const calNav = { setCurrentMonth, setSelectedDate };

  // The shell's own route. Seeded from the persisted view and re-derived
  // whenever something else changes it (Settings links, the account menu),
  // but held locally as well because Habits has no ActiveView to store.
  const [route, setRoute] = useState<Route>(() => routeOf(activeView));
  useEffect(() => setRoute(routeOf(activeView)), [activeView]);

  function navigate(next: Route) {
    setRoute(next);
    setActiveView(VIEW_OF[next]);
  }

  // The bottom bar's mode: INSERT while something editable has the keyboard.
  useEditorMode(setInserting);
  // A selection belongs to the list it was made in.
  useEffect(() => setSelectedKeys(new Set()), [route]);

  // Ctrl+N's target, owned here rather than threaded through every screen so
  // it works no matter which route is active — `AddModal` itself already
  // knows how to render standalone (see the calendar day-click callers).
  const [addRequest, setAddRequest] = useState<{ type: AddType; date?: string } | null>(null);

  // Drag state for the sidebar's resize handle — same pattern as
  // RightPanel's: a ref (no per-pixel re-render), the var written straight
  // onto <html> during the drag, `setSetting` only when the drag ends.
  const dragSidebarRem = useRef<number | null>(null);

  function commitSidebarWidth() {
    if (dragSidebarRem.current === null) return;
    setSetting('__layout_sidebar_w', String(dragSidebarRem.current));
    dragSidebarRem.current = null;
  }

  function handleSidebarDelta(deltaPx: number) {
    if (dragSidebarRem.current === null) {
      const stored = parseFloat(getSetting('__layout_sidebar_w') ?? '');
      dragSidebarRem.current = Number.isFinite(stored) ? stored : LAYOUT_LIMITS.sidebar.def;
    }
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    // The handle sits on the sidebar's *right* edge, so dragging right (a
    // positive clientX delta) widens it.
    dragSidebarRem.current = clampRem(
      dragSidebarRem.current + deltaPx / remPx,
      LAYOUT_LIMITS.sidebar.min,
      LAYOUT_LIMITS.sidebar.max,
    );
    document.documentElement.style.setProperty('--layout-sidebar-w', `${dragSidebarRem.current}rem`);
  }

  function handleSidebarReset() {
    dragSidebarRem.current = null;
    document.documentElement.style.removeProperty('--layout-sidebar-w');
    setSetting('__layout_sidebar_w', '');
  }

  useShortcuts({
    newItem() {
      const date = selectedDate ?? fmt(new Date());
      if (route === 'dashboard') setAddRequest({ type: 'event', date });
      else if (route === 'todo') setAddRequest({ type: 'task', date });
      else if (route === 'habits') setAddRequest({ type: 'habit', date });
      // settings: no item to create.
    },
    navigate(target) {
      navigate(target);
    },
    // The calendar keys only mean something on the calendar screen.
    calendarToday() {
      if (route === 'dashboard') goToday(calNav);
    },
    calendarStepMonth(dir) {
      if (route === 'dashboard') stepMonth(calNav, dir);
    },
    calendarStepYear(dir) {
      if (route === 'dashboard') stepYear(calNav, dir);
    },
  });

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
    <div className="flex h-screen flex-col">
      <div className="flex flex-1 overflow-hidden max-md:flex-col">
        <Sidebar route={route} onNavigate={navigate} />

        <ResizeHandle
          side="right"
          onDelta={handleSidebarDelta}
          onEnd={commitSidebarWidth}
          onReset={handleSidebarReset}
          ariaLabel="Resize sidebar"
        />

        {/* The content slot. A flex row, so a two-column screen is simply two
            children of it; single-column screens fill it. */}
        <div className="flex min-w-0 flex-1 overflow-hidden bg-surface max-md:flex-col">
          {/* Under 768px the sidebar and the bottom bar are both display:none
                — HomeView brings its own header and tab bar, which is the whole
                of the mobile chrome. That leaves every other route with no way
                back, including a cold start whose persisted view was Settings,
                so those routes get an explicit back bar here. It lives in the
                shell rather than in each screen because it is the shell's
                navigation that went missing. */}
          {isMobile && route !== 'dashboard' && (
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-2">
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-accent"
                onClick={() => navigate('dashboard')}
              >
                <span aria-hidden="true">←</span> Dashboard
              </button>
              {/* mr-18 balances the back button so the title sits centred in the bar. */}
              <span className="mr-18 flex-1 text-center font-heading text-sm font-bold text-ink">
                {NAV.find((n) => n.route === route)?.label}
              </span>
            </div>
          )}

          {route === 'dashboard' &&
            (isMobile ? (
              <HomeView />
            ) : (
              // No navigation row here: the desktop header lives in MonthViewDesktop.
              <div className="flex flex-col h-full min-h-0 bg-surface">
                {calendarMode === 'month' && <MonthView />}
                {calendarMode === 'week' && <WeekView />}
                {calendarMode === 'day' && <DayView />}
              </div>
            ))}
          {route === 'dashboard' && !isMobile && <RightPanel />}

          {route === 'todo' && <TodoViewRedesign />}

          {/* Package 04 owns this screen; the shell only routes to it. */}
          {route === 'habits' && <HabitsView />}

          {route === 'settings' && (
            <div className={MAIN_COLUMN}>
              <Settings />
            </div>
          )}
        </div>
      </div>

      <BottomBar />

      {/* Ctrl+N's modal — mounted at the shell so it works from any route,
          not just the routes that already render their own AddModal for a
          day click or an edit. */}
      {addRequest && (
        <AddModal defaultType={addRequest.type} defaultDate={addRequest.date} onClose={() => setAddRequest(null)} />
      )}
    </div>
  );
}
