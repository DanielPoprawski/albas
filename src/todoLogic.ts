import { addDays, addMonths, diffDays, fmt, monthsBetween, parse, rotateWeek, shortDate, weekOf } from './dates';
import type { FirstDayOfWeek, Repeat, Todo } from './types';

export function isRepeating(todo: Todo): boolean {
  return todo.schedule.type !== 'once';
}

/** Start/anchor day for repeating rules. */
export function anchorOf(todo: Todo): string {
  return todo.dueDate ?? todo.createdAt;
}

export function valueOn(todo: Todo, dateStr: string): number {
  return todo.completions[dateStr] ?? 0;
}

export function isDoneOn(todo: Todo, dateStr: string): boolean {
  return valueOn(todo, dateStr) >= todo.target;
}

/** Once to-dos: completed at all (on any day). */
export function isDone(todo: Todo): boolean {
  return Object.values(todo.completions).some(v => v >= todo.target);
}

/** Day a once to-do was (last) completed on, or null. */
export function doneDate(todo: Todo): string | null {
  let best: string | null = null;
  for (const [d, v] of Object.entries(todo.completions)) {
    if (v >= todo.target && (!best || d > best)) best = d;
  }
  return best;
}

/** Most recent day strictly before `dateStr` on which the to-do was completed. */
function lastDoneBefore(todo: Todo, dateStr: string): string | null {
  let best: string | null = null;
  for (const [d, v] of Object.entries(todo.completions)) {
    if (v >= todo.target && d < dateStr && (!best || d > best)) best = d;
  }
  return best;
}

function shiftBy(dateStr: string, n: number, unit: 'day' | 'week' | 'month'): string {
  if (unit === 'day') return addDays(dateStr, n);
  if (unit === 'week') return addDays(dateStr, 7 * n);
  return addMonths(dateStr, n);
}

/**
 * Completions meeting target inside the week/month containing `dateStr`.
 *
 * Note the week bucket follows the first-day-of-week setting, so flipping that
 * setting re-partitions past completions and can change a "3× per week" to-do's
 * quota state. That's inherent to the feature rather than a bug.
 */
export function doneCountIn(
  todo: Todo,
  dateStr: string,
  per: 'week' | 'month',
  firstDay: FirstDayOfWeek = 0,
): number {
  if (per === 'week') {
    return weekOf(parse(dateStr), firstDay).filter(d => isDoneOn(todo, d)).length;
  }
  const prefix = dateStr.slice(0, 7);
  return Object.entries(todo.completions).filter(([d, v]) => d.startsWith(prefix) && v >= todo.target).length;
}

export function isDueOn(todo: Todo, dateStr: string, firstDay: FirstDayOfWeek = 0): boolean {
  const s = todo.schedule;
  if (s.type === 'once') return !!todo.dueDate && dateStr === todo.dueDate;

  const start = anchorOf(todo);
  if (dateStr < start) return false;

  switch (s.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return s.days.includes(parse(dateStr).getDay());
    case 'every': {
      const n = Math.max(1, s.n);
      if (s.fromDone) {
        // Chore: anchored to the last completion — missing a day pushes the
        // next due date back instead of piling up early reminders.
        if (isDoneOn(todo, dateStr)) return true;
        const last = lastDoneBefore(todo, dateStr);
        if (!last) return true; // never done yet — due since the anchor
        return dateStr >= shiftBy(last, n, s.unit);
      }
      // Fixed cadence counted from the anchor, done or not.
      if (s.unit === 'day') return diffDays(start, dateStr) % n === 0;
      if (s.unit === 'week') return diffDays(start, dateStr) % (7 * n) === 0;
      // month: same day-of-month; months lacking that day are skipped
      return monthsBetween(start, dateStr) % n === 0 &&
        parse(dateStr).getDate() === parse(start).getDate();
    }
    case 'timesPer': {
      // Flexible quota: due any day until the week/month quota is met.
      if (isDoneOn(todo, dateStr)) return true;
      return doneCountIn(todo, dateStr, s.per, firstDay) < Math.max(1, s.times);
    }
  }
}

/** Next day (today or later) a chore comes due; null for non-chore rules. */
export function nextDue(todo: Todo, todayStr: string): string | null {
  const s = todo.schedule;
  if (s.type !== 'every' || !s.fromDone) return null;
  const last = doneDate(todo);
  if (!last) return anchorOf(todo) > todayStr ? anchorOf(todo) : todayStr;
  const next = shiftBy(last, Math.max(1, s.n), s.unit);
  return next > todayStr ? next : todayStr;
}

/**
 * Streak, counting back from today.
 * Day rules: consecutive due days completed (an unfinished today doesn't
 * break it; non-due days are skipped). Quota rules: consecutive weeks/months
 * meeting the quota, with the same grace for the current one.
 */
