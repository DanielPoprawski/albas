import type { CalendarEvent, Todo, WeightEntry } from './types';

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
  weights: WeightEntry[];
  /** Free-form user preferences (theme, weightUnit, …). */
  settings: Record<string, string>;
  /** Rows from the pre-unification tables, pending conversion. */
  legacyTasks: LegacyTask[];
  legacyPeriods: LegacyPeriod[];
  /** True when the SQLite DB has never imported the pre-SQLite localStorage blob. */
  needsLegacyImport: boolean;
  empty: boolean;
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
  saveWeight(w: WeightEntry): void;
  deleteWeight(id: string): void;
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
  tasks: unknown[]; habits: unknown[];
  events?: unknown[]; periods?: unknown[];
  weights?: unknown[]; settings?: unknown;
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
  function enqueue(cmd: string, args: Record<string, unknown>): void {
    queue = queue
      .then(async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke(cmd, args);
      })
      .catch(err => console.warn(`persistence: ${cmd} failed:`, err));
  }

  return {
    async load() {
      const { invoke } = await import('@tauri-apps/api/core');
      const data = await invoke<{
        tasks: LegacyTask[];
        habits: Todo[];
        events: CalendarEvent[];
        periods: LegacyPeriod[];
        weights: WeightEntry[];
        settings: Record<string, string>;
        needsLegacyImport: boolean;
      }>('load_state');
      return {
        todos: data.habits,
        events: data.events,
        weights: data.weights,
        settings: data.settings,
        legacyTasks: data.tasks,
        legacyPeriods: data.periods,
        needsLegacyImport: data.needsLegacyImport,
        // weights/settings deliberately excluded: a fresh install with only a
        // theme picked still wants the starter to-dos seeded.
        empty:
          data.tasks.length === 0 && data.habits.length === 0 &&
          data.events.length === 0 && data.periods.length === 0,
      };
    },
    saveTodo: t => enqueue('save_habit', { habit: t }),
    deleteTodo: id => enqueue('delete_habit', { id }),
    setCompletion: (todoId, date, value) => enqueue('set_completion', { habitId: todoId, date, value }),
    saveEvent: e => enqueue('save_event', { event: e }),
    deleteEvent: id => enqueue('delete_event', { id }),
    saveWeight: w => enqueue('save_weight', { weight: w }),
    deleteWeight: id => enqueue('delete_weight', { id }),
    setSetting: (key, value) => enqueue('set_setting', { key, value }),
    deleteTask: id => enqueue('delete_task', { id }),
    deletePeriod: id => enqueue('delete_period', { id }),
    async importLegacy(tasks, todos) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('import_legacy', { tasks, habits: todos });
    },
  };
}

/** Browser dev server (`npm run dev`): whole-blob localStorage, as before. */
function makeLocalPersistence(): Persistence {
  const state = {
    todos: [] as Todo[],
    events: [] as CalendarEvent[],
    weights: [] as WeightEntry[],
    settings: {} as Record<string, string>,
    legacyTasks: [] as LegacyTask[],
    legacyPeriods: [] as LegacyPeriod[],
  };

  function flush(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tasks: state.legacyTasks, habits: state.todos,
        events: state.events, periods: state.legacyPeriods,
        weights: state.weights, settings: state.settings,
      }));
    } catch {
      // storage full or unavailable — app keeps working in memory
    }
  }

  function upsert<T extends { id: string }>(list: T[], item: T): T[] {
    const i = list.findIndex(x => x.id === item.id);
    return i === -1 ? [...list, item] : list.map(x => (x.id === item.id ? item : x));
  }

  return {
    async load() {
      const blob = readLocalBlob();
      if (blob) {
        state.legacyTasks = blob.tasks as LegacyTask[];
        state.todos = blob.habits as Todo[];
        state.events = (blob.events as CalendarEvent[] | undefined) ?? [];
        state.legacyPeriods = (blob.periods as LegacyPeriod[] | undefined) ?? [];
        state.weights = (blob.weights as WeightEntry[] | undefined) ?? [];
        state.settings = (blob.settings as Record<string, string> | undefined) ?? {};
      }
      return {
        ...state,
        needsLegacyImport: false,
        empty:
          state.todos.length === 0 && state.events.length === 0 &&
          state.legacyTasks.length === 0 && state.legacyPeriods.length === 0,
      };
    },
    saveTodo(t) {
      // preserve completions when the caller sends metadata only
      const existing = state.todos.find(x => x.id === t.id);
      state.todos = upsert(state.todos, { ...t, completions: t.completions ?? existing?.completions ?? {} });
      flush();
    },
    deleteTodo(id) { state.todos = state.todos.filter(t => t.id !== id); flush(); },
    setCompletion(todoId, date, value) {
      state.todos = state.todos.map(t => {
        if (t.id !== todoId) return t;
        const completions = { ...t.completions };
        if (value <= 0) delete completions[date];
        else completions[date] = value;
        return { ...t, completions };
      });
      flush();
    },
    saveEvent(e) { state.events = upsert(state.events, e); flush(); },
    deleteEvent(id) { state.events = state.events.filter(e => e.id !== id); flush(); },
    saveWeight(w) { state.weights = upsert(state.weights, w); flush(); },
    deleteWeight(id) { state.weights = state.weights.filter(w => w.id !== id); flush(); },
    setSetting(key, value) { state.settings = { ...state.settings, [key]: value }; flush(); },
    deleteTask(id) { state.legacyTasks = state.legacyTasks.filter(t => t.id !== id); flush(); },
    deletePeriod(id) { state.legacyPeriods = state.legacyPeriods.filter(p => p.id !== id); flush(); },
    async importLegacy() {},
  };
}

export const persistence: Persistence = inTauri() ? makeTauriPersistence() : makeLocalPersistence();
