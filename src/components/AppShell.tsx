import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { remindDueEvents, remindDueTodos } from '../notifications';
import Calendar from './Calendar';
import HomeView from './HomeView';
import RightPanel from './RightPanel';
import TodoViewRedesign from './TodoViewRedesign';
import HabitsView from './HabitsView';
import WeightPanel from './WeightPanel';
import Settings from './Settings';
import Welcome from './Welcome';
import { useApp } from '../context/AppContext';
import { stampLabel, timeAgo } from '../dates';
import { inTauri } from '../persistence';
import { useIsMobile } from '../useMedia';
import type { ActiveView } from '../types';

/**
 * The four destinations the redesign's sidebar has. They are the shell's own
 * vocabulary rather than `ActiveView`'s: Habits is a new screen (package 04)
 * that the stored view type doesn't name yet, and Dashboard/To-Do read better
 * here than the old calendar/todos.
 */
type Route = 'dashboard' | 'todo' | 'habits' | 'weight' | 'settings';

/** Route → the persisted view, where one exists. Habits has none yet. */
const VIEW_OF: Partial<Record<Route, ActiveView>> = {
  dashboard: 'calendar',
  todo: 'todos',
  weight: 'weight',
  settings: 'settings',
};

/**
 * The persisted view → this shell's route.
 *
 * `'weight'` used to be folded into `habits`, so the two shared one stored
 * value and navigating to Habits silently rewrote `activeView` to `'weight'`.
 * Weight is now its own destination, which is the clean fix: every route with
 * an `ActiveView` round-trips through `VIEW_OF` unchanged. `habits` is the one
 * route with nothing to persist — `ActiveView` has no name for it — so it is
 * simply not in either map and a restart lands on the dashboard.
 */
function routeOf(view: ActiveView): Route {
  if (view === 'todos') return 'todo';
  if (view === 'weight') return 'weight';
  if (view === 'settings') return 'settings';
  return 'dashboard';
}

/* ── Sidebar slot ────────────────────────────────────────────────────────
 *
 * A screen can hang its own second sidebar section (To-Do's Categories, a
 * filter list, …) under Menu by rendering `<SidebarSlot>` anywhere in its
 * tree. It portals into the sidebar, so a page component never has to be
 * split in two or thread a node up through props.
 *
 * The target is held as state, not a ref: a ref set during the shell's own
 * render would still be null on the consumer's first pass, and nothing would
 * re-render it.
 */
const SlotContext = createContext<HTMLElement | null>(null);

export function SidebarSlot({ children }: { children: ReactNode }) {
  const host = useContext(SlotContext);
  return host ? createPortal(children, host) : null;
}

/* ── Sidebar ─────────────────────────────────────────────────────────────*/

const ICON = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 } as const;

const NAV: { route: Route; label: string; icon: ReactNode }[] = [
  {
    route: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg {...ICON}>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    route: 'todo',
    label: 'To-Do',
    icon: (
      <svg {...ICON}>
        <rect x="3" y="4" width="6" height="6" />
        <path d="M4.5 7l1 1 2-2" />
        <line x1="12" y1="7" x2="21" y2="7" />
        <rect x="3" y="14" width="6" height="6" />
        <path d="M4.5 17l1 1 2-2" />
        <line x1="12" y1="17" x2="21" y2="17" />
      </svg>
    ),
  },
  {
    route: 'habits',
    label: 'Habits',
    icon: (
      <svg {...ICON}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    route: 'weight',
    label: 'Weight',
    // A dial: the arc of a scale's face with its needle. Drawn here in the
    // same 15px/1.8-stroke vocabulary as its four neighbours rather than
    // pulled from lucide, which nothing else in this file imports.
    icon: (
      <svg {...ICON}>
        <path d="M3.5 17a9 9 0 1 1 17 0" />
        <line x1="12" y1="17" x2="16" y2="10.5" />
        <line x1="3.5" y1="17" x2="20.5" y2="17" />
      </svg>
    ),
  },
  {
    route: 'settings',
    label: 'Settings',
    icon: (
      <svg {...ICON}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      </svg>
    ),
  },
];

function Sidebar({
  route,
  onNavigate,
  slotRef,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  slotRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-mark">
          {/* The app mark, drawn rather than lettered — same glyph as
              public/icons/albas-mark-glyph.svg, in white on the purple square. */}
          <svg viewBox="0 0 512 512" width="20" height="20" aria-hidden="true">
            <path d="M 352.64213,163.92994 413.28,52.08 l 58.95456,422.68234 -78.20532,-0.0413 z" fill="#fff" fillOpacity="0.55" />
            <path d="M 313.80273 46.6875 C 313.78856 46.714256 313.77394 46.740823 313.75977 46.767578 L 286.22266 46.767578 L 255.42969 105.83398 L 281.96094 105.83398 C 249.48628 165.31906 216.10526 224.31592 183.19531 283.55859 L 154.49609 283.55859 L 123.70312 342.625 L 150.38477 342.625 L 114.07422 409.05273 L 86.029297 409.05273 L 55.236328 468.11914 L 81.789062 468.11914 L 81.765625 468.16211 L 168.49414 468.36133 L 238.37305 342.625 L 475.24219 342.625 L 462.71484 283.55859 L 271.19922 283.55859 L 402.84375 46.6875 L 313.80273 46.6875 z" fill="#fff" />
          </svg>
        </span>
        Albas
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">Menu</div>
        {NAV.map(({ route: r, label, icon }) => (
          // Real anchors, so a destination has a hover target, a focus ring
          // and a middle-click affordance. The href is the hash the route
          // would have if this app ever grows a router; navigation itself is
          // still state, hence the preventDefault.
          <a
            key={r}
            href={`#/${r}`}
            aria-current={route === r ? 'page' : undefined}
            className={`sidebar-item${route === r ? ' active' : ''}`}
            onClick={e => {
              e.preventDefault();
              onNavigate(r);
            }}
          >
            {icon}
            {label}
          </a>
        ))}
      </div>

      {/* Page-specific section — see SidebarSlot. Empty renders as nothing. */}
      <div className="sidebar-section sidebar-slot" ref={slotRef} />
    </aside>
  );
}

/* ── Bottom taskbar ──────────────────────────────────────────────────────*/

/**
 * "Daniel Poprawski" → "DP"; a single word gives its first letter.
 *
 * Exported because Settings' Profile avatar draws the same initials from the
 * same account name, and two implementations would eventually disagree.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/**
 * The strip along the bottom edge: version on the left, sync state and the
 * account on the right. Identical on every route — it belongs to the shell,
 * not to any screen.
 */
function BottomBar() {
  const { signedIn, syncAccount, lastSync, syncing, syncNow } = useApp();
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
    <div className="bottom-bar">
      <div className="bar-version">v{__APP_VERSION__}</div>
      <div className="bar-right">
        <button
          type="button"
          className="bar-sync"
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
        <span className="bar-divider" />
        <span className="bar-user">
          <span className="user-icon">{initialsOf(name)}</span>
          {name}
        </span>
      </div>
    </div>
  );
}

