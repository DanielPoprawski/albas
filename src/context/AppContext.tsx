import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type {
  ActiveView, CalendarEvent, CalendarMode, FirstDayOfWeek, Repeat, ThemeName, Todo, WeightEntry, WeightUnit,
} from '../types';
import { fmt, parse, weekOf } from '../dates';
import { inTauri, persistence, readLocalBlob, type LegacyPeriod, type LegacyTask } from '../persistence';
import { DEFAULT_COLOR } from '../colors';

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

function migrateRepeat(s: any): Repeat {
  switch (s?.type) {
    case 'once':
      return { type: 'once' };
    case 'daily':
      return { type: 'daily' };
    case 'weekdays': {
      const days = Array.isArray(s.days) ? s.days.filter((d: unknown) => typeof d === 'number' && d >= 0 && d <= 6) : [];
      return { type: 'weekdays', days: days.length > 0 ? days : [1, 2, 3, 4, 5] };
    }
    // pre-unification shapes: interval = fixed cadence, chore = from last done
    case 'interval':
      return { type: 'every', n: s.every > 0 ? s.every : 1, unit: 'day', fromDone: false };
    case 'chore':
      return { type: 'every', n: s.every > 0 ? s.every : 1, unit: 'day', fromDone: true };
    case 'every':
      return {
        type: 'every',
        n: typeof s.n === 'number' && s.n > 0 ? s.n : 1,
        unit: ['day', 'week', 'month'].includes(s.unit) ? s.unit : 'day',
        fromDone: !!s.fromDone,
      };
    case 'timesPer':
      return {
        type: 'timesPer',
        times: typeof s.times === 'number' && s.times > 0 ? s.times : 1,
        per: s.per === 'month' ? 'month' : 'week',
      };
    default:
      return { type: 'daily' };
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Upgrade todos (or pre-unification habits) saved by older versions of the app. */
export function migrateTodo(t: any): Todo {
  const completions: Record<string, number> = {};
  for (const [d, v] of Object.entries(t?.completions ?? {})) {
    if (typeof v === 'number') completions[d] = v;
    else if (v === true) completions[d] = 1;
  }
  const dates = Object.keys(completions).sort();
  return {
    id: typeof t?.id === 'string' && t.id ? t.id : crypto.randomUUID(),
    name: t?.name ?? 'To-do',
    colorKey: typeof t?.colorKey === 'string' && t.colorKey ? t.colorKey : DEFAULT_COLOR,
    kind: t?.kind === 'measurable' ? 'measurable' : 'yesno',
    unit: typeof t?.unit === 'string' ? t.unit : '',
    target: typeof t?.target === 'number' && t.target > 0 ? t.target : 1,
    schedule: migrateRepeat(t?.schedule),
    dueDate: typeof t?.dueDate === 'string' && DATE_RE.test(t.dueDate) ? t.dueDate : null,
    time: typeof t?.time === 'string' && /^\d{2}:\d{2}$/.test(t.time) ? t.time : null,
    createdAt: t?.createdAt ?? dates[0] ?? todayStr,
    reminder: !!t?.reminder,
    completions,
  };
}

/** Validate/repair tasks saved by pre-SQLite versions (still the shape import_legacy expects). */
export function migrateLegacyTask(t: any): LegacyTask {
  return {
    id: typeof t?.id === 'string' && t.id ? t.id : crypto.randomUUID(),
    title: typeof t?.title === 'string' ? t.title : 'Task',
    category: typeof t?.category === 'string' && t.category ? t.category : 'General',
    completed: !!t?.completed,
    date: typeof t?.date === 'string' && DATE_RE.test(t.date) ? t.date : null,
  };
}

/** Old standalone tasks are just once-todos now. */
function taskToTodo(t: LegacyTask): Todo {
  return {
    id: t.id,
    name: t.title,
    colorKey: DEFAULT_COLOR,
    kind: 'yesno',
    unit: '',
    target: 1,
    schedule: { type: 'once' },
    dueDate: t.date,
    time: null,
    createdAt: t.date ?? todayStr,
    reminder: false,
    completions: t.completed ? { [t.date ?? todayStr]: 1 } : {},
  };
}

/** Old periods are just long all-day events now. */
function periodToEvent(p: LegacyPeriod): CalendarEvent {
  return {
    id: p.id,
    title: p.name,
    description: p.notes ?? '',
    colorKey: p.colorKey ?? DEFAULT_COLOR,
    allDay: true,
    startDate: p.startDate,
    startTime: null,
    endDate: p.endDate >= p.startDate ? p.endDate : p.startDate,
    endTime: null,
    recurrence: { type: 'none' },
    reminders: [],
  };
}

export type NewTodo = Omit<Todo, 'id' | 'completions' | 'createdAt'>;
export type NewEvent = Omit<CalendarEvent, 'id'>;

export type NewWeight = Omit<WeightEntry, 'id'>;

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
}

const THEMES: ThemeName[] = ['dark', 'light', 'grey-high', 'grey-low'];

function readTheme(settings: Record<string, string>): ThemeName {
  const t = settings.theme as ThemeName | undefined;
  return t && THEMES.includes(t) ? t : 'dark';
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
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr);
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [activeView, setActiveView] = useState<ActiveView>('calendar');
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month');
  const initStarted = useRef(false);

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
      } catch (err) {
        console.error('failed to load persisted data:', err);
        setTodos(initialTodos);
      }
      setLoaded(true);
    })();
  }, []);

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
      firstDayOfWeek: settings.firstDayOfWeek === '0' ? 0 : 1,
      setSetting,
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
