import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from '../dates';
import * as ipc from '../ipc';
import type { SyncOutcome } from '../ipc';
import { migrateLegacyTask, migrateTodo, periodToEvent, remapLegacyCategory, taskToTodo } from '../migrations';
import { inTauri, persistence, readLocalBlob } from '../persistence';
import { TODO_CATEGORIES } from '../colors';
import { initialTodos } from '../seedData';
import { mapSharedRows } from '../sharedLogic';
import type { CalendarEvent, Category, CategoryScope, SharedGroup, Todo } from '../types';
import { useSettings } from './SettingsContext';

export type NewTodo = Omit<Todo, 'id' | 'completions' | 'createdAt'>;
export type NewEvent = Omit<CalendarEvent, 'id'>;
export type NewCategory = Omit<Category, 'id'>;

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
  /** Everything other accounts share with this one, hidden owners included. */
  shared: SharedGroup[];
  /** `shared` minus locally hidden owners — what the panels should render. */
  visibleShared: SharedGroup[];
  /** Visible shared events flattened, each carrying `sharedBy` — merged into the calendar. */
  sharedEvents: CalendarEvent[];
  /** Own + visible shared events — what every calendar surface expands. */
  allEvents: CalendarEvent[];
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
  const { hydrateSettings, hiddenOwners, signedIn } = useSettings();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [shared, setShared] = useState<SharedGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const initStarted = useRef(false);
  const syncStarted = useRef(false); // StrictMode double-mount guard

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

  useEffect(() => {
    if (initStarted.current) return; // StrictMode double-mount guard
    initStarted.current = true;

    (async () => {
      try {
        let state = await persistence.load();
        hydrateSettings(state.settings);

        if (inTauri() && state.needsLegacyImport) {
          const blob = readLocalBlob();
          if (blob) {
            await persistence.importLegacy(blob.tasks.map(migrateLegacyTask), blob.habits.map(migrateTodo));
            state = await persistence.load();
          }
        }

        let finalTodos: Todo[];
        if (state.empty) {
          // first launch anywhere — seed the demo data through the store
          initialTodos.forEach((t) => {
            persistence.saveTodo(t);
            Object.entries(t.completions).forEach(([d, v]) => persistence.setCompletion(t.id, d, v));
          });
          finalTodos = initialTodos;
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

          finalTodos = loadedTodos;
          setTodos(loadedTodos);
          setEvents(loadedEvents);
        }

        // Categories: seed the five starters only for a genuinely fresh,
        // never-signed-in install — zero categories exist yet, nothing is
        // signed in (a sync is not about to pull the real ones), and no
        // loaded to-do already carries a pre-Phase-K free-text category (that
        // data goes through the remap below instead of being buried under
        // five defaults it never asked for). Everything else — an existing
        // local install with free-text categories, or any signed-in device,
        // which will get its real categories from the next sync — is left
        // empty for the user to fill in from Settings.
        let loadedCategories = state.categories;
        const signedInAtLoad = !!state.settings.__sync_token?.trim();
        const hasLegacyCategoryText = finalTodos.some((t) => t.category.trim());
        if (loadedCategories.length === 0 && !signedInAtLoad && !hasLegacyCategoryText) {
          loadedCategories = TODO_CATEGORIES.map((c, i) => ({
            id: crypto.randomUUID(),
            name: c.label,
            colorKey: c.hex,
            scopes: ['tasks'],
            sort: i,
          }));
          loadedCategories.forEach((c) => persistence.saveCategory(c));
        }
        // Best-effort, cheap remap of any surviving free-text category to the
        // matching id (see migrations.ts#remapLegacyCategory) — a no-op once
        // everything already holds ids, which is every load after the first.
        finalTodos = finalTodos.map((t) => {
          const remapped = remapLegacyCategory(t.category, loadedCategories);
          if (remapped === t.category) return t;
          const next = { ...t, category: remapped };
          persistence.saveTodo(next);
          return next;
        });
        setTodos(finalTodos);
        setCategories(loadedCategories);

        await refreshShared();
      } catch (err) {
        console.error('failed to load persisted data:', err);
        setTodos(initialTodos);
      }
      setLoaded(true);
    })();
  }, []);

  const reloadFromStore = useCallback(async () => {
    const state = await persistence.load();
    setTodos(state.todos.map(migrateTodo));
    setEvents([...state.events]);
    setCategories(state.categories);
    hydrateSettings(state.settings);
    await refreshShared();
  }, [hydrateSettings, refreshShared]);

  /**
   * The one place a sync is run from. Rust merges straight into SQLite, so a
   * pull has to be read back into React here; doing that per caller is how the
   * status bar and Settings would come to disagree about what is on screen and
   * when it last arrived.
   */
  const syncNow = useCallback(async (): Promise<SyncOutcome> => {
    setSyncing(true);
    try {
      const out = await ipc.syncNow();
      if (out.pulled > 0 || out.sharedChanged) await reloadFromStore();
      if (out.lastSync) setLastSync(Number(out.lastSync));
      return out;
    } finally {
      setSyncing(false);
    }
  }, [reloadFromStore]);

  // One sync per launch, once the local data is on screen. Deliberately not
  // awaited by the load above: a slow or unreachable server must never delay
  // startup, and a failure here just means the app stays local until the next
  // manual sync from Settings.
  useEffect(() => {
    if (!loaded || !inTauri() || syncStarted.current) return;
    syncStarted.current = true;
    (async () => {
      try {
        const status = await ipc.syncStatus();
        if (!status.configured) return;
        await syncNow();
      } catch (err) {
        console.warn('startup sync failed:', err);
      }
    })();
  }, [loaded]);

  // Rust owns the stamp, and not every sync passes through `syncNow`: the
  // browser sign-in flow (`useBrowserSignIn`) syncs from inside the poll
  // loop, so on sign-in React can only learn when that happened by asking.
  // Signing out clears it — the next account's history is not this one's.
  useEffect(() => {
    if (!inTauri()) return;
    if (!signedIn) {
      setLastSync(null);
      return;
    }
    (async () => {
      try {
        const status = await ipc.syncStatus();
        setLastSync(status.lastSync ? Number(status.lastSync) : null);
      } catch {
        // backend not ready — the bar reads "never synced" until one runs
      }
    })();
  }, [signedIn]);

  const addTodo = useCallback((todo: NewTodo) => {
    const full: Todo = { ...todo, id: crypto.randomUUID(), createdAt: fmt(new Date()), completions: {} };
    setTodos((prev) => [...prev, full]);
    persistence.saveTodo(full);
  }, []);

  const updateTodo = useCallback((id: string, updates: Partial<Omit<Todo, 'id' | 'completions'>>) => {
    setTodos((prev) => patchRow(prev, id, updates, persistence.saveTodo));
  }, []);

  const deleteTodo = useCallback((id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
    persistence.deleteTodo(id);
  }, []);

  const setTodoValue = useCallback((todoId: string, date: string, value: number) => {
    setTodos((prev) => prev.map((t) => (t.id === todoId ? withCompletion(t, date, value) : t)));
    persistence.setCompletion(todoId, date, value);
  }, []);

  const toggleTodo = useCallback((todoId: string, date: string) => {
    setTodos((prev) => {
      const todo = prev.find((t) => t.id === todoId);
      if (!todo) return prev;
      const value = (todo.completions[date] ?? 0) >= todo.target ? 0 : todo.target;
      persistence.setCompletion(todoId, date, value);
      return prev.map((t) => (t.id === todoId ? withCompletion(t, date, value) : t));
    });
  }, []);

  const addEvent = useCallback((event: NewEvent) => {
    const full: CalendarEvent = { ...event, id: crypto.randomUUID() };
    setEvents((prev) => [...prev, full]);
    persistence.saveEvent(full);
  }, []);

  const updateEvent = useCallback((id: string, updates: Partial<Omit<CalendarEvent, 'id'>>) => {
    setEvents((prev) => patchRow(prev, id, updates, persistence.saveEvent));
  }, []);

  const deleteEvent = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    persistence.deleteEvent(id);
  }, []);

  const importEvents = useCallback((incoming: CalendarEvent[]) => {
    setEvents((prev) => {
      const byId = new Map(prev.map((e) => [e.id, e]));
      for (const e of incoming) byId.set(e.id, e);
      return [...byId.values()];
    });
    incoming.forEach((e) => persistence.saveEvent(e));
  }, []);

  const addCategory = useCallback((input: NewCategory): Category => {
    const full: Category = { ...input, id: crypto.randomUUID() };
    setCategories((prev) => [...prev, full]);
    persistence.saveCategory(full);
    return full;
  }, []);

  const updateCategory = useCallback((id: string, updates: Partial<Omit<Category, 'id'>>) => {
    setCategories((prev) => patchRow(prev, id, updates, persistence.saveCategory));
  }, []);

  const deleteCategory = useCallback((id: string) => {
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
  }, []);

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
  const sharedEvents = useMemo(() => visibleShared.flatMap((g) => g.events), [visibleShared]);
  const allEvents = useMemo(() => [...events, ...sharedEvents], [events, sharedEvents]);

  const value = useMemo<DataContextType>(
    () => ({
      todos,
      events,
      loaded,
      addTodo,
      updateTodo,
      deleteTodo,
      toggleTodo,
      setTodoValue,
      addEvent,
      updateEvent,
      deleteEvent,
      importEvents,
      categories,
      addCategory,
      updateCategory,
      deleteCategory,
      categoriesFor,
      categoryById,
      reloadFromStore,
      shared,
      visibleShared,
      sharedEvents,
      allEvents,
      lastSync,
      syncing,
      syncNow,
    }),
    [
      todos,
      events,
      loaded,
      addTodo,
      updateTodo,
      deleteTodo,
      toggleTodo,
      setTodoValue,
      addEvent,
      updateEvent,
      deleteEvent,
      importEvents,
      categories,
      addCategory,
      updateCategory,
      deleteCategory,
      categoriesFor,
      categoryById,
      reloadFromStore,
      shared,
      visibleShared,
      sharedEvents,
      allEvents,
      lastSync,
      syncing,
      syncNow,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within AppProvider');
  return ctx;
}
