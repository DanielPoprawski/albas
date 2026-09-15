import { DEFAULT_COLOR } from './colors';
import { addMinutes } from './dates';
import type { AddType, NewEvent, NewTodo, Recurrence, Repeat } from './types';

export type EventRepeat = 'Never' | 'Daily' | 'Weekdays' | 'Weekly' | 'Monthly' | 'Yearly' | 'Custom';

/**
 * Everything a create surface may know about a new item. Every field but
 * `startDate` is optional so a one-line quick-add and the full modal share
 * one payload builder; an omitted field is the default, not a choice.
 */
export interface CreateOptions {
  startDate: string;
  /** Events: `HH:MM`, ignored when `allDay`. To-dos: the optional time of day. */
  startTime?: string | null;
  endDate?: string;
  endTime?: string | null;
  allDay?: boolean;
  /** Tasks: the due day (null/undefined = anytime). Habits: the anchor day, defaults to `startDate`. */
  dueDate?: string | null;
  location?: string;
  description?: string;
  repeat?: EventRepeat;
  /** Explicit event recurrence, overriding `repeat` when present. */
  eventRecurrence?: Recurrence;
  /** Habits: the repeat rule (defaults to daily). Ignored for tasks. */
  schedule?: Repeat;
  /** Tasks: starred. */
  important?: boolean;
  category?: string;
  target?: number;
  reminderMins?: number[];
}

export type CreatePayload = { kind: 'event'; event: NewEvent } | { kind: 'todo'; todo: NewTodo };

const RECURRENCE: Record<EventRepeat, Recurrence> = {
  Never: { type: 'none' },
  Daily: { type: 'daily', interval: 1 },
  Weekdays: { type: 'weekdays' },
  Weekly: { type: 'weekly', interval: 1 },
  Monthly: { type: 'monthly', interval: 1 },
  Yearly: { type: 'yearly', interval: 1 },
  Custom: { type: 'daily', interval: 1 },
};

/** Builds the row a create surface persists; the caller hands it to `addEvent` / `addTodo`. */
export function buildCreate(type: AddType, title: string, o: CreateOptions): CreatePayload {
  const name = title.trim();
  const category = o.category ?? '';
  const reminderMins = o.reminderMins ?? [];

  if (type === 'event') {
    const allDay = o.allDay ?? false;
    const startTime = allDay ? null : o.startTime || null;
    const endTime = allDay ? null : o.endTime || (startTime ? addMinutes(startTime, 60) : null);
    const endDate = o.endDate && o.endDate >= o.startDate ? o.endDate : o.startDate;
    const where = o.location?.trim() ?? '';
    const notes = o.description?.trim() ?? '';
    return {
      kind: 'event',
      event: {
        title: name,
        // CalendarEvent has no `location` column; Where folds into the description.
        description: [where && `Location: ${where}`, notes].filter(Boolean).join('\n\n'),
        colorKey: DEFAULT_COLOR,
        allDay,
        startDate: o.startDate,
        startTime,
        endDate,
        endTime,
        recurrence: o.eventRecurrence ?? RECURRENCE[o.repeat ?? 'Never'],
        reminders: reminderMins,
        category,
      },
    };
  }

  const target = type === 'habit' ? Math.max(1, o.target ?? 1) : 1;
  return {
    kind: 'todo',
    todo: {
      name,
      colorKey: DEFAULT_COLOR,
      kind: target > 1 ? 'measurable' : 'yesno',
      unit: '',
      target,
      schedule: type === 'task' ? { type: 'once' } : (o.schedule ?? { type: 'daily' }),
      // A task's due date is optional; a habit anchors on the day it starts.
      dueDate: type === 'task' ? (o.dueDate ?? null) : (o.dueDate ?? o.startDate),
      time: o.startTime ?? null,
      reminder: reminderMins.length > 0,
      category,
      important: type === 'task' && !!o.important,
    },
  };
}
