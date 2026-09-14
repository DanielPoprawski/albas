import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from '../dates';
import * as ipc from '../ipc';
import type { SyncOutcome } from '../ipc';
import { migrateLegacyTask, migrateTodo, periodToEvent, remapLegacyCategory, taskToTodo } from '../migrations';
import { inTauri, persistence, readLocalBlob } from '../persistence';
import { displayColor, TODO_CATEGORIES } from '../colors';
import { initialTodos } from '../seedData';
import { mapSharedRows } from '../sharedLogic';
import { onSyncRequest } from '../syncBus';
import { isRepeating } from '../todoLogic';
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
  /**
   * Debounced push after an edit (`__sync_debounce_ms`, default 2 s). Every
   * mutator calls it; a sync already in flight marks it dirty and re-runs
   * once done. No-op outside Tauri or while no server is configured.
   */
  scheduleSync: () => void;
}

const DEBOUNCE_DEFAULT_MS = 2000;
const DEBOUNCE_MIN_MS = 500;
const DEBOUNCE_MAX_MS = 10000;
/** Upper bound on the close-time push: a dead server must not hold the window hostage. */
const CLOSE_SYNC_TIMEOUT_MS = 5000;

const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

/** Persists the starter to-dos (and their completions) and returns them. */
function seedDemoTodos(): Todo[] {
  for (const t of initialTodos) {
    persistence.saveTodo(t);
    for (const [d, v] of Object.entries(t.completions)) persistence.setCompletion(t.id, d, v);
  }
  return initialTodos;
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
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const initStarted = useRef(false);
  // Sync bookkeeping lives in refs so the mutators (and the timer callbacks
  // they arm) keep one identity for the life of the provider.
  const configured = useRef(false);
  const inflight = useRef<Promise<SyncOutcome> | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef<Promise<void> | null>(null);
  const getSettingRef = useRef(getSetting);
  getSettingRef.current = getSetting;
  const syncNowRef = useRef<() => Promise<SyncOutcome>>(() => Promise.reject(new Error('sync not ready')));

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

    // The launch sync starts alongside the store read rather than after first
    // paint, but is never awaited before it: a slow or unreachable server must
    // not delay startup. Raw `ipc.syncNow` here, not `syncNow` — its reload
    // would race the initial load's own state writes; the pull is folded in
    // once both have settled.
    const startupSync = (async (): Promise<SyncOutcome | null> => {
      if (!inTauri()) return null;
      const status = await ipc.syncStatus();
      configured.current = status.configured;
      if (!status.configured) return null;
      setSyncing(true);
      try {
        return await ipc.syncNow();
      } finally {
        setSyncing(false);
      }
    })();

    const load = async () => {
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

        // Demo data goes only where it can't leak into an account: never on
        // a signed-in device (the first sync would push it), and in Tauri
        // only once the Welcome gate has been dismissed with "use offline"
        // (`seedDemoIfEmpty` handles that moment; a fresh install that
        // signs in from Welcome must start empty). The browser dev server
        // has no gate and no sync, so it seeds on first load as before.
        const signedInAtLoad = !!state.settings.__sync_token?.trim();
        const welcomeDoneAtLoad = state.settings.__welcome_done === '1';
        const seedNow = state.empty && !signedInAtLoad && (!inTauri() || welcomeDoneAtLoad);

        let finalTodos: Todo[];
        if (seedNow) {
          finalTodos = seedDemoTodos();
          setTodos(finalTodos);
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
        // Stay empty rather than show demo rows: the first edit would persist
        // them (fixed ids) into whatever store just failed to read.
        console.error('failed to load persisted data:', err);
      }
      setLoaded(true);
    };

    (async () => {
      const [, synced] = await Promise.allSettled([load(), startupSync]);
      if (synced.status === 'rejected') {
        console.warn('startup sync failed:', synced.reason);
        return;
      }
      const out = synced.value;
      if (!out) return;
      try {
        if (out.pulled > 0 || out.sharedChanged) await reloadFromStore();
        if (out.lastSync) setLastSync(Number(out.lastSync));
      } catch (err) {
        console.warn('failed to fold the startup sync in:', err);
      }
      if (dirty.current) {
        dirty.current = false;
        scheduleSync();
      }
    })();
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

  const seedDemoIfEmpty = useCallback(() => {
    setTodos((prev) => (prev.length === 0 ? seedDemoTodos() : prev));
  }, []);

  const scheduleSync = useCallback(() => {
    if (!inTauri() || !configured.current) return;
    if (inflight.current) {
      dirty.current = true; // re-run once the current one finishes
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    const raw = Number.parseInt(getSettingRef.current('__sync_debounce_ms') ?? '', 10);
    const delay = Math.min(DEBOUNCE_MAX_MS, Math.max(DEBOUNCE_MIN_MS, raw || DEBOUNCE_DEFAULT_MS));
    timer.current = setTimeout(() => {
      timer.current = null;
      syncNowRef.current().catch((err) => console.warn('background sync failed:', err));
    }, delay);
  }, []);

  /**
   * The one place a sync is run from. Rust merges straight into SQLite, so a
   * pull has to be read back into React here; doing that per caller is how the
   * status bar and Settings would come to disagree about what is on screen and
   * when it last arrived. Queued store writes are flushed first so the push
   * carries them. Overlapping calls share the in-flight run and queue one more.
   */
  const syncNow = useCallback(async (): Promise<SyncOutcome> => {
    if (inflight.current) {
      dirty.current = true;
      return inflight.current;
    }
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setSyncing(true);
    const run = (async () => {
      try {
        await persistence.flush();
        const out = await ipc.syncNow();
        configured.current = true;
        if (out.pulled > 0 || out.sharedChanged) await reloadFromStore();
        if (out.lastSync) setLastSync(Number(out.lastSync));
        return out;
      } finally {
        inflight.current = null;
        setSyncing(false);
        if (dirty.current) {
          dirty.current = false;
          scheduleSync();
        }
      }
    })();
    inflight.current = run;
    return run;
  }, [reloadFromStore, scheduleSync]);
  syncNowRef.current = syncNow;

  // Settings writes (outer provider) ask for a push through the bus.
  useEffect(() => onSyncRequest(scheduleSync), [scheduleSync]);

  // Desktop close: hold the window until queued writes are on disk and one
  // push has been attempted (bounded), then destroy it for real. A second
  // close request while that runs just waits on the same promise.
  useEffect(() => {
    if (!inTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    ipc
      .onCloseRequested(async (e) => {
        e.preventDefault();
        if (!closing.current) {
          closing.current = (async () => {
            if (timer.current) clearTimeout(timer.current);
            try {
              await persistence.flush();
            } catch {
              // nothing more to do about it at close time
            }
            if (configured.current) {
              try {
                await Promise.race([syncNowRef.current(), timeout(CLOSE_SYNC_TIMEOUT_MS)]);
              } catch {
                // offline or server down — the next launch's sync recovers
              }
            }
            try {
              await ipc.destroyWindow();
            } catch (err) {
              console.warn('destroy on close failed:', err);
              closing.current = null;
            }
          })();
        }
        await closing.current;
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => console.warn('close handler not registered:', err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Backgrounding (Android has no close event): flush, then push. Fire and
  // forget — the OS may kill the process before the sync lands, in which case
  // the next launch's sync carries it.
  useEffect(() => {
    if (!inTauri()) return;
    const push = () => {
      if (!configured.current) return;
      persistence
        .flush()
        .then(() => syncNowRef.current())
        .catch(() => {});
    };
    const onVisibility = () => {
      if (document.hidden) push();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', push);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', push);
    };
  }, []);

  // Rust owns the stamp, and not every sync passes through `syncNow`: the
  // browser sign-in flow (`useBrowserSignIn`) syncs from inside the poll
  // loop, so on sign-in React can only learn when that happened by asking.
  // Signing out clears it — the next account's history is not this one's.
  useEffect(() => {
    if (!inTauri()) return;
    if (!signedIn) {
      configured.current = false;
      setLastSync(null);
      return;
    }
    (async () => {
      try {
        const status = await ipc.syncStatus();
        configured.current = status.configured;
        setLastSync(status.lastSync ? Number(status.lastSync) : null);
      } catch {
        // backend not ready — the bar reads "never synced" until one runs
      }
    })();
  }, [signedIn]);

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
  // stored key, which is what the mutators patch and persist.
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
