import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActiveView, CalendarEvent, CalendarMode, FirstDayOfWeek, SharedGroup, ThemeName, Todo, WeightEntry, WeightUnit,
} from '../types';
import { fmt, parse, weekOf } from '../dates';
import { inTauri, persistence, readLocalBlob } from '../persistence';
import { DEFAULT_COLOR } from '../colors';
import { migrateLegacyTask, migrateTodo, periodToEvent, taskToTodo } from '../migrations';
import { mapSharedRows } from '../sharedLogic';

export { migrateLegacyTask, migrateTodo } from '../migrations';

const today = new Date();
const todayStr = fmt(today);

// Seed demo data on the current Mon–Sun week so it lines up with the weekly tracker,
// but never on future days.
const weekDates = weekOf(today).filter(d => d <= todayStr);
const weekAgo = new Date(today);
weekAgo.setDate(today.getDate() - 7);
const weekAgoStr = fmt(weekAgo);

const baseTodo = {
  kind: 'yesno' as const, unit: '', target: 1,
  dueDate: null, time: null, createdAt: weekAgoStr, reminder: false,
  category: '', important: false,
};

const initialTodos: Todo[] = [
  {
    ...baseTodo, id: '1', name: 'Deep Work', colorKey: '#10b981', kind: 'measurable', unit: 'h', target: 4,
    schedule: { type: 'weekdays', days: [1, 2, 3, 4, 5] },
    completions: Object.fromEntries(
      weekDates.filter(d => { const day = parse(d).getDay(); return day >= 1 && day <= 5; }).map(d => [d, 4])
    ),
  },
  {
    ...baseTodo, id: '2', name: 'Meditation', colorKey: '#a855f7',
    schedule: { type: 'daily' },
    completions: Object.fromEntries(weekDates.filter((_, i) => i % 2 === 0).map(d => [d, 1])),
  },
  {
    ...baseTodo, id: '3', name: 'Take out trash', colorKey: '#f59e0b', reminder: true,
    schedule: { type: 'every', n: 3, unit: 'day', fromDone: true },
    completions: weekDates.length > 2 ? { [weekDates[weekDates.length - 3]]: 1 } : {},
  },
  {
    ...baseTodo, id: '4', name: 'Finalize Q4 roadmap', colorKey: DEFAULT_COLOR,
    schedule: { type: 'once' }, dueDate: todayStr, completions: {},
  },
];

export type NewTodo = Omit<Todo, 'id' | 'completions' | 'createdAt'>;
export type NewEvent = Omit<CalendarEvent, 'id'>;

export type NewWeight = Omit<WeightEntry, 'id'>;

/** Mirrors `SyncOutcome` from Rust's `sync_now` (src-tauri/src/sync.rs). */
export interface SyncOutcome {
  pushed: number;
  pulled: number;
  skipped: number;
  sharedChanged: boolean;
  /** Epoch millis as a string — an i64 that would lose precision as a JSON number. */
  lastSync: string | null;
}

/** Mirrors `SyncStatus` from Rust's `sync_status`. */
export interface SyncStatusInfo {
  configured: boolean;
  url: string | null;
  account: string | null;
  lastSync: string | null;
}

