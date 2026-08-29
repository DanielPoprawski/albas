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
import TodoPanel from './TodoPanel';
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
type Route = 'dashboard' | 'todo' | 'habits' | 'settings';

/** Route → the persisted view, where one exists. Habits has none yet. */
const VIEW_OF: Partial<Record<Route, ActiveView>> = {
  dashboard: 'calendar',
  todo: 'todos',
  settings: 'settings',
};

function routeOf(view: ActiveView): Route {
  if (view === 'todos') return 'todo';
  if (view === 'settings') return 'settings';
  if (view === 'weight') return 'habits';
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
          {/* The app mark, drawn rather than lettered — same three strokes as
              public/icon.svg, in white on the purple square. */}
          <svg viewBox="0 0 100 100" width="20" height="20" aria-hidden="true">
            <path d="M76 9 C40 18 8 55 13 93 C28 72 58 50 76 9 Z" fill="#fff" />
            <path d="M78 12 L94 9 L79 94 L64 96 Z" fill="#fff" fillOpacity="0.55" />
            <path d="M18 66 L97 38 L97 56 L18 84 Z" fill="#fff" />
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

/** "Daniel Poprawski" → "DP"; a single word gives its first letter. */
function initialsOf(name: string): string {
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
            {route === 'dashboard' && (isMobile ? <HomeView /> : <Calendar />)}
            {route === 'dashboard' && !isMobile && <RightPanel />}

            {route === 'todo' && (
              <div className="flex-1 min-w-0 overflow-auto scrollbar-hide p-[var(--space-16)]">
                <TodoPanel />
              </div>
            )}

            {/* Package 04 owns this screen; the shell only routes to it. */}
            {route === 'habits' && (
              <div className="flex-1 min-w-0 overflow-auto p-[var(--space-24)] text-ui text-ink-muted">
                Habits
              </div>
            )}

            {route === 'settings' && (
              <div className="flex-1 min-w-0 overflow-auto p-[var(--space-16)]">
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
