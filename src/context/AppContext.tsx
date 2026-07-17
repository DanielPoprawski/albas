import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ActiveView, CalendarEvent, CalendarMode, Habit, Period, Task } from '../types';
import { fmt, parse, weekOf } from '../dates';
import { inTauri, persistence, readLocalBlob } from '../persistence';

const today = new Date();
const todayStr = fmt(today);

// Seed demo data on the current Mon–Sun week so it lines up with the weekly tracker,
// but never on future days.
const weekDates = weekOf(today).filter(d => d <= todayStr);
const weekAgo = new Date(today);
weekAgo.setDate(today.getDate() - 7);
const weekAgoStr = fmt(weekAgo);

const initialTasks: Task[] = [
  { id: '1', title: 'Finalize Q4 roadmap', category: 'Planning', completed: false, date: null },
  { id: '2', title: 'Client meeting prep', category: 'Marketing', completed: false, date: todayStr },
  { id: '3', title: 'Inbox Zero', category: 'General', completed: true, date: null },
];

const initialHabits: Habit[] = [
  {
    id: '1', name: 'Deep Work', colorKey: 'secondary', kind: 'measurable', unit: 'h', target: 4,
    schedule: { type: 'weekdays', days: [1, 2, 3, 4, 5] }, createdAt: weekAgoStr, reminder: false,
    completions: Object.fromEntries(
      weekDates.filter(d => { const day = parse(d).getDay(); return day >= 1 && day <= 5; }).map(d => [d, 4])
    ),
  },
  {
    id: '2', name: 'Meditation', colorKey: 'tertiary', kind: 'yesno', unit: '', target: 1,
    schedule: { type: 'daily' }, createdAt: weekAgoStr, reminder: false,
    completions: Object.fromEntries(weekDates.filter((_, i) => i % 2 === 0).map(d => [d, 1])),
  },
  {
    id: '3', name: 'Take out trash', colorKey: 'primary', kind: 'yesno', unit: '', target: 1,
    schedule: { type: 'chore', every: 3 }, createdAt: weekAgoStr, reminder: true,
    completions: weekDates.length > 2 ? { [weekDates[weekDates.length - 3]]: 1 } : {},
  },
];

/** Validate/repair tasks saved by older versions of the app. */
export function migrateTask(t: any): Task {
  return {
    id: typeof t?.id === 'string' && t.id ? t.id : crypto.randomUUID(),
    title: typeof t?.title === 'string' ? t.title : 'Task',
    category: typeof t?.category === 'string' && t.category ? t.category : 'General',
    completed: !!t?.completed,
    date: typeof t?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null,
  };
}

/** Upgrade habits saved by older versions of the app to the current shape. */
export function migrateHabit(h: any): Habit {
  const completions: Record<string, number> = {};
  for (const [d, v] of Object.entries(h.completions ?? {})) {
    if (typeof v === 'number') completions[d] = v;
    else if (v === true) completions[d] = 1;
  }
  const dates = Object.keys(completions).sort();
  return {
    id: h.id ?? crypto.randomUUID(),
    name: h.name ?? 'Habit',
    colorKey: ['primary', 'secondary', 'tertiary'].includes(h.colorKey) ? h.colorKey : 'primary',
    kind: h.kind === 'measurable' ? 'measurable' : 'yesno',
    unit: typeof h.unit === 'string' ? h.unit : '',
    target: typeof h.target === 'number' && h.target > 0 ? h.target : 1,
    schedule: h.schedule?.type ? h.schedule : { type: 'daily' },
    createdAt: h.createdAt ?? dates[0] ?? todayStr,
    reminder: !!h.reminder,
    completions,
  };
}

export type NewHabit = Omit<Habit, 'id' | 'completions' | 'createdAt'>;
export type NewEvent = Omit<CalendarEvent, 'id'>;
export type NewPeriod = Omit<Period, 'id'>;

interface AppContextType {
  tasks: Task[];
  habits: Habit[];
  events: CalendarEvent[];
  periods: Period[];
  loaded: boolean;
  selectedDate: string | null;
  currentMonth: Date;
  activeView: ActiveView;
  calendarMode: CalendarMode;
  setSelectedDate: (date: string | null) => void;
  setCurrentMonth: React.Dispatch<React.SetStateAction<Date>>;
  setActiveView: (view: ActiveView) => void;
  setCalendarMode: (mode: CalendarMode) => void;
  addTask: (title: string, category: string, date: string | null) => void;
  updateTask: (id: string, updates: Partial<Omit<Task, 'id'>>) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  addHabit: (habit: NewHabit) => void;
  updateHabit: (id: string, updates: Partial<Omit<Habit, 'id' | 'completions'>>) => void;
  deleteHabit: (id: string) => void;
  /** Yes/no: toggles done. Measurable: jumps to target, or back to 0 if already done. */
  toggleHabit: (habitId: string, date: string) => void;
  setHabitValue: (habitId: string, date: string, value: number) => void;
  addEvent: (event: NewEvent) => void;
  updateEvent: (id: string, updates: Partial<Omit<CalendarEvent, 'id'>>) => void;
  deleteEvent: (id: string) => void;
  addPeriod: (period: NewPeriod) => void;
  updatePeriod: (id: string, updates: Partial<Omit<Period, 'id'>>) => void;
  deletePeriod: (id: string) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
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