interface AppContextType {
  todos: Todo[];
  events: CalendarEvent[];
  weights: WeightEntry[];
  loaded: boolean;
  selectedDate: string | null;
  currentMonth: Date;
  activeView: ActiveView;
  calendarMode: CalendarMode;
  setSelectedDate: (date: string | null) => void;
  setCurrentMonth: React.Dispatch<React.SetStateAction<Date>>;
  setActiveView: (view: ActiveView) => void;
  setCalendarMode: (mode: CalendarMode) => void;
  addTodo: (todo: NewTodo) => void;
  updateTodo: (id: string, updates: Partial<Omit<Todo, 'id' | 'completions'>>) => void;
  deleteTodo: (id: string) => void;
  /** Yes/no: toggles done. Measurable: jumps to target, or back to 0 if already done. */
  toggleTodo: (todoId: string, date: string) => void;
  setTodoValue: (todoId: string, date: string, value: number) => void;
  addEvent: (event: NewEvent) => void;
  updateEvent: (id: string, updates: Partial<Omit<CalendarEvent, 'id'>>) => void;
  deleteEvent: (id: string) => void;
  /** Bulk upsert (by id), e.g. a Google Calendar import — re-importing updates in place. */
  importEvents: (incoming: CalendarEvent[]) => void;
  addWeight: (weight: NewWeight) => void;
  deleteWeight: (id: string) => void;
  /** Bulk upsert (by id) for a Wyze sync — re-syncing a range updates in place. */
  importWeights: (incoming: WeightEntry[]) => void;
  theme: ThemeName;
  weightUnit: WeightUnit;
  firstDayOfWeek: FirstDayOfWeek;
  setSetting: (key: string, value: string) => void;
  /**
   * Re-reads everything from the store. Needed after a server sync, which
   * writes straight to SQLite from Rust and so bypasses React state.
   */
  reloadFromStore: () => Promise<void>;
  /** Everything other accounts share with this one, hidden owners included. */
  shared: SharedGroup[];
  /** `shared` minus locally hidden owners — what the panels should render. */
  visibleShared: SharedGroup[];
  /** Visible shared events flattened, each carrying `sharedBy` — merged into the calendar. */
  sharedEvents: CalendarEvent[];
  /** Owners hidden on this device (local preference, never synced). */
  hiddenOwners: string[];
  toggleOwnerHidden: (owner: string) => void;
  /** True when sync credentials exist (passkey login or a pasted token). */
  signedIn: boolean;
  /** Account name from passkey login; null for token-only setups. */
  syncAccount: string | null;
  /**
   * The bearer token this device authenticates to the sync server with, or
   * null when signed out. Exposed so the fetch-based auth-method modules
   * (`src/authMethods/`) can call authenticated endpoints without a Tauri
   * round-trip; passkey ceremonies still go through Rust because they need
   * the OS authenticator.
   */
  syncToken: string | null;
  /** Epoch millis of the last successful sync on this device, or null for never. */
  lastSync: number | null;
  /** True while a sync is in flight, whoever started it. */
  syncing: boolean;
  /**
   * Runs a sync and folds the result back into React. Every caller goes
   * through this — the status bar, Settings, and the once-per-launch effect
   * below — so there is a single `lastSync` rather than one per surface.
   * Rejects on failure; how loudly to say so is the caller's business.
   */
  syncNow: () => Promise<SyncOutcome>;
  /** Welcome screen dismissed (or made moot by being signed in). */
  welcomeDone: boolean;
}

/**
 * The themes that exist. Two, not the four CLAUDE.md § Theming lists: the
 * redesign draws `:root` (light) and `[data-theme='dark']` only, and
 * `grey-high`/`grey-low` are gone for good.
 *
 * A stored value that isn't one of these — an install that last ran a
 * four-theme build — falls through to the default rather than stamping an
 * attribute nothing responds to. The default is **light**, because the
 * redesign is a light-first design; it used to be dark.
 */
const THEMES: ThemeName[] = ['light', 'dark'];

function readTheme(settings: Record<string, string>): ThemeName {
  const t = settings.theme as ThemeName | undefined;
  return t && THEMES.includes(t) ? t : 'light';
}