export function streakOf(todo: Todo, firstDay: FirstDayOfWeek = 0): number {
  const s = todo.schedule;
  if (s.type === 'once') return 0;

  const todayStr = fmt(new Date());

  if (s.type === 'timesPer') {
    const met = (anchor: string) =>
      doneCountIn(todo, anchor, s.per, firstDay) >= Math.max(1, s.times);
    let anchor = todayStr;
    let streak = 0;
    for (let i = 0; i < 60; i++) {
      if (met(anchor)) streak++;
      else if (anchor !== todayStr) break; // grace: the in-progress period doesn't break it
      anchor = s.per === 'week' ? addDays(anchor, -7) : addMonths(anchor.slice(0, 8) + '01', -1);
      if (anchor < todo.createdAt.slice(0, 8) + '01') break;
    }
    return streak;
  }

  const d = new Date();
  if (isDueOn(todo, todayStr, firstDay) && !isDoneOn(todo, todayStr)) {
    d.setDate(d.getDate() - 1);
  }
  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const day = fmt(d);
    if (day < anchorOf(todo)) break;
    if (isDueOn(todo, day, firstDay)) {
      if (!isDoneOn(todo, day)) break;
      streak++;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UNIT_WORD: Record<'day' | 'week' | 'month', [string, string]> = {
  day: ['daily', 'days'],
  week: ['weekly', 'weeks'],
  month: ['monthly', 'months'],
};

/** Human-readable repeat summary, e.g. "every 3 days after last done". */
export function repeatLabel(repeat: Repeat, firstDay: FirstDayOfWeek = 0): string {
  switch (repeat.type) {
    case 'once': return 'one-time';
    case 'daily': return 'daily';
    case 'weekdays': return repeat.days.length === 7 ? 'daily'
      : rotateWeek([0, 1, 2, 3, 4, 5, 6], firstDay)
        .filter(d => repeat.days.includes(d)).map(d => DAY_NAMES[d]).join(' ');
    case 'every': {
      const [adverb, plural] = UNIT_WORD[repeat.unit];
      const base = repeat.n === 1 ? adverb : `every ${repeat.n} ${plural}`;
      return repeat.fromDone ? `${base === adverb ? `every ${repeat.unit}` : base} after last done` : base;
    }
    case 'timesPer': return `${repeat.times}× per ${repeat.per}`;
  }
}

/** Short status shown next to a repeating to-do's name in lists. */
export function statusLabel(todo: Todo, todayStr: string, firstDay: FirstDayOfWeek = 0): string {
  const s = todo.schedule;
  if (s.type === 'timesPer') {
    const done = doneCountIn(todo, todayStr, s.per, firstDay);
    return `${done}/${s.times} this ${s.per}`;
  }
  if (s.type === 'every' && s.fromDone) {
    const next = nextDue(todo, todayStr);
    return next === todayStr ? 'due today' : `next ${shortDate(next!)}`;
  }
  const streak = streakOf(todo, firstDay);
  return streak > 0 ? `${streak} day streak` : repeatLabel(s, firstDay);
}

/** Uncategorised to-dos group under this heading, and it always sorts first. */
export const UNCATEGORIZED = 'Uncategorized';

/**
 * Sort key for a to-do's due moment. Undated to-dos sort last (there is no
 * deadline to be late for), and a dated one with no time sorts after the timed
 * ones on the same day.
 */
export function dueSortKey(todo: Todo): string {
  if (!todo.dueDate) return '￿';
  return `${todo.dueDate}T${todo.time ?? '99:99'}`;
}

/** Current wall-clock as 'HH:MM', for comparing against a to-do's `time`. */
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Past its moment and still not done. A to-do due today counts as overdue only
 * once its time has passed; one with no time has all day to be finished.
 */
export function isOverdue(todo: Todo, now: Date = new Date()): boolean {
  if (!todo.dueDate || isDone(todo)) return false;
  const todayStr = fmt(now);
  if (todo.dueDate !== todayStr) return todo.dueDate < todayStr;
  return todo.time != null && todo.time < hhmm(now);
}

/** Starred first, then by due moment, then by name so the order is stable. */
export function byImportanceThenDue(a: Todo, b: Todo): number {
  if (a.important !== b.important) return a.important ? -1 : 1;
  const key = dueSortKey(a).localeCompare(dueSortKey(b));
  return key !== 0 ? key : a.name.localeCompare(b.name);
}

export interface TaskGroup {
  category: string;
  todos: Todo[];
}

/**
 * One-time to-dos grouped by category for display: uncategorised first (it's
 * where anything typed in a hurry lands, so it shouldn't be buried), then the
 * named categories alphabetically. Each group is sorted by
 * `byImportanceThenDue`. Completed to-dos are excluded — they collect in their
 * own section at the bottom of the list rather than inside their category.
 */
export function groupTasks(tasks: Todo[]): TaskGroup[] {
  const groups = new Map<string, Todo[]>();
  for (const t of tasks) {
    const key = t.category.trim() || UNCATEGORIZED;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === UNCATEGORIZED) return -1;
      if (b === UNCATEGORIZED) return 1;
      return a.localeCompare(b);
    })
    .map(([category, todos]) => ({ category, todos: todos.sort(byImportanceThenDue) }));
}
