import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from '../dates';
import * as ipc from '../ipc';
import type { SyncOutcome } from '../ipc';
import { loadInitialState, seedDemoTodos } from '../loadState';
import { migrateTodo } from '../migrations';
import { inTauri, persistence } from '../persistence';
import { displayColor } from '../colors';
import { mapSharedRows } from '../sharedLogic';
import { isRepeating } from '../todoLogic';
import type {
  CalendarEvent,
  Category,
  CategoryScope,
  NewCategory,
  NewEvent,
  NewTodo,
  SharedGroup,
  Todo,
} from '../types';
import { useSettings } from './SettingsContext';
import { useSyncEngine } from './useSyncEngine';

export interface DataContextType {
  todos: Todo[];
  events: CalendarEvent[];
  loaded: boolean;
  addTodo: (todo: NewTodo) => void;
  updateTodo: (id: string, updates: Partial<Omit<Todo, 'id' | 'completions'>>) => void;
  deleteTodo: (id: string) => void;
  /** Yes/no: toggles done. Measurable: jumps to target, or back to 0 if already done. */
  toggleTodo: (todoId: string, date: string) => void;
  setTodoValue: (todoId: string, date: string, value: number) => void;
  addEvent: (event: NewEvent) => void;
  updateEvent: (id: string, updates: Partial<Omit<CalendarEvent, 'id'>>) => void;
  deleteEvent: (id: string) => void;
  /** Settings › Danger zone: every own event goes (shared ones aren't ours to delete). */
  deleteAllEvents: () => void;
  /** Settings › Danger zone: every task, or every habit. */
  deleteAllTodos: (kind: 'task' | 'habit') => void;
  /** Bulk upsert (by id), e.g. a Google Calendar import — re-importing updates in place. */
  importEvents: (incoming: CalendarEvent[]) => void;
  /** User-managed, synced groupings (Settings › Categories). */
  categories: Category[];
  /** Returns the created category (with its new id) so a caller can select it immediately. */
  addCategory: (category: NewCategory) => Category;
  updateCategory: (id: string, updates: Partial<Omit<Category, 'id'>>) => void;
  /** Also clears `category` on every referencing to-do/event (they persist as uncategorised). */
  deleteCategory: (id: string) => void;
  /** Own categories offered for a given surface, sorted by the user's manual order. */
  categoriesFor: (scope: CategoryScope) => Category[];
  /** Resolves an id against own categories, then shared ones (namespaced `${owner}:${pk}`). */
  categoryById: (id: string) => Category | undefined;
  /**
   * Re-reads everything from the store. Needed after a server sync, which
   * writes straight to SQLite from Rust and so bypasses React state.
   */
  reloadFromStore: () => Promise<void>;
  /**
   * Writes the starter to-dos when there are none. The Welcome screen calls
   * this on "use offline": the load itself never seeds while the Welcome
   * gate is still up, because a sign-in chosen there would push the demo
   * rows into a real account.
   */
  seedDemoIfEmpty: () => void;
  /** Everything other accounts share with this one, hidden owners included. */
  shared: SharedGroup[];
  /** `shared` minus locally hidden owners — what the panels should render. */
  visibleShared: SharedGroup[];
  /** Visible shared events flattened, each carrying `sharedBy` — merged into the calendar. */
  sharedEvents: CalendarEvent[];
  /** Own + visible shared events — what every calendar surface expands. */
  allEvents: CalendarEvent[];
  /** See `SyncEngine` (`useSyncEngine.ts`) for these four. */
  lastSync: number | null;
  syncing: boolean;
  syncNow: () => Promise<SyncOutcome>;
  scheduleSync: () => void;
}

const DataContext = createContext<DataContextType | null>(null);

/**
 * Mutators use functional updaters so two edits queued in one tick (a form
 * committing while a category delete cascades, say) each see the other's
 * result instead of the render they were created in. The store write sits
 * inside the updater because that is the only place the merged row exists;
 * every write is an idempotent upsert, so StrictMode's double invocation of
 * updaters in dev is harmless.
 */
function patchRow<T extends { id: string }>(list: T[], id: string, updates: Partial<T>, save: (row: T) => void): T[] {
  let hit = false;
  const next = list.map((row) => {
    if (row.id !== id) return row;
    hit = true;
    const merged = { ...row, ...updates };
    save(merged);
    return merged;
  });
  return hit ? next : list;
}

