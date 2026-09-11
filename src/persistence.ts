import type { CalendarEvent, Category, CategoryScope, Todo } from './types';
import * as ipc from './ipc';
import type { CategoryRow } from './ipc';

const STORAGE_KEY = 'albas-data-v1';

/**
 * Raw rows saved by older app versions, still readable so AppContext can
 * convert them on load: tasks become once-todos, periods become events.
 */
export interface LegacyTask {
  id: string;
  title: string;
  category: string;
  completed: boolean;
  date: string | null;
}

export interface LegacyPeriod {
  id: string;
  name: string;
  colorKey: string;
  startDate: string;
  endDate: string;
  notes: string;
  habitIds: string[];
}

export interface LoadedState {
  todos: Todo[];
  events: CalendarEvent[];
  categories: Category[];
  /** Free-form user preferences (theme, …). */
  settings: Record<string, string>;
  /** Rows from the pre-unification tables, pending conversion. */
  legacyTasks: LegacyTask[];
  legacyPeriods: LegacyPeriod[];
  /** True when the SQLite DB has never imported the pre-SQLite localStorage blob. */
  needsLegacyImport: boolean;
  empty: boolean;
}

const SCOPE_VALUES: CategoryScope[] = ['calendar', 'tasks', 'habits'];

/** `scopes` is a CSV in SQLite/sync payloads; the app works with the array. */
function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    colorKey: row.colorKey,
    sort: row.sort,
    scopes: row.scopes
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is CategoryScope => SCOPE_VALUES.includes(s as CategoryScope)),
  };
}

function categoryToRow(c: Category): CategoryRow {
  return { id: c.id, name: c.name, colorKey: c.colorKey, sort: c.sort, scopes: c.scopes.join(',') };
}

/**
 * Todos live in the former `habits` table/commands — the table already had
 * the schedule + completions shape, so unification reuses it as-is.
 */
export interface Persistence {
  load(): Promise<LoadedState>;
  saveTodo(t: Todo): void;
  deleteTodo(id: string): void;
  setCompletion(todoId: string, date: string, value: number): void;
  saveEvent(e: CalendarEvent): void;
  deleteEvent(id: string): void;
  saveCategory(c: Category): void;
  deleteCategory(id: string): void;
  setSetting(key: string, value: string): void;
  /** Legacy-conversion writes only. */
  deleteTask(id: string): void;
  deletePeriod(id: string): void;
  /** Tauri only: one-time import of legacy localStorage data. No-op in browser. */
  importLegacy(tasks: LegacyTask[], todos: Todo[]): Promise<void>;
}

export function inTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/** Read the legacy/browser localStorage blob (raw, unmigrated). */
export function readLocalBlob(): {
  tasks: unknown[];
  habits: unknown[];
  events?: unknown[];
  periods?: unknown[];
  categories?: unknown[];
  settings?: unknown;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.tasks) && Array.isArray(parsed?.habits)) return parsed;
  } catch {
    // corrupted storage
  }
  return null;
}

function makeTauriPersistence(): Persistence {
  // Serial queue: rapid writes (todo +/- clicks) must reach SQLite in order.
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue(label: string, run: () => Promise<unknown>): void {
    queue = queue.then(run).catch((err) => console.warn(`persistence: ${label} failed:`, err));
  }

  return {
    async load() {
      const data = await ipc.loadState();
      return {
        todos: data.habits,
        events: data.events,
        categories: data.categories.map(rowToCategory),
        settings: data.settings,
        legacyTasks: data.tasks,
        legacyPeriods: data.periods,
        needsLegacyImport: data.needsLegacyImport,
        // settings/categories deliberately excluded: a fresh install
        // with only a theme picked still wants the starter to-dos (and their
        // categories) seeded.
        empty:
          data.tasks.length === 0 && data.habits.length === 0 && data.events.length === 0 && data.periods.length === 0,
      };
    },
    saveTodo: (t) => enqueue('save_habit', () => ipc.saveHabit(t)),
    deleteTodo: (id) => enqueue('delete_habit', () => ipc.deleteHabit(id)),
    setCompletion: (todoId, date, value) => enqueue('set_completion', () => ipc.setCompletion(todoId, date, value)),
    saveEvent: (e) => enqueue('save_event', () => ipc.saveEvent(e)),
    deleteEvent: (id) => enqueue('delete_event', () => ipc.deleteEvent(id)),
    saveCategory: (c) => enqueue('save_category', () => ipc.saveCategory(categoryToRow(c))),
    deleteCategory: (id) => enqueue('delete_category', () => ipc.deleteCategory(id)),
    setSetting: (key, value) => enqueue('set_setting', () => ipc.setSetting(key, value)),
    deleteTask: (id) => enqueue('delete_task', () => ipc.deleteTask(id)),
    deletePeriod: (id) => enqueue('delete_period', () => ipc.deletePeriod(id)),
    async importLegacy(tasks, todos) {
      await ipc.importLegacy(tasks, todos);
    },
  };
}