/**
 * Themes are also mirrored to localStorage by `applyTheme` so the inline script
 * in index.html can paint the right colours before React mounts. SQLite stays
 * the source of truth; the mirror is only a first-paint cache.
 */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('albas-theme', theme);
  } catch {
    // private mode / quota — the theme still applies for this session
  }
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [shared, setShared] = useState<SharedGroup[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr);
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [activeView, setActiveView] = useState<ActiveView>('calendar');
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month');
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const initStarted = useRef(false);
  const syncStarted = useRef(false); // StrictMode double-mount guard

  useEffect(() => {
    if (initStarted.current) return; // StrictMode double-mount guard
    initStarted.current = true;

    (async () => {
      try {
        let state = await persistence.load();
        setSettings(state.settings);
        setWeights(state.weights);
        applyTheme(readTheme(state.settings));

        if (inTauri() && state.needsLegacyImport) {
          const blob = readLocalBlob();
          if (blob) {
            await persistence.importLegacy(blob.tasks.map(migrateLegacyTask), blob.habits.map(migrateTodo));
            state = await persistence.load();
          }
        }

        if (state.empty) {
          // first launch anywhere — seed the demo data through the store
          initialTodos.forEach(t => {
            persistence.saveTodo(t);
            Object.entries(t.completions).forEach(([d, v]) => persistence.setCompletion(t.id, d, v));
          });
          setTodos(initialTodos);
        } else {
          const loadedTodos = state.todos.map(migrateTodo);
          const loadedEvents = [...state.events];

          // one-time unification: fold legacy tasks/periods into todos/events
          for (const raw of state.legacyTasks) {
            const todo = taskToTodo(migrateLegacyTask(raw));
            loadedTodos.push(todo);
            persistence.saveTodo(todo);
            Object.entries(todo.completions).forEach(([d, v]) => persistence.setCompletion(todo.id, d, v));
            persistence.deleteTask(raw.id);
          }
          for (const raw of state.legacyPeriods) {
            const event = periodToEvent(raw);
            loadedEvents.push(event);
            persistence.saveEvent(event);
            persistence.deletePeriod(raw.id);
          }

          setTodos(loadedTodos);
          setEvents(loadedEvents);
        }
        await refreshShared();
      } catch (err) {
        console.error('failed to load persisted data:', err);
        setTodos(initialTodos);
      }
      setLoaded(true);
    })();
  }, []);

  // One sync per launch, once the local data is on screen. Deliberately not
  // awaited by the load above: a slow or unreachable server must never delay
  // startup, and a failure here just means the app stays local until the next
  // manual sync from Settings.
  useEffect(() => {
    if (!loaded || !inTauri() || syncStarted.current) return;
    syncStarted.current = true;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<SyncStatusInfo>('sync_status');
        if (!status.configured) return;
        await syncNow();
      } catch (err) {
        console.warn('startup sync failed:', err);
      }
    })();
  }, [loaded]);

  function addTodo(todo: NewTodo) {
    const full: Todo = { ...todo, id: crypto.randomUUID(), createdAt: todayStr, completions: {} };
    setTodos(prev => [...prev, full]);
    persistence.saveTodo(full);
  }

  function updateTodo(id: string, updates: Partial<Omit<Todo, 'id' | 'completions'>>) {
    const current = todos.find(t => t.id === id);
    if (!current) return;
    const next = { ...current, ...updates };
    setTodos(prev => prev.map(t => (t.id === id ? next : t)));
    persistence.saveTodo(next);
  }

  function deleteTodo(id: string) {
    setTodos(prev => prev.filter(t => t.id !== id));
    persistence.deleteTodo(id);
  }

  function setTodoValue(todoId: string, date: string, value: number) {
    setTodos(prev => prev.map(t => {
      if (t.id !== todoId) return t;
      const completions = { ...t.completions };
      if (value <= 0) delete completions[date];
      else completions[date] = value;
      return { ...t, completions };
    }));
    persistence.setCompletion(todoId, date, value);
  }

  function toggleTodo(todoId: string, date: string) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    const current = todo.completions[date] ?? 0;
    setTodoValue(todoId, date, current >= todo.target ? 0 : todo.target);
  }

  function addEvent(event: NewEvent) {
    const full: CalendarEvent = { ...event, id: crypto.randomUUID() };
    setEvents(prev => [...prev, full]);
    persistence.saveEvent(full);
  }

  function updateEvent(id: string, updates: Partial<Omit<CalendarEvent, 'id'>>) {
    const current = events.find(e => e.id === id);
    if (!current) return;
    const next = { ...current, ...updates };
    setEvents(prev => prev.map(e => (e.id === id ? next : e)));
    persistence.saveEvent(next);
  }

  function deleteEvent(id: string) {
    setEvents(prev => prev.filter(e => e.id !== id));
    persistence.deleteEvent(id);
  }

  function importEvents(incoming: CalendarEvent[]) {
    setEvents(prev => {
      const byId = new Map(prev.map(e => [e.id, e]));
      for (const e of incoming) byId.set(e.id, e);
      return [...byId.values()];
    });
    incoming.forEach(e => persistence.saveEvent(e));
  }

  function addWeight(weight: NewWeight) {
    const full: WeightEntry = { ...weight, id: crypto.randomUUID() };
    setWeights(prev => [...prev, full].sort((a, b) => a.ts - b.ts));
    persistence.saveWeight(full);
  }

  function deleteWeight(id: string) {
    setWeights(prev => prev.filter(w => w.id !== id));
    persistence.deleteWeight(id);
  }

  function importWeights(incoming: WeightEntry[]) {
    setWeights(prev => {
      const byId = new Map(prev.map(w => [w.id, w]));
      for (const w of incoming) byId.set(w.id, w);
      return [...byId.values()].sort((a, b) => a.ts - b.ts);
    });
    incoming.forEach(w => persistence.saveWeight(w));
  }

  function setSetting(key: string, value: string) {
    setSettings(prev => ({ ...prev, [key]: value }));
    persistence.setSetting(key, value);
    if (key === 'theme') applyTheme(value as ThemeName);
  }

  /** Re-reads the shared cache. Tauri-only — the browser dev server has no sync. */
  async function refreshShared() {
    if (!inTauri()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const rows = await invoke<Parameters<typeof mapSharedRows>[0]>('load_shared');
      setShared(mapSharedRows(rows));
    } catch (err) {
      console.warn('failed to load shared data:', err);
    }
  }

  async function reloadFromStore() {
    const state = await persistence.load();
    setTodos(state.todos.map(migrateTodo));
    setEvents([...state.events]);
    setWeights(state.weights);
    setSettings(state.settings);
    await refreshShared();
  }

  /**
   * The one place a sync is run from. Rust merges straight into SQLite, so a
   * pull has to be read back into React here; doing that per caller is how the
   * status bar and Settings would come to disagree about what is on screen and
   * when it last arrived.
   */
  async function syncNow(): Promise<SyncOutcome> {
    const { invoke } = await import('@tauri-apps/api/core');
    setSyncing(true);
    try {
      const out = await invoke<SyncOutcome>('sync_now');
      if (out.pulled > 0 || out.sharedChanged) await reloadFromStore();
      if (out.lastSync) setLastSync(Number(out.lastSync));
      return out;
    } finally {
      setSyncing(false);
    }
  }

  const hiddenOwners = useMemo<string[]>(() => {
    try {
      const parsed = JSON.parse(settings.__shared_hidden ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === 'string') : [];
    } catch {
      return [];
    }
  }, [settings.__shared_hidden]);
  const visibleShared = useMemo(
    () => shared.filter(g => !hiddenOwners.includes(g.owner)),
    [shared, hiddenOwners]
  );
  const sharedEvents = useMemo(() => visibleShared.flatMap(g => g.events), [visibleShared]);

  function toggleOwnerHidden(owner: string) {
    const next = hiddenOwners.includes(owner)
      ? hiddenOwners.filter(o => o !== owner)
      : [...hiddenOwners, owner];
    setSetting('__shared_hidden', JSON.stringify(next));
  }

  const signedIn = !!settings.__sync_token?.trim();

  // Rust owns the stamp, and not every sync passes through `syncNow`: a
  // passkey ceremony (`usePasskeyAuth`) syncs from inside the flow, so on
  // sign-in React can only learn when that happened by asking. Signing out
  // clears it — the next account's history is not this one's.
  useEffect(() => {
    if (!inTauri()) return;
    if (!signedIn) {
      setLastSync(null);
      return;
    }
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<SyncStatusInfo>('sync_status');
        setLastSync(status.lastSync ? Number(status.lastSync) : null);
      } catch {
        // backend not ready — the bar reads "never synced" until one runs
      }
    })();
  }, [signedIn]);

  return (
    <AppContext.Provider value={{
      todos, events, weights, loaded,
      selectedDate, currentMonth, activeView, calendarMode,
      setSelectedDate, setCurrentMonth, setActiveView, setCalendarMode,
      addTodo, updateTodo, deleteTodo, toggleTodo, setTodoValue,
      addEvent, updateEvent, deleteEvent, importEvents,
      addWeight, deleteWeight, importWeights,
      theme: readTheme(settings),
      weightUnit: settings.weightUnit === 'kg' ? 'kg' : 'lb',
      // Sunday by default as of v1.7; only an explicit '1' opts into Monday.
      firstDayOfWeek: settings.firstDayOfWeek === '1' ? 1 : 0,
      setSetting,
      reloadFromStore,
      shared,
      visibleShared,
      sharedEvents,
      hiddenOwners,
      toggleOwnerHidden,
      signedIn,
      syncAccount: settings.__sync_account?.trim() || null,
      syncToken: settings.__sync_token?.trim() || null,
      lastSync,
      syncing,
      syncNow,
      welcomeDone: !!settings.__welcome_done || signedIn,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