function withCompletion(t: Todo, date: string, value: number): Todo {
  const completions = { ...t.completions };
  if (value <= 0) delete completions[date];
  else completions[date] = value;
  return { ...t, completions };
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { hydrateSettings, hiddenOwners, signedIn, getSetting } = useSettings();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [shared, setShared] = useState<SharedGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const initStarted = useRef(false);

  /** Re-reads the shared cache. Tauri-only — the browser dev server has no sync. */
  const refreshShared = useCallback(async () => {
    if (!inTauri()) return;
    try {
      const rows = await ipc.loadShared();
      setShared(mapSharedRows(rows));
    } catch (err) {
      console.warn('failed to load shared data:', err);
    }
  }, []);

  const reloadFromStore = useCallback(async () => {
    // Queued writes must land first, or an edit made during a sync is read
    // back as the pre-edit row and vanishes from the screen until next load.
    await persistence.flush();
    const state = await persistence.load();
    setTodos(state.todos.map(migrateTodo));
    setEvents([...state.events]);
    setCategories(state.categories);
    hydrateSettings(state.settings);
    await refreshShared();
  }, [hydrateSettings, refreshShared]);

  const { lastSync, syncing, syncNow, scheduleSync, startup } = useSyncEngine({
    reloadFromStore,
    getSetting,
    signedIn,
  });

  useEffect(() => {
    if (initStarted.current) return; // StrictMode double-mount guard
    initStarted.current = true;

    const load = async () => {
      try {
        const loadedState = await loadInitialState();
        hydrateSettings(loadedState.settings);
        setTodos(loadedState.todos);
        setEvents(loadedState.events);
        setCategories(loadedState.categories);
        await refreshShared();
      } catch (err) {
        // Stay empty rather than show demo rows: the first edit would persist
        // them (fixed ids) into whatever store just failed to read.
        console.error('failed to load persisted data:', err);
      }
      setLoaded(true);
    };
    startup(load());
  }, []);

  const seedDemoIfEmpty = useCallback(() => {
    setTodos((prev) => (prev.length === 0 ? seedDemoTodos() : prev));
  }, []);

  const addTodo = useCallback(
    (todo: NewTodo) => {
      const full: Todo = { ...todo, id: crypto.randomUUID(), createdAt: fmt(new Date()), completions: {} };
      setTodos((prev) => [...prev, full]);
      persistence.saveTodo(full);
      scheduleSync();
    },
    [scheduleSync],
  );

  const updateTodo = useCallback(
    (id: string, updates: Partial<Omit<Todo, 'id' | 'completions'>>) => {
      setTodos((prev) => patchRow(prev, id, updates, persistence.saveTodo));
      scheduleSync();
    },
    [scheduleSync],
  );

  const deleteTodo = useCallback(
    (id: string) => {
      setTodos((prev) => prev.filter((t) => t.id !== id));
      persistence.deleteTodo(id);
      scheduleSync();
    },
    [scheduleSync],
  );

  const setTodoValue = useCallback(
    (todoId: string, date: string, value: number) => {
      setTodos((prev) => prev.map((t) => (t.id === todoId ? withCompletion(t, date, value) : t)));
      persistence.setCompletion(todoId, date, value);
      scheduleSync();
    },
    [scheduleSync],
  );

  const toggleTodo = useCallback(
    (todoId: string, date: string) => {
      setTodos((prev) => {
        const todo = prev.find((t) => t.id === todoId);
        if (!todo) return prev;
        const value = (todo.completions[date] ?? 0) >= todo.target ? 0 : todo.target;
        persistence.setCompletion(todoId, date, value);
        return prev.map((t) => (t.id === todoId ? withCompletion(t, date, value) : t));
      });
      scheduleSync();
    },
    [scheduleSync],
  );

  const addEvent = useCallback(
    (event: NewEvent) => {
      const full: CalendarEvent = { ...event, id: crypto.randomUUID() };
      setEvents((prev) => [...prev, full]);
      persistence.saveEvent(full);
      scheduleSync();
    },
    [scheduleSync],
  );

  const updateEvent = useCallback(
    (id: string, updates: Partial<Omit<CalendarEvent, 'id'>>) => {
      setEvents((prev) => patchRow(prev, id, updates, persistence.saveEvent));
      scheduleSync();
    },
    [scheduleSync],
  );

  const deleteEvent = useCallback(
    (id: string) => {
      setEvents((prev) => prev.filter((e) => e.id !== id));
      persistence.deleteEvent(id);
      scheduleSync();
    },
    [scheduleSync],
  );

  const deleteAllEvents = useCallback(() => {
    setEvents([]);
    persistence.deleteAllEvents();
    scheduleSync();
  }, [scheduleSync]);

  const deleteAllTodos = useCallback(
    (kind: 'task' | 'habit') => {
      setTodos((prev) => prev.filter((t) => isRepeating(t) === (kind === 'task')));
      persistence.deleteAllTodos(kind);
      scheduleSync();
    },
    [scheduleSync],
  );

  const importEvents = useCallback(
    (incoming: CalendarEvent[]) => {
      setEvents((prev) => {
        const byId = new Map(prev.map((e) => [e.id, e]));
        for (const e of incoming) byId.set(e.id, e);
        return [...byId.values()];
      });
      incoming.forEach((e) => persistence.saveEvent(e));
      scheduleSync();
    },
    [scheduleSync],
  );

  const addCategory = useCallback(
    (input: NewCategory): Category => {
      const full: Category = { ...input, id: crypto.randomUUID() };
      setCategories((prev) => [...prev, full]);
      persistence.saveCategory(full);
      scheduleSync();
      return full;
    },
    [scheduleSync],
  );

  const updateCategory = useCallback(
    (id: string, updates: Partial<Omit<Category, 'id'>>) => {
      setCategories((prev) => patchRow(prev, id, updates, persistence.saveCategory));
      scheduleSync();
    },
    [scheduleSync],
  );

  const deleteCategory = useCallback(
    (id: string) => {
      setCategories((prev) => prev.filter((c) => c.id !== id));
      persistence.deleteCategory(id);
      // Each cleared row is saved like any other edit, so the clear itself
      // persists (and syncs) rather than being a local-only side effect.
      const clear =
        <T extends { category: string }>(save: (row: T) => void) =>
        (prev: T[]) =>
          prev.map((row) => {
            if (row.category !== id) return row;
            const next = { ...row, category: '' };
            save(next);
            return next;
          });
      setTodos(clear<Todo>(persistence.saveTodo));
      setEvents(clear<CalendarEvent>(persistence.saveEvent));
      scheduleSync();
    },
    [scheduleSync],
  );

  const categoriesFor = useCallback(
    (scope: CategoryScope): Category[] =>
      categories
        .filter((c) => c.scopes.includes(scope))
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    [categories],
  );

  const categoryById = useCallback(
    (id: string): Category | undefined => {
      if (!id) return undefined;
      return categories.find((c) => c.id === id) ?? shared.flatMap((g) => g.categories).find((c) => c.id === id);
    },
    [categories, shared],
  );

  const visibleShared = useMemo(() => shared.filter((g) => !hiddenOwners.includes(g.owner)), [shared, hiddenOwners]);

  // What consumers see is *painted*: every row's `colorKey` is replaced by its
  // category's colour (or the neutral for General) before it leaves the
  // context, so no render site has to know that colours belong to categories
  // and a recolour propagates everywhere at once. The raw rows above keep the
  // stored key, which is what the mutators patch and persist — so no edit
  // surface may hand a painted `colorKey` back (the forms don't).
  const paint = useCallback(
    <T extends { category: string; colorKey: string }>(rows: T[]): T[] =>
      rows.map((r) => ({ ...r, colorKey: displayColor(r, categoryById) })),
    [categoryById],
  );
  const paintedTodos = useMemo(() => paint(todos), [paint, todos]);
  const paintedEvents = useMemo(() => paint(events), [paint, events]);
  const sharedEvents = useMemo(() => paint(visibleShared.flatMap((g) => g.events)), [paint, visibleShared]);
  const allEvents = useMemo(() => [...paintedEvents, ...sharedEvents], [paintedEvents, sharedEvents]);

  const value = useMemo<DataContextType>(
    () => ({
      todos: paintedTodos,
      events: paintedEvents,
      loaded,
      addTodo,
      updateTodo,
      deleteTodo,
      toggleTodo,
      setTodoValue,
      addEvent,
      updateEvent,
      deleteEvent,
      deleteAllEvents,
      deleteAllTodos,
      importEvents,
      categories,
      addCategory,
      updateCategory,
      deleteCategory,
      categoriesFor,
      categoryById,
      reloadFromStore,
      seedDemoIfEmpty,
      shared,
      visibleShared,
      sharedEvents,
      allEvents,
      lastSync,
      syncing,
      syncNow,
      scheduleSync,
    }),
    [
      paintedTodos,
      paintedEvents,
      loaded,
      addTodo,
      updateTodo,
      deleteTodo,
      toggleTodo,
      setTodoValue,
      addEvent,
      updateEvent,
      deleteEvent,
      deleteAllEvents,
      deleteAllTodos,
      importEvents,
      categories,
      addCategory,
      updateCategory,
      deleteCategory,
      categoriesFor,
      categoryById,
      reloadFromStore,
      seedDemoIfEmpty,
      shared,
      visibleShared,
      sharedEvents,
      allEvents,
      lastSync,
      syncing,
      syncNow,
      scheduleSync,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within AppProvider');
  return ctx;
}
