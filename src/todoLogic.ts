import { addDays, addMonths, diffDays, fmt, monthsBetween, parse, rotateWeek, shortDate, weekOf, hhmm } from './dates';
import { shortTime } from './eventLogic';
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
  return Object.values(todo.completions).some((v) => v >= todo.target);
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
export function doneCountIn(todo: Todo, dateStr: string, per: 'week' | 'month', firstDay: FirstDayOfWeek = 0): number {
  if (per === 'week') {
    return weekOf(parse(dateStr), firstDay).filter((d) => isDoneOn(todo, d)).length;
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
      return monthsBetween(start, dateStr) % n === 0 && parse(dateStr).getDate() === parse(start).getDate();
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
 * The day a search hit for a to-do should land on: a once to-do's due day
 * (null when undated); for a chore, its next due day; for a habit, the next
 * day it's due from today, else the most recent past due day, else its
 * anchor. Bounded scans — a habit due on some day of the week resolves in
 * under seven steps, a monthly one in at most 31.
 */
export function nearestDueDate(todo: Todo, todayStr: string, firstDay: FirstDayOfWeek = 0): string | null {
  const s = todo.schedule;
  if (s.type === 'once') return todo.dueDate;
  const chore = nextDue(todo, todayStr);
  if (chore) return chore;
  const anchor = anchorOf(todo);
  for (let i = 0; i <= 366; i++) {
    const day = addDays(todayStr, i);
    if (day >= anchor && isDueOn(todo, day, firstDay)) return day;
  }
  for (let i = 1; i <= 366; i++) {
    const day = addDays(todayStr, -i);
    if (day < anchor) break;
    if (isDueOn(todo, day, firstDay)) return day;
  }
  return anchor;
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
    const met = (anchor: string) => doneCountIn(todo, anchor, s.per, firstDay) >= Math.max(1, s.times);
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

/** Every day in `[from, to]` (inclusive) on which the to-do is due, ascending. */
export function dueDaysBetween(todo: Todo, from: string, to: string, firstDay: FirstDayOfWeek = 0): string[] {
  const days: string[] = [];
  if (from > to) return days;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (isDueOn(todo, day, firstDay)) days.push(day);
  }
  return days;
}

/**
 * Longest run of consecutive due days each completed, from the to-do's
 * creation (or its earliest completion, whichever is earlier) to today.
 * Same day-rule conventions as `streakOf`: non-due days are skipped and an
 * unfinished today does not end a run. Quota rules count consecutive met
 * periods, with the same grace for the current one.
 */
export function bestStreakOf(todo: Todo, firstDay: FirstDayOfWeek = 0): number {
  const s = todo.schedule;
  if (s.type === 'once') return 0;

  const todayStr = fmt(new Date());
  const completed = Object.entries(todo.completions)
    .filter(([, v]) => v >= todo.target)
    .map(([d]) => d);
  const earliest = completed.reduce((a, b) => (b < a ? b : a), todo.createdAt);
  const start = earliest < todayStr ? earliest : todayStr;

  let best = 0;
  let run = 0;

  if (s.type === 'timesPer') {
    const met = (anchor: string) => doneCountIn(todo, anchor, s.per, firstDay) >= Math.max(1, s.times);
    let anchor = s.per === 'week' ? weekOf(parse(start), firstDay)[0] : start.slice(0, 8) + '01';
    for (let i = 0; i < 1200 && anchor <= todayStr; i++) {
      const next = s.per === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1);
      if (met(anchor)) run++;
      else if (next <= todayStr) run = 0; // grace: the in-progress period doesn't break it
      best = Math.max(best, run);
      anchor = next;
    }
    return best;
  }

  for (const day of dueDaysBetween(todo, start, todayStr, firstDay)) {
    if (isDoneOn(todo, day)) run++;
    else if (day !== todayStr) run = 0;
    best = Math.max(best, run);
  }
  return best;
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
    case 'once':
      return 'one-time';
    case 'daily':
      return 'daily';
    case 'weekdays':
      return repeat.days.length === 7
        ? 'daily'
        : rotateWeek([0, 1, 2, 3, 4, 5, 6], firstDay)
            .filter((d) => repeat.days.includes(d))
            .map((d) => DAY_NAMES[d])
            .join(' ');
    case 'every': {
      const [adverb, plural] = UNIT_WORD[repeat.unit];
      const base = repeat.n === 1 ? adverb : `every ${repeat.n} ${plural}`;
      return repeat.fromDone ? `${base === adverb ? `every ${repeat.unit}` : base} after last done` : base;
    }
    case 'timesPer':
      return `${repeat.times}× per ${repeat.per}`;
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

/**
 * Display label for items with no category (`category === ''`). "General"
 * rather than "Uncategorized": it is the neutral inbox, not an error state.
 */
export const GENERAL = 'General';

/**
 * Sort key for a to-do's due moment. Undated to-dos sort last (there is no
 * deadline to be late for), and a dated one with no time sorts after the timed
 * ones on the same day.
 */
export function dueSortKey(todo: Todo): string {
  if (!todo.dueDate) return '￿';
  return `${todo.dueDate}T${todo.time ?? '99:99'}`;
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

/**
 * The day a checkbox click on a one-time to-do logs to. Done → the day it was
 * logged on, so the click actually clears it; not done → today, whatever the
 * due day was. Logging on the due day would backdate an overdue tick and
 * drop the row from the dashboard under the pointer (`dashboardTasks` keeps
 * only today's completions in view). Every task surface uses this one rule.
 */
export function completionDay(todo: Todo, todayStr: string): string {
  return doneDate(todo) ?? todayStr;
}

export interface DueLabel {
  text: string;
  /** `isOverdue` — the one state that gets colour. */
  late: boolean;
}

/**
 * When a to-do is due, in the smallest form that still reads: "Today",
 * "Tomorrow" or a short date; a bare time when it's today; date and time for a
 * dated to-do with a time; null when there is nothing to say.
 */
export function dueLabel(todo: Todo, todayStr: string): DueLabel | null {
  if (!todo.dueDate && !todo.time) return null;
  const time = todo.time ? shortTime(todo.time) : '';
  let day = '';
  if (todo.dueDate) {
    if (todo.dueDate === todayStr) day = time ? '' : 'Today';
    else if (todo.dueDate === addDays(todayStr, 1)) day = 'Tomorrow';
    else day = shortDate(todo.dueDate);
  }
  return { text: [day, time].filter(Boolean).join(' '), late: isOverdue(todo) };
}

/** Starred first, then by due moment, then by name so the order is stable. */
export function byImportanceThenDue(a: Todo, b: Todo): number {
  if (a.important !== b.important) return a.important ? -1 : 1;
  const key = dueSortKey(a).localeCompare(dueSortKey(b));
  return key !== 0 ? key : a.name.localeCompare(b.name);
}

/**
 * What the dashboard's task panel shows: every one-time to-do that needs
 * attention today — undated (nothing to wait for), due today or overdue, or
 * starred — plus anything finished *today* so a tick doesn't vanish under the
 * pointer. A to-do completed on an earlier day is history and drops off.
 */
export function dashboardTasks(tasks: Todo[], todayStr: string): Todo[] {
  return tasks.filter((t) => {
    if (isRepeating(t)) return false;
    const done = doneDate(t);
    if (done) return done === todayStr;
    return !t.dueDate || t.dueDate <= todayStr || t.important;
  });
}

/**
 * Dashboard order: starred first, then by due day (undated last), then the
 * order they were added — `sort` is stable, so equal keys keep array order.
 */
export function byDashboardOrder(a: Todo, b: Todo): number {
  if (a.important !== b.important) return a.important ? -1 : 1;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export interface TaskGroup {
  /** Category id, or '' for uncategorised. Resolve the name via `DataContext`'s `categoryById`. */
  category: string;
  todos: Todo[];
}

/**
 * One-time to-dos grouped by category id for display: uncategorised first
 * (it's where anything typed in a hurry lands, so it shouldn't be buried),
 * then the named categories in `order`'s sequence (typically the user's
 * Settings ordering — `AppContext#categoriesFor`'s `sort`). A category with
 * no todo left is naturally absent, and one that isn't in `order` (e.g. a
 * category deleted since a todo was assigned, before its reference clears)
 * sorts after every ordered one. Each group is sorted by
 * `byImportanceThenDue`. Completed to-dos are excluded — they collect in
 * their own section at the bottom of the list rather than inside their
 * category.
 */
export function groupTasks(tasks: Todo[], order: string[] = []): TaskGroup[] {
  const groups = new Map<string, Todo[]>();
  for (const t of tasks) {
    const key = t.category.trim();
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === '') return -1;
      if (b === '') return 1;
      const ra = rank.get(a) ?? Infinity;
      const rb = rank.get(b) ?? Infinity;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    })
    .map(([category, todos]) => ({ category, todos: todos.sort(byImportanceThenDue) }));
}
