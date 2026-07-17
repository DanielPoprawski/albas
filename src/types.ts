export interface Task {
  id: string;
  title: string;
  category: string;
  completed: boolean;
  date: string | null; // YYYY-MM-DD
}

export type ColorKey = 'primary' | 'secondary' | 'tertiary';

export type HabitKind = 'yesno' | 'measurable';

export type Schedule =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] } // JS getDay() values: 0=Sun … 6=Sat
  | { type: 'interval'; every: number }  // fixed cadence counted from createdAt
  | { type: 'chore'; every: number };    // due N days after the last completion

export interface Habit {
  id: string;
  name: string;
  colorKey: ColorKey;
  kind: HabitKind;
  /** Unit label for measurable habits (e.g. "pushups", "L"). Empty for yes/no. */
  unit: string;
  /** Daily target. Always 1 for yes/no habits. */
  target: number;
  schedule: Schedule;
  createdAt: string; // YYYY-MM-DD — anchor date for interval schedules
  reminder: boolean;
  /** Progress per day. Yes/no habits store 1 when done. */
  completions: Record<string, number>;
}

export type Recurrence =
  | { type: 'none' }
  | { type: 'daily'; interval: number; until?: string | null }   // every N days
  | { type: 'weekly'; interval: number; until?: string | null }  // every N weeks, on startDate's weekday
  | { type: 'monthly'; interval: number; until?: string | null }; // every N months, on startDate's day-of-month

/** Named CalendarEvent to avoid colliding with the DOM `Event` type. */
export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  colorKey: ColorKey;
  allDay: boolean;
  startDate: string; // YYYY-MM-DD (local wall-clock, no timezone)
  /** 'HH:MM' when not allDay, else null. */
  startTime: string | null;
  /** INCLUSIVE last day; >= startDate. */
  endDate: string;
  endTime: string | null;
  recurrence: Recurrence;
  /** Reminder lead times in minutes before start (e.g. 10, 60, 1440 = 1d, 10080 = 1w). */
  reminders: number[];
}

/** A long-running span (12-week gym routine, diet, …) shown as a bar across the calendar. */
export interface Period {
  id: string;
  name: string;
  colorKey: ColorKey;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // inclusive
  notes: string;
  /** Habits tracked as part of this period. */
  habitIds: string[];
}

export type ActiveView = 'calendar' | 'tasks' | 'habits' | 'settings';
export type AddType = 'task' | 'habit' | 'event' | 'period';
export type CalendarMode = 'month' | 'week' | 'day';
