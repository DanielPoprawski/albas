/**
 * The twelve colours anything can wear: four neutrals and eight hues. A key,
 * never a hex — each maps to a `--t-c-<key>` token family in App.css that is
 * restated for the dark theme (`ink` and `paper` swap sides there).
 */
export type ColorKey =
  | 'ink'
  | 'paper'
  | 'grey'
  | 'grey-dark'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink';

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

/**
 * How a seed repeats. `every` is a fixed cadence from the seed's `date`
 * (`days` picks weekdays when the unit is a week; `monthDays` or `nth` pick
 * the days when it is a month); `fromDone` re-anchors it on the last
 * completion (a chore); `timesPer` is a quota per week or month. `until` ends
 * the series, `exdates` are occurrences deleted individually.
 */
export type Repeat =
  | { type: 'none' }
  | {
      type: 'every';
      n: number;
      unit: RepeatUnit;
      days?: number[]; // JS getDay() values: 0=Sun … 6=Sat
      /** Monthly only: days of the month (1–31; -1 = last day), -1 last. Absent = the anchor's day. */
      monthDays?: number[];
      /** Monthly only: the anchor's weekday, nth (1–4) in the month, or -1 for the last. Beats `monthDays`. */
      nth?: number;
      fromDone?: boolean;
      until?: string | null;
      exdates?: string[];
    }
  | { type: 'timesPer'; times: number; per: 'week' | 'month'; until?: string | null };

/** What ticking a seed off means: nothing (an event), a check, or a count towards `target`. */
export type Track = null | { kind: 'check' } | { kind: 'count'; unit: string; target: number };

/** A habit's time-of-day tag; '' = untagged (the Routine layout infers one from `time`). */
export type Routine = '' | 'morning' | 'afternoon' | 'evening';
export const ROUTINES: Routine[] = ['', 'morning', 'afternoon', 'evening'];

/**
 * One thing on the timeline. Every view is a filter over these: the calendar
 * shows dated seeds, To-dos shows doable non-repeating ones, Habits shows
 * doable repeating ones. See `seedLogic.ts` for the rules.
 */
export interface Seed {
  id: string;
  title: string;
  /** Free text; a `Location: …` first paragraph is the Where field. */
  notes: string;
  /** Own colour; null = the last tag's colour, else grey. */
  color: ColorKey | null;
  /** List id, '' = unfiled. */
  list: string;
  /** Tag ids in the user's order; the last one drives colour and icon. */
  tags: string[];
  important: boolean;
  /** Manual order in the Habits list. */
  sort: number;
  routine: Routine;
  createdAt: string; // YYYY-MM-DD
  /** Day of the (first) occurrence; null = anytime, legal only when not repeating. */
  date: string | null;
  /** 'HH:MM'; null = all-day. */
  time: string | null;
  /** Inclusive last day; null = same day as `date`. */
  endDate: string | null;
  /** 'HH:MM'; null = no duration. */
  endTime: string | null;
  repeat: Repeat;
  track: Track;
  /** Lead times in minutes before the start (0 = at the start, 1440 = a day). */
  reminders: number[];
  /** Progress per occurrence day. Check seeds store 1 when done. */
  done: Record<string, number>;
  /**
   * Present only on seeds another account shared (their account name).
   * Shared seeds are read-only: every edit path checks this before opening a
   * form, and they are never persisted locally.
   */
  sharedBy?: string;
}

/** An exclusive folder: a seed is in one list or none. */
export interface List {
  id: string;
  name: string;
  sort: number;
}

/** A non-exclusive label with a colour and a Material Symbols icon name. */
export interface Tag {
  id: string;
  name: string;
  color: ColorKey;
  icon: string;
  sort: number;
  /** Comma-separated; any of them found as a whole word in a seed's title adds this tag. */
  keywords: string;
}

/**
 * Two themes, both drawn: `:root` in App.css is light, `[data-theme='dark']`
 * is dark. `grey-high`/`grey-low` were dropped — the redesign never drew them,
 * so they were four names for two palettes. A database still holding one fails
 * `appearance.ts`'s THEMES check and falls back to the default, which is light.
 */
export type ThemeName = 'light' | 'dark';
/**
 * What the user chose in Settings: one of the two themes, or `system` — follow
 * the OS via `prefers-color-scheme`. Only the resolved `ThemeName` ever lands
 * in `data-theme`.
 */
export type ThemePref = ThemeName | 'system';
/** Which weekday grids start on, as a JS `getDay()` value: 0 = Sunday, 1 = Monday. */
export type FirstDayOfWeek = 0 | 1;
/** How the Habits list is grouped: not at all, by schedule cadence, or by routine tag/time of day. */
export type HabitsLayout = 'flat' | 'cadence' | 'routine';
export const HABITS_LAYOUTS: HabitsLayout[] = ['flat', 'cadence', 'routine'];

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
  seeds: Seed[];
  /** The owner's lists and tags, ids namespaced `${owner}:${pk}` like everything else shared. */
  lists: List[];
  tags: Tag[];
}

/** One sharing grant as the server reports it: the row's existence is the grant. */
export interface ShareGrant {
  name: string;
}

/**
 * A selection key. Held in a `Set` across queries, tabs and views and
 * resolved against the *live* seeds when acting, so a bulk edit never works
 * from a stale snapshot. Shared seeds' ids are `${owner}:${pk}`.
 */
export type ItemKey = `seed:${string}`;

/** What a create surface hands `DataContext`: the row minus what the store assigns. */
export type NewSeed = Omit<Seed, 'id' | 'createdAt' | 'done'>;
export type NewList = Omit<List, 'id'>;
export type NewTag = Omit<Tag, 'id'>;

export type ActiveView = 'calendar' | 'todos' | 'habits' | 'settings';
export type CalendarMode = 'month' | 'week' | 'day';
