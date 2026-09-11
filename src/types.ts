export type RepeatUnit = 'day' | 'week' | 'month';

/**
 * How a to-do repeats. This is the only thing separating a task, a habit,
 * and a chore — they're all "things that need to be done":
 * - 'once'      → task: done a single time
 * - fixed rules → habit: due on a cadence regardless of past completions
 * - 'every' + fromDone → chore: next due N units after the last completion
 */
export type Repeat =
  | { type: 'once' }
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] } // JS getDay() values: 0=Sun … 6=Sat
  | { type: 'every'; n: number; unit: RepeatUnit; fromDone: boolean }
  | { type: 'timesPer'; times: number; per: 'week' | 'month' };

export type TodoKind = 'yesno' | 'measurable';

/** Which surfaces a category can be assigned on. */
export type CategoryScope = 'calendar' | 'tasks' | 'habits';

/**
 * A user-managed, synced grouping — replaces the old free-text
 * `Todo.category`. `colorKey` is a hex string, same convention as
 * `Todo.colorKey` / `CalendarEvent.colorKey` (resolve via `colorHex()`).
 * `scopes` says which Add-modal types / list views offer it; `sort` is the
 * user's manual ordering (Settings' up/down), ascending.
 */
export interface Category {
  id: string;
  name: string;
  colorKey: string;
  scopes: CategoryScope[];
  sort: number;
}

/** Unified to-do: tasks, habits, and chores are all this one shape. */
export interface Todo {
  id: string;
  name: string;
  /** Hex color. Legacy saves may hold 'primary'|'secondary'|'tertiary' — resolve via colorHex(). */
  colorKey: string;
  kind: TodoKind;
  /** Unit label for measurable to-dos (e.g. "pushups", "L"). Empty for yes/no. */
  unit: string;
  /** Per-day target. Always 1 for yes/no. */
  target: number;
  schedule: Repeat;
  /** Once: the due day (null = anytime). Repeating: start/anchor day (falls back to createdAt). */
  dueDate: string | null;
  /** Optional time of day, 'HH:MM'. */
  time: string | null;
  createdAt: string; // YYYY-MM-DD
  /** Notify on days it's due and not yet done. */
  reminder: boolean;
  /**
   * Category id, empty for uncategorised. Was free text; a synced
   * `categories` table now owns the name/colour (`AppContext#categoryById`).
   */
  category: string;
  /** Starred. Sorts above everything else in its category. */
  important: boolean;
  /** Progress per day. Yes/no to-dos store 1 when done. */
  completions: Record<string, number>;
}

/** `exdates` lists occurrence start dates deleted individually ("just this event"). */
export type Recurrence =
  | { type: 'none' }
  | { type: 'daily'; interval: number; until?: string | null; exdates?: string[] } // every N days
  | { type: 'weekly'; interval: number; until?: string | null; exdates?: string[] } // every N weeks, on startDate's weekday
  | { type: 'monthly'; interval: number; until?: string | null; exdates?: string[] }; // every N months, on startDate's day-of-month

/**
 * Anything that's "just there" on the calendar — meetings, trips, and long
 * spans like a 12-week program (formerly Periods) are all events now.
 * Named CalendarEvent to avoid colliding with the DOM `Event` type.
 */
export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  /** Hex color; legacy saves may hold a named key — resolve via colorHex(). */
  colorKey: string;
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
  /** Category id, empty for uncategorised. */
  category: string;
  /**
   * Present only on events belonging to another account that shared them
   * (their account name). Shared events are read-only: every edit path checks
   * this before opening a form, and they are never persisted locally.
   */
  sharedBy?: string;
}

/**
 * Two themes, both drawn: `:root` in App.css is light, `[data-theme='dark']`
 * is dark. `grey-high`/`grey-low` were dropped — the redesign never drew them,
 * so they were four names for two palettes. A database still holding one fails
 * `AppContext`'s THEMES check and falls back to the default, which is light.
 */
export type ThemeName = 'light' | 'dark';
/** Which weekday grids start on, as a JS `getDay()` value: 0 = Sunday, 1 = Monday. */
export type FirstDayOfWeek = 0 | 1;

/** One raw row another account shared with us, as loaded from `shared_rows`. */
export interface RawSharedRow {
  owner: string;
  tbl: string;
  pk: string;
  /** Column-name → value object; snake_case keys matching the sync TABLES. */
  payload: Record<string, unknown> | null;
}

/** Everything one account shares with us, mapped to app types (read-only). */
export interface SharedGroup {
  owner: string;
  events: CalendarEvent[];
  todos: Todo[];
  /** The owner's categories, ids namespaced `${owner}:${pk}` like everything else shared. */
  categories: Category[];
}

/** One sharing grant as the server reports it. */
export interface ShareGrant {
  name: string;
  calendar: boolean;
  todos: boolean;
}

export type ActiveView = 'calendar' | 'todos' | 'settings';
export type AddType = 'event' | 'task' | 'habit';
export type CalendarMode = 'month' | 'week' | 'day';
