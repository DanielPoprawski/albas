import type { CalendarEvent, Habit, Period, Task } from './types';

const STORAGE_KEY = 'albas-data-v1';

export interface LoadedState {
  tasks: Task[];
  habits: Habit[];
  events: CalendarEvent[];
  periods: Period[];
  /** True when the SQLite DB has never imported the pre-SQLite localStorage blob. */
  needsLegacyImport: boolean;
  empty: boolean;
}

export interface Persistence {
  load(): Promise<LoadedState>;
  saveTask(t: Task): void;
  deleteTask(id: string): void;
  saveHabit(h: Habit): void;
  deleteHabit(id: string): void;
  setCompletion(habitId: string, date: string, value: number): void;
  saveEvent(e: CalendarEvent): void;
  deleteEvent(id: string): void;
  savePeriod(p: Period): void;
  deletePeriod(id: string): void;
  /** Tauri only: one-time import of legacy localStorage data. No-op in browser. */
  importLegacy(tasks: Task[], habits: Habit[]): Promise<void>;
}

export function inTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/** Read the legacy/browser localStorage blob (raw, unmigrated). */
export function readLocalBlob(): { tasks: unknown[]; habits: unknown[]; events?: unknown[]; periods?: unknown[] } | null {
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
  // Serial queue: rapid writes (habit +/- clicks) must reach SQLite in order.
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
        tasks: Task[];
        habits: Habit[];
        events: CalendarEvent[];
        periods: Period[];
        needsLegacyImport: boolean;
      }>('load_state');
      return {
        ...data,
        empty:
          data.tasks.length === 0 && data.habits.length === 0 &&
          data.events.length === 0 && data.periods.length === 0,
      };
    },
    saveTask: t => enqueue('save_task', { task: t }),
    deleteTask: id => enqueue('delete_task', { id }),
    saveHabit: h => enqueue('save_habit', { habit: h }),
    deleteHabit: id => enqueue('delete_habit', { id }),
    setCompletion: (habitId, date, value) => enqueue('set_completion', { habitId, date, value }),
    saveEvent: e => enqueue('save_event', { event: e }),
    deleteEvent: id => enqueue('delete_event', { id }),
    savePeriod: p => enqueue('save_period', { period: p }),
    deletePeriod: id => enqueue('delete_period', { id }),
    async importLegacy(tasks, habits) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('import_legacy', { tasks, habits });
    },
  };
}

/** Browser dev server (`npm run dev`): whole-blob localStorage, as before. */
function makeLocalPersistence(): Persistence {
  const state: LoadedState = {
    tasks: [], habits: [], events: [], periods: [],
    needsLegacyImport: false, empty: true,
  };

  function flush(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tasks: state.tasks, habits: state.habits,
        events: state.events, periods: state.periods,
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
        state.tasks = blob.tasks as Task[];
        state.habits = blob.habits as Habit[];
        state.events = (blob.events as CalendarEvent[] | undefined) ?? [];
        state.periods = (blob.periods as Period[] | undefined) ?? [];
        state.empty = false;
      }
      return { ...state };
    },
    saveTask(t) { state.tasks = upsert(state.tasks, t); flush(); },
    deleteTask(id) { state.tasks = state.tasks.filter(t => t.id !== id); flush(); },
    saveHabit(h) {
      // preserve completions when the caller sends habit metadata only
      const existing = state.habits.find(x => x.id === h.id);
      state.habits = upsert(state.habits, { ...h, completions: h.completions ?? existing?.completions ?? {} });
      flush();
    },
    deleteHabit(id) { state.habits = state.habits.filter(h => h.id !== id); flush(); },
    setCompletion(habitId, date, value) {
      state.habits = state.habits.map(h => {
        if (h.id !== habitId) return h;
        const completions = { ...h.completions };
        if (value <= 0) delete completions[date];
        else completions[date] = value;
        return { ...h, completions };
      });
      flush();
    },
    saveEvent(e) { state.events = upsert(state.events, e); flush(); },
    deleteEvent(id) { state.events = state.events.filter(e => e.id !== id); flush(); },
    savePeriod(p) { state.periods = upsert(state.periods, p); flush(); },
    deletePeriod(id) { state.periods = state.periods.filter(p => p.id !== id); flush(); },
    async importLegacy() {},
  };
}

export const persistence: Persistence = inTauri() ? makeTauriPersistence() : makeLocalPersistence();
