import { DEFAULT_COLOR } from './colors';
import { addMinutes } from './dates';
import type { AddType, NewEvent, NewTodo, Recurrence, Repeat, Routine } from './types';

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
  /** Events: the description the `Location:` paragraph is folded into. To-dos: `notes`. */
  description?: string;
  /** Events: the recurrence rule (defaults to none). */
  eventRecurrence?: Recurrence;
  /** Habits: the repeat rule (defaults to daily). Ignored for tasks. */
  schedule?: Repeat;
  /** To-dos: starred. */
  important?: boolean;
  category?: string;
  target?: number;
  /** Habits: unit label when `target > 1`. */
  unit?: string;
  /** Events: reminder lead times, in minutes before the start. */
  reminderMins?: number[];
  /** To-dos: notify on due days. */
  reminder?: boolean;
  /** Habits: their own colour (tasks and events paint from their category). */
  colorKey?: string;
  /** Habits: routine tag. */
  routine?: Routine;
}

export type CreatePayload = { kind: 'event'; event: NewEvent } | { kind: 'todo'; todo: NewTodo };

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
        recurrence: o.eventRecurrence ?? { type: 'none' },
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
      colorKey: o.colorKey ?? DEFAULT_COLOR,
      kind: target > 1 ? 'measurable' : 'yesno',
      unit: target > 1 ? (o.unit?.trim() ?? '') : '',
      target,
      schedule: type === 'task' ? { type: 'once' } : (o.schedule ?? { type: 'daily' }),
      // A task's due date is optional; a habit anchors on the day it starts
      // unless the caller says `null`, meaning "no anchor at all".
      dueDate: type === 'task' ? (o.dueDate ?? null) : o.dueDate === undefined ? o.startDate : o.dueDate,
      time: o.startTime ?? null,
      reminder: o.reminder ?? false,
      category,
      important: !!o.important,
      notes: o.description?.trim() ?? '',
      // `addTodo` places a new habit last; every other order is the user's.
      sort: 0,
      routine: type === 'habit' ? (o.routine ?? '') : '',
    },
  };
}

/** Where + notes back out of the `Location: …` first paragraph `buildCreate` writes. */
export function splitLocation(description: string): { location: string; notes: string } {
  const m = /^Location: ([^\n]*)(?:\n\n([\s\S]*))?$/.exec(description);
  return m ? { location: m[1], notes: m[2] ?? '' } : { location: '', notes: description };
}

/**
 * An event's recurrence as the modal holds it: the picked preset plus every
 * branch's inputs side by side (the interval as raw text so a half-typed
 * number doesn't snap back), folded into a `Recurrence` on commit.
 */
export interface RecurrenceDraft {
  repeat: EventRepeat;
  interval: string;
  unit: 'daily' | 'weekly' | 'monthly' | 'yearly';
  weekdays: number[];
  until: string;
}

const REC_DEFAULTS: Omit<RecurrenceDraft, 'repeat'> = { interval: '1', unit: 'daily', weekdays: [], until: '' };

/** Preset ↔ rule type, both ways; `Custom` carries its own unit. */
const PRESET_TYPE: Record<Exclude<EventRepeat, 'Custom'>, Recurrence['type']> = {
  Never: 'none',
  Daily: 'daily',
  Weekdays: 'weekdays',
  Weekly: 'weekly',
  Monthly: 'monthly',
  Yearly: 'yearly',
};
const REC_PRESET: Record<'daily' | 'weekly' | 'monthly' | 'yearly', EventRepeat> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/** A draft that mirrors a stored rule; an interval above 1 only fits under "Custom…". */
export function draftFromRecurrence(rec: Recurrence): RecurrenceDraft {
  if (rec.type === 'none') return { ...REC_DEFAULTS, repeat: 'Never' };
  if (rec.type === 'weekdays') return { ...REC_DEFAULTS, repeat: 'Weekdays', until: rec.until ?? '' };
  const interval = rec.interval ?? 1;
  const custom = interval > 1;
  return {
    ...REC_DEFAULTS,
    repeat: custom ? 'Custom' : REC_PRESET[rec.type],
    interval: String(interval),
    unit: custom ? rec.type : REC_DEFAULTS.unit,
    weekdays: rec.type === 'weekly' ? (rec.days ?? []) : [],
    until: rec.until ?? '',
  };
}

/** `exdates` (individually deleted occurrences) survive an edit to the rest of the series. */
export function buildRecurrence(d: RecurrenceDraft, exdates?: string[]): Recurrence {
  const n = parseInt(d.interval, 10);
  const custom = d.repeat === 'Custom';
  const type = d.repeat === 'Custom' ? d.unit : PRESET_TYPE[d.repeat];
  const interval = custom && Number.isFinite(n) && n > 0 ? n : 1;
  const until = d.until || null;
  const keep = exdates?.length && type !== 'none' ? { exdates } : {};
  if (type === 'none') return { type: 'none' };
  if (type === 'weekdays') return { type: 'weekdays', until, ...keep };
  if (type === 'weekly')
    return { type: 'weekly', interval, until, ...(d.weekdays.length ? { days: d.weekdays } : {}), ...keep };
  return { type, interval, until, ...keep };
}