        if (inTauri() && state.needsLegacyImport) {
          const blob = readLocalBlob();
          if (blob) {
            await persistence.importLegacy(blob.tasks.map(migrateTask), blob.habits.map(migrateHabit));
            state = await persistence.load();
          }
        }

        if (state.empty) {
          // first launch anywhere — seed the demo data through the store
          initialTasks.forEach(t => persistence.saveTask(t));
          initialHabits.forEach(h => {
            persistence.saveHabit(h);
            Object.entries(h.completions).forEach(([d, v]) => persistence.setCompletion(h.id, d, v));
          });
          setTasks(initialTasks);
          setHabits(initialHabits);
        } else {
          setTasks(state.tasks.map(migrateTask));
          setHabits(state.habits.map(migrateHabit));
          setEvents(state.events);
          setPeriods(state.periods);
        }
      } catch (err) {
        console.error('failed to load persisted data:', err);
        setTasks(initialTasks);
        setHabits(initialHabits);
      }
      setLoaded(true);
    })();
  }, []);

  function addTask(title: string, category: string, date: string | null) {
    const task: Task = { id: crypto.randomUUID(), title, category, completed: false, date };
    setTasks(prev => [...prev, task]);
    persistence.saveTask(task);
  }

  function updateTask(id: string, updates: Partial<Omit<Task, 'id'>>) {
    const current = tasks.find(t => t.id === id);
    if (!current) return;
    const next = { ...current, ...updates };
    setTasks(prev => prev.map(t => (t.id === id ? next : t)));
    persistence.saveTask(next);
  }

  function toggleTask(id: string) {
    const current = tasks.find(t => t.id === id);
    if (!current) return;
    const next = { ...current, completed: !current.completed };
    setTasks(prev => prev.map(t => (t.id === id ? next : t)));
    persistence.saveTask(next);
  }

  function deleteTask(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
    persistence.deleteTask(id);
  }

  function addHabit(habit: NewHabit) {
    const full: Habit = { ...habit, id: crypto.randomUUID(), createdAt: todayStr, completions: {} };
    setHabits(prev => [...prev, full]);
    persistence.saveHabit(full);
  }

  function updateHabit(id: string, updates: Partial<Omit<Habit, 'id' | 'completions'>>) {
    const current = habits.find(h => h.id === id);
    if (!current) return;
    const next = { ...current, ...updates };
    setHabits(prev => prev.map(h => (h.id === id ? next : h)));
    persistence.saveHabit(next);
  }

  function deleteHabit(id: string) {
    setHabits(prev => prev.filter(h => h.id !== id));
    // unlink from any periods that referenced it
    const affected = periods.filter(p => p.habitIds.includes(id))
      .map(p => ({ ...p, habitIds: p.habitIds.filter(hid => hid !== id) }));
    if (affected.length > 0) {
      setPeriods(prev => prev.map(p => affected.find(a => a.id === p.id) ?? p));
      affected.forEach(p => persistence.savePeriod(p));
    }
    persistence.deleteHabit(id);
  }

  function setHabitValue(habitId: string, date: string, value: number) {
    setHabits(prev => prev.map(h => {
      if (h.id !== habitId) return h;
      const completions = { ...h.completions };
      if (value <= 0) delete completions[date];
      else completions[date] = value;
      return { ...h, completions };
    }));
    persistence.setCompletion(habitId, date, value);
  }

  function toggleHabit(habitId: string, date: string) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;
    const current = habit.completions[date] ?? 0;
    setHabitValue(habitId, date, current >= habit.target ? 0 : habit.target);
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

  function addPeriod(period: NewPeriod) {
    const full: Period = { ...period, id: crypto.randomUUID() };
    setPeriods(prev => [...prev, full]);
    persistence.savePeriod(full);
  }

  function updatePeriod(id: string, updates: Partial<Omit<Period, 'id'>>) {
    const current = periods.find(p => p.id === id);
    if (!current) return;
    const next = { ...current, ...updates };
    setPeriods(prev => prev.map(p => (p.id === id ? next : p)));
    persistence.savePeriod(next);
  }

  function deletePeriod(id: string) {
    setPeriods(prev => prev.filter(p => p.id !== id));
    persistence.deletePeriod(id);
  }

  return (
    <AppContext.Provider value={{
      tasks, habits, events, periods, loaded,
      selectedDate, currentMonth, activeView, calendarMode,
      setSelectedDate, setCurrentMonth, setActiveView, setCalendarMode,
      addTask, updateTask, toggleTask, deleteTask,
      addHabit, updateHabit, deleteHabit, toggleHabit, setHabitValue,
      addEvent, updateEvent, deleteEvent,
      addPeriod, updatePeriod, deletePeriod,
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
