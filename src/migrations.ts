// Pure shape-upgrade helpers, moved out of AppContext so sharedLogic.ts can
// reuse them without importing the provider (which imports sharedLogic — a
// cycle otherwise). No React, no persistence: raw saved shapes in, app types out.

import type { CalendarEvent, Repeat, Todo } from './types';
import { fmt } from './dates';
import { DEFAULT_COLOR } from './colors';
import type { LegacyPeriod, LegacyTask } from './persistence';

const todayStr = fmt(new Date());

export function migrateRepeat(s: any): Repeat {
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
    category: typeof t?.category === 'string' ? t.category : '',
    important: !!t?.important,
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
export function taskToTodo(t: LegacyTask): Todo {
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
    // Legacy tasks all defaulted to 'General', so carrying that through would
    // file every imported task under a category the user never chose.
    category: t.category === 'General' ? '' : t.category,
    important: false,
    completions: t.completed ? { [t.date ?? todayStr]: 1 } : {},
  };
}

/** Old periods are just long all-day events now. */
export function periodToEvent(p: LegacyPeriod): CalendarEvent {
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