/** Browser dev server (`npm run dev`): whole-blob localStorage, as before. */
function makeLocalPersistence(): Persistence {
  const state = {
    todos: [] as Todo[],
    events: [] as CalendarEvent[],
    categories: [] as Category[],
    settings: {} as Record<string, string>,
    legacyTasks: [] as LegacyTask[],
    legacyPeriods: [] as LegacyPeriod[],
  };

  function flush(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          tasks: state.legacyTasks,
          habits: state.todos,
          events: state.events,
          periods: state.legacyPeriods,
          categories: state.categories,
          settings: state.settings,
        }),
      );
    } catch {
      // storage full or unavailable — app keeps working in memory
    }
  }

  function upsert<T extends { id: string }>(list: T[], item: T): T[] {
    const i = list.findIndex((x) => x.id === item.id);
    return i === -1 ? [...list, item] : list.map((x) => (x.id === item.id ? item : x));
  }

  return {
    async load() {
      const blob = readLocalBlob();
      if (blob) {
        state.legacyTasks = blob.tasks as LegacyTask[];
        state.todos = blob.habits as Todo[];
        // Old blobs (pre-Phase K) never wrote `category` on events; default it
        // so every event in state is a well-formed CalendarEvent.
        state.events = ((blob.events as CalendarEvent[] | undefined) ?? []).map((e) => ({
          ...e,
          category: e.category ?? '',
        }));
        state.legacyPeriods = (blob.periods as LegacyPeriod[] | undefined) ?? [];
        state.categories = (blob.categories as Category[] | undefined) ?? [];
        state.settings = (blob.settings as Record<string, string> | undefined) ?? {};
      }
      return {
        ...state,
        needsLegacyImport: false,
        empty:
          state.todos.length === 0 &&
          state.events.length === 0 &&
          state.legacyTasks.length === 0 &&
          state.legacyPeriods.length === 0,
      };
    },
    saveTodo(t) {
      // preserve completions when the caller sends metadata only
      const existing = state.todos.find((x) => x.id === t.id);
      state.todos = upsert(state.todos, { ...t, completions: t.completions ?? existing?.completions ?? {} });
      flush();
    },
    deleteTodo(id) {
      state.todos = state.todos.filter((t) => t.id !== id);
      flush();
    },
    setCompletion(todoId, date, value) {
      state.todos = state.todos.map((t) => {
        if (t.id !== todoId) return t;
        const completions = { ...t.completions };
        if (value <= 0) delete completions[date];
        else completions[date] = value;
        return { ...t, completions };
      });
      flush();
    },
    saveEvent(e) {
      state.events = upsert(state.events, e);
      flush();
    },
    deleteEvent(id) {
      state.events = state.events.filter((e) => e.id !== id);
      flush();
    },
    saveCategory(c) {
      state.categories = upsert(state.categories, c);
      flush();
    },
    deleteCategory(id) {
      state.categories = state.categories.filter((c) => c.id !== id);
      flush();
    },
    setSetting(key, value) {
      state.settings = { ...state.settings, [key]: value };
      flush();
    },
    deleteTask(id) {
      state.legacyTasks = state.legacyTasks.filter((t) => t.id !== id);
      flush();
    },
    deletePeriod(id) {
      state.legacyPeriods = state.legacyPeriods.filter((p) => p.id !== id);
      flush();
    },
    async importLegacy() {},
  };
}

export const persistence: Persistence = inTauri() ? makeTauriPersistence() : makeLocalPersistence();