/* ── Shell ───────────────────────────────────────────────────────────────*/

export default function AppShell() {
  const isMobile = useIsMobile();
  const [slotHost, setSlotHost] = useState<HTMLDivElement | null>(null);
  const { activeView, setActiveView, todos, events, loaded, welcomeDone, firstDayOfWeek } = useApp();

  // The shell's own route. Seeded from the persisted view and re-derived
  // whenever something else changes it (Settings links, the account menu),
  // but held locally as well because Habits has no ActiveView to store.
  const [route, setRoute] = useState<Route>(() => routeOf(activeView));
  useEffect(() => setRoute(routeOf(activeView)), [activeView]);

  function navigate(next: Route) {
    setRoute(next);
    const view = VIEW_OF[next];
    if (view) setActiveView(view);
  }

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
    <div className="desktop-shell">
      <div className="shell-body">
        <Sidebar route={route} onNavigate={navigate} slotRef={setSlotHost} />

        {/* The content slot. A flex row, so a two-column screen is simply two
            children of it; single-column screens fill it. */}
        <SlotContext.Provider value={slotHost}>
          <div className="shell-content">
            {/* Under 768px the sidebar and the bottom bar are both display:none
                — HomeView brings its own header and tab bar, which is the whole
                of the mobile chrome. That leaves every other route with no way
                back, including a cold start whose persisted view was Settings,
                so those routes get an explicit back bar here. It lives in the
                shell rather than in each screen because it is the shell's
                navigation that went missing. */}
            {isMobile && route !== 'dashboard' && (
              <div className="mobile-route-bar">
                <button
                  type="button"
                  className="mobile-route-back"
                  onClick={() => navigate('dashboard')}
                >
                  <span aria-hidden="true">←</span> Dashboard
                </button>
                <span className="mobile-route-title">
                  {NAV.find(n => n.route === route)?.label}
                </span>
              </div>
            )}

            {route === 'dashboard' && (isMobile ? <HomeView /> : <Calendar />)}
            {route === 'dashboard' && !isMobile && <RightPanel />}

            {route === 'todo' && <TodoViewRedesign />}

            {/* Package 04 owns this screen; the shell only routes to it. */}
            {route === 'habits' && <HabitsView />}

            {/* The weight tracker. It predates the redesign and still speaks
                the legacy `--t-*` aliases, and it sizes itself with `h-full`,
                so it needs the same padded scroll column Settings gets. */}
            {route === 'weight' && (
              <div className="panel-main">
                <WeightPanel />
              </div>
            )}

            {route === 'settings' && (
              // 32px, dropping to 20px under the breakpoint — the design's
              // `.settings-main`, which a fixed utility padding could not do.
              <div className="settings-main">
                <Settings />
              </div>
            )}
          </div>
        </SlotContext.Provider>
      </div>

      <BottomBar />
    </div>
  );
}
