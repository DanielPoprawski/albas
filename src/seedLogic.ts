// Everything computed from a Seed: what kind of thing it is, when it occurs,
// whether it is done, how it labels and sorts. One engine for events, to-dos
// and habits — the views are filters over it (`isTask`/`isHabit`/dated).

import { DEFAULT_COLOR } from './colors';
import { addDays, addMonths, diffDays, fmt, hhmm, monthsBetween, parse, rotateWeek, shortDate, weekOf } from './dates';
import type { ColorKey, FirstDayOfWeek, NewSeed, Repeat, RepeatUnit, Seed, Tag } from './types';

// --- Kind --------------------------------------------------------------------

export function isDoable(s: Pick<Seed, 'track'>): boolean {
  return s.track !== null;
}

export function isRepeating(s: Pick<Seed, 'repeat'>): boolean {
  return s.repeat.type !== 'none';
}

/** Doable and one-off: the To-dos list. */
export function isTask(s: Pick<Seed, 'track' | 'repeat'>): boolean {
  return isDoable(s) && !isRepeating(s);
}

/** Doable and repeating: the Habits list. */
export function isHabit(s: Pick<Seed, 'track' | 'repeat'>): boolean {
  return isDoable(s) && isRepeating(s);
}

export type KindLabel = 'event' | 'to-do' | 'habit';

/** The word a seed goes by in copy and the search tabs. */
export function kindLabel(s: Pick<Seed, 'track' | 'repeat'>): KindLabel {
  if (!isDoable(s)) return 'event';
  return isRepeating(s) ? 'habit' : 'to-do';
}

/** Per-day target; 1 for check seeds and events. */
export function targetOf(s: Pick<Seed, 'track'>): number {
  return s.track?.kind === 'count' ? Math.max(1, s.track.target) : 1;
}

export function unitOf(s: Pick<Seed, 'track'>): string {
  return s.track?.kind === 'count' ? s.track.unit : '';
}

/** The cross-field rules, in one place. The first violation as a message, or null. */
export function validateSeed(s: NewSeed): string | null {
  if (!s.title.trim()) return 'Give it a title';
  if (!s.date && (isRepeating(s) || !isDoable(s))) return 'Pick a date';
  if (s.endTime && !s.time) return 'An end time needs a start time';
  if (s.date && s.endDate && s.endDate < s.date) return 'The end is before the start';
  if (!s.endDate && s.time && s.endTime && s.endTime <= s.time) return 'The end is before the start';
  if (!isDoable(s) && (s.repeat.type === 'timesPer' || (s.repeat.type === 'every' && s.repeat.fromDone)))
    return 'Only something you can tick off can repeat that way';
  return null;
}

// --- Colour ------------------------------------------------------------------

/** Own colour, else the last tag's, else grey. */
export function resolveColor(s: Pick<Seed, 'color' | 'tags'>, tagById: (id: string) => Tag | undefined): ColorKey {
  if (s.color) return s.color;
  const last = s.tags[s.tags.length - 1];
  return (last && tagById(last)?.color) || DEFAULT_COLOR;
}

/** The last tag's icon, or null. */
export function resolveIcon(s: Pick<Seed, 'tags'>, tagById: (id: string) => Tag | undefined): string | null {
  const last = s.tags[s.tags.length - 1];
  return (last && tagById(last)?.icon) || null;
}

// --- Done --------------------------------------------------------------------

/** Start/anchor day for repeating rules. */
export function anchorOf(s: Pick<Seed, 'date' | 'createdAt'>): string {
  return s.date ?? s.createdAt;
}

export function valueOn(s: Pick<Seed, 'done'>, date: string): number {
  return s.done[date] ?? 0;
}

export function isDoneOn(s: Pick<Seed, 'done' | 'track'>, date: string): boolean {
  return isDoable(s) && valueOn(s, date) >= targetOf(s);
}

/** One-off seeds: completed at all (on any day). */
export function isDone(s: Pick<Seed, 'done' | 'track'>): boolean {
  if (!isDoable(s)) return false;
  const target = targetOf(s);
  return Object.values(s.done).some((v) => v >= target);
}

/** Day a one-off seed was (last) completed on, or null. */
export function doneDate(s: Pick<Seed, 'done' | 'track'>): string | null {
  const target = targetOf(s);
  let best: string | null = null;
  for (const [d, v] of Object.entries(s.done)) {
    if (v >= target && (!best || d > best)) best = d;
  }
  return best;
}

/** Most recent day strictly before `date` on which the seed was completed. */
function lastDoneBefore(s: Pick<Seed, 'done' | 'track'>, date: string): string | null {
  const target = targetOf(s);
  let best: string | null = null;
  for (const [d, v] of Object.entries(s.done)) {
    if (v >= target && d < date && (!best || d > best)) best = d;
  }
  return best;
}

function shiftBy(date: string, n: number, unit: RepeatUnit): string {
  if (unit === 'day') return addDays(date, n);
  if (unit === 'week') return addDays(date, 7 * n);
  return addMonths(date, unit === 'year' ? 12 * n : n);
}

/**
 * Completions meeting target inside the week/month containing `date`.
 *
 * Note the week bucket follows the first-day-of-week setting, so flipping that
 * setting re-partitions past completions and can change a "3× per week" seed's
 * quota state. That's inherent to the feature rather than a bug.
 */
export function doneCountIn(s: Seed, date: string, per: 'week' | 'month', firstDay: FirstDayOfWeek = 0): number {
  if (per === 'week') {
    return weekOf(parse(date), firstDay).filter((d) => isDoneOn(s, d)).length;
  }
  const prefix = date.slice(0, 7);
  const target = targetOf(s);
  return Object.entries(s.done).filter(([d, v]) => d.startsWith(prefix) && v >= target).length;
}

// --- Recurrence --------------------------------------------------------------

function weekStart(date: string, firstDay: FirstDayOfWeek): string {
  return weekOf(parse(date), firstDay)[0];
}

/**
 * Is `date` a day the seed occurs on? One-offs: the day itself (a span counts
 * every day in it). Fixed cadences count from the anchor, done or not; a
 * chore (`fromDone`) re-anchors on the last completion so a missed day
 * pushes the next due date back instead of piling up; a quota is due any day
 * until met.
 */
export function isDueOn(s: Seed, date: string, firstDay: FirstDayOfWeek = 0): boolean {
  const r = s.repeat;
  if (r.type === 'none') return !!s.date && date >= s.date && date <= (s.endDate ?? s.date);

  const start = anchorOf(s);
  if (date < start) return false;
  if (r.until && date > r.until) return false;

  if (r.type === 'timesPer') {
    if (isDoneOn(s, date)) return true;
    return doneCountIn(s, date, r.per, firstDay) < Math.max(1, r.times);
  }

  if (r.exdates?.includes(date)) return false;
  const n = Math.max(1, r.n);
  if (r.fromDone) {
    if (isDoneOn(s, date)) return true;
    const last = lastDoneBefore(s, date);
    if (!last) return true; // never done yet — due since the anchor
    return date >= shiftBy(last, n, r.unit);
  }
  switch (r.unit) {
    case 'day':
      return diffDays(start, date) % n === 0;
    case 'week': {
      const days = r.days?.length ? r.days : [parse(start).getDay()];
      if (!days.includes(parse(date).getDay())) return false;
      return n === 1 || (diffDays(weekStart(start, firstDay), weekStart(date, firstDay)) / 7) % n === 0;
    }
    case 'month':
      // same day-of-month; months lacking that day are skipped
      return monthsBetween(start, date) % n === 0 && parse(date).getDate() === parse(start).getDate();
    case 'year':
      return date.slice(5) === start.slice(5) && (parse(date).getFullYear() - parse(start).getFullYear()) % n === 0;
  }
}

/** Next day (today or later) a chore comes due; null for non-chore rules. */
export function nextDue(s: Seed, todayStr: string): string | null {
  const r = s.repeat;
  if (r.type !== 'every' || !r.fromDone) return null;
  const last = doneDate(s);
  if (!last) return anchorOf(s) > todayStr ? anchorOf(s) : todayStr;
  const next = shiftBy(last, Math.max(1, r.n), r.unit);
  return next > todayStr ? next : todayStr;
}

/**
 * The day a search hit should land on: a one-off's day (null when undated);
 * for a chore, its next due day; otherwise the next occurrence from today,
 * else the most recent past one, else the anchor. Bounded scans — a weekly
 * seed resolves in under seven steps, a monthly one in at most 31.
 */
export function nearestDate(s: Seed, todayStr: string, firstDay: FirstDayOfWeek = 0): string | null {
  if (s.repeat.type === 'none') return s.date;
  const chore = nextDue(s, todayStr);
  if (chore) return chore;
  const anchor = anchorOf(s);
  for (let i = 0; i <= 366; i++) {
    const day = addDays(todayStr, i);
    if (day >= anchor && isDueOn(s, day, firstDay)) return day;
  }
  for (let i = 1; i <= 366; i++) {
    const day = addDays(todayStr, -i);
    if (day < anchor) break;
    if (isDueOn(s, day, firstDay)) return day;
  }
  return anchor;
}

/** Every day in `[from, to]` (inclusive) on which the seed is due, ascending. */
export function dueDaysBetween(s: Seed, from: string, to: string, firstDay: FirstDayOfWeek = 0): string[] {
  const days: string[] = [];
  if (from > to) return days;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (isDueOn(s, day, firstDay)) days.push(day);
  }
  return days;
}

/** One concrete instance of a (possibly recurring) seed. Dates inclusive. */
export interface Occurrence {
  seed: Seed;
  startDate: string;
  endDate: string;
  /** Stable per-instance key for React lists and reminder dedupe. */
  key: string;
}

function occurrence(seed: Seed, startDate: string, durationDays: number): Occurrence {
  return {
    seed,
    startDate,
    endDate: durationDays === 0 ? startDate : addDays(startDate, durationDays),
    key: `${seed.id}:${startDate}`,
  };
}

/**
 * Expand dated seeds into concrete occurrences intersecting [from, to]
 * (inclusive). Bounded by the visible range, so always cheap — never call
 * with an unbounded range. Undated seeds have no occurrences.
 */
export function expandSeeds(seeds: Seed[], from: string, to: string, firstDay: FirstDayOfWeek = 0): Occurrence[] {
  const out: Occurrence[] = [];
  for (const seed of seeds) {
    if (!seed.date) continue;
    const duration = seed.endDate ? Math.max(0, diffDays(seed.date, seed.endDate)) : 0;
    if (seed.repeat.type === 'none') {
      if (seed.date <= to && addDays(seed.date, duration) >= from) out.push(occurrence(seed, seed.date, duration));
      continue;
    }
    // An occurrence that started up to `duration` days before the range still overlaps it.
    const earliest = addDays(from, -duration);
    for (let day = earliest > seed.date ? earliest : seed.date; day <= to; day = addDays(day, 1)) {
      if (isDueOn(seed, day, firstDay)) out.push(occurrence(seed, day, duration));
    }
  }
  return out.sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || (a.seed.time ?? '').localeCompare(b.seed.time ?? ''),
  );
}

/** True when the occurrence spans more than one day or the seed is all-day. */
export function isBarOccurrence(o: Occurrence): boolean {
  return o.seed.time === null || o.startDate !== o.endDate;
}

/** Week-plus spans (trips, 12-week programs) render as thin background lanes instead of thick titled bars. */
export function isLongOccurrence(o: Occurrence): boolean {
  return diffDays(o.startDate, o.endDate) + 1 >= 7;
}

/** "14:30" -> minutes since midnight. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Where an end lands when the start moves from `oldStart` to `newStart`: the
 * same distance, so rescheduling keeps the span's length.
 */
export function movedEnd(oldStart: string, newStart: string, end: string): string {
  return addDays(end, diffDays(oldStart, newStart));
}

/** "14:30" -> "2:30 PM" (locale-independent 12h for compact pills). */
export function shortTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

// --- Streaks -----------------------------------------------------------------

/**
 * Streak, counting back from today.
 * Day rules: consecutive due days completed (an unfinished today doesn't
 * break it; non-due days are skipped). Quota rules: consecutive weeks/months
 * meeting the quota, with the same grace for the current one.
 */
export function streakOf(s: Seed, firstDay: FirstDayOfWeek = 0): number {
  const r = s.repeat;
  if (r.type === 'none' || !isDoable(s)) return 0;

  const todayStr = fmt(new Date());

  if (r.type === 'timesPer') {
    const met = (anchor: string) => doneCountIn(s, anchor, r.per, firstDay) >= Math.max(1, r.times);
    let anchor = todayStr;
    let streak = 0;
    for (let i = 0; i < 60; i++) {
      if (met(anchor)) streak++;
      else if (anchor !== todayStr) break; // grace: the in-progress period doesn't break it
      anchor = r.per === 'week' ? addDays(anchor, -7) : addMonths(`${anchor.slice(0, 8)}01`, -1);
      if (anchor < `${s.createdAt.slice(0, 8)}01`) break;
    }
    return streak;
  }

  const d = new Date();
  if (isDueOn(s, todayStr, firstDay) && !isDoneOn(s, todayStr)) {
    d.setDate(d.getDate() - 1);
  }
  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const day = fmt(d);
    if (day < anchorOf(s)) break;
    if (isDueOn(s, day, firstDay)) {
      if (!isDoneOn(s, day)) break;
      streak++;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/**
 * Longest run of consecutive due days each completed, from the seed's
 * creation (or its earliest completion, whichever is earlier) to today.
 * Same conventions as `streakOf`.
 */
export function bestStreakOf(s: Seed, firstDay: FirstDayOfWeek = 0): number {
  const r = s.repeat;
  if (r.type === 'none' || !isDoable(s)) return 0;

  const todayStr = fmt(new Date());
  const target = targetOf(s);
  const completed = Object.entries(s.done)
    .filter(([, v]) => v >= target)
    .map(([d]) => d);
  const earliest = completed.reduce((a, b) => (b < a ? b : a), s.createdAt);
  const start = earliest < todayStr ? earliest : todayStr;

  let best = 0;
  let run = 0;

  if (r.type === 'timesPer') {
    const met = (anchor: string) => doneCountIn(s, anchor, r.per, firstDay) >= Math.max(1, r.times);
    let anchor = r.per === 'week' ? weekOf(parse(start), firstDay)[0] : `${start.slice(0, 8)}01`;
    for (let i = 0; i < 1200 && anchor <= todayStr; i++) {
      const next = r.per === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1);
      if (met(anchor)) run++;
      else if (next <= todayStr) run = 0; // grace: the in-progress period doesn't break it
      best = Math.max(best, run);
      anchor = next;
    }
    return best;
  }

  for (const day of dueDaysBetween(s, start, todayStr, firstDay)) {
    if (isDoneOn(s, day)) run++;
    else if (day !== todayStr) run = 0;
    best = Math.max(best, run);
  }
  return best;
}

// --- Labels ------------------------------------------------------------------

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UNIT_WORD: Record<RepeatUnit, [string, string]> = {
  day: ['daily', 'days'],
  week: ['weekly', 'weeks'],
  month: ['monthly', 'months'],
  year: ['yearly', 'years'],
};

/** Human-readable repeat summary, e.g. "every 3 days after last done", "Mon Wed Fri". */
export function repeatLabel(repeat: Repeat, firstDay: FirstDayOfWeek = 0): string {
  switch (repeat.type) {
    case 'none':
      return 'one-time';
    case 'timesPer':
      return `${repeat.times}× per ${repeat.per}`;
    case 'every': {
      const n = Math.max(1, repeat.n);
      const [adverb, plural] = UNIT_WORD[repeat.unit];
      let base = n === 1 ? adverb : `every ${n} ${plural}`;
      if (repeat.unit === 'week' && repeat.days?.length) {
        const days = repeat.days;
        const names =
          days.length === 7
            ? 'daily'
            : rotateWeek([0, 1, 2, 3, 4, 5, 6], firstDay)
                .filter((d) => days.includes(d))
                .map((d) => DAY_NAMES[d])
                .join(' ');
        base = n === 1 ? names : `${names} every ${n} weeks`;
      }
      return repeat.fromDone ? `${n === 1 ? `every ${repeat.unit}` : base} after last done` : base;
    }
  }
}

/** Short status shown next to a habit's title in lists. */
export function statusLabel(s: Seed, todayStr: string, firstDay: FirstDayOfWeek = 0): string {
  const r = s.repeat;
  if (r.type === 'timesPer') {
    const done = doneCountIn(s, todayStr, r.per, firstDay);
    return `${done}/${r.times} this ${r.per}`;
  }
  if (r.type === 'every' && r.fromDone) {
    const next = nextDue(s, todayStr);
    return next === todayStr ? 'due today' : `next ${shortDate(next!)}`;
  }
  const streak = streakOf(s, firstDay);
  return streak > 0 ? `${streak} day streak` : repeatLabel(r, firstDay);
}

/** Display label for seeds in no list (`list === ''`): the neutral inbox, not an error state. */
export const GENERAL = 'General';

/**
 * Sort key for a seed's due moment. Undated seeds sort last (there is no
 * deadline to be late for), and a dated one with no time sorts after the timed
 * ones on the same day.
 */
export function dueSortKey(s: Pick<Seed, 'date' | 'time'>): string {
  if (!s.date) return '￿';
  return `${s.date}T${s.time ?? '99:99'}`;
}

/**
 * Past its moment and still not done. A seed due today counts as overdue only
 * once its time has passed; one with no time has all day to be finished.
 */
export function isOverdue(s: Seed, now: Date = new Date()): boolean {
  if (!s.date || isDone(s)) return false;
  const todayStr = fmt(now);
  if (s.date !== todayStr) return s.date < todayStr;
  return s.time != null && s.time < hhmm(now);
}

/**
 * The day a checkbox click on a one-off seed logs to. Done → the day it was
 * logged on, so the click actually clears it; not done → today, whatever the
 * due day was. Logging on the due day would backdate an overdue tick and
 * drop the row from the dashboard under the pointer (`dashboardTasks` keeps
 * only today's completions in view). Every task surface uses this one rule.
 */
export function completionDay(s: Seed, todayStr: string): string {
  return doneDate(s) ?? todayStr;
}

export interface DueLabel {
  text: string;
  /** `isOverdue` — the one state that gets colour. */
  late: boolean;
}

/**
 * When a seed is due, in the smallest form that still reads: "Today",
 * "Tomorrow" or a short date; a bare time when it's today; date and time for a
 * dated seed with a time; null when there is nothing to say.
 */
export function dueLabel(s: Seed, todayStr: string): DueLabel | null {
  if (!s.date && !s.time) return null;
  const time = s.time ? shortTime(s.time) : '';
  let day = '';
  if (s.date) {
    if (s.date === todayStr) day = time ? '' : 'Today';
    else if (s.date === addDays(todayStr, 1)) day = 'Tomorrow';
    else day = shortDate(s.date);
  }
  return { text: [day, time].filter(Boolean).join(' '), late: isOverdue(s) };
}

// --- Order -------------------------------------------------------------------

/** The user's manual habit order (drag in the Habits list); creation order, then title, break ties. */
export function byHabitOrder(a: Seed, b: Seed): number {
  return a.sort - b.sort || a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title);
}

/** The `sort` that puts a new habit after every existing one. */
export function nextHabitSort(seeds: Seed[]): number {
  return seeds.reduce((max, s) => (isHabit(s) ? Math.max(max, s.sort + 1) : max), 0);
}

/** Starred first, then by due moment, then by title so the order is stable. */
export function byImportanceThenDue(a: Seed, b: Seed): number {
  if (a.important !== b.important) return a.important ? -1 : 1;
  const key = dueSortKey(a).localeCompare(dueSortKey(b));
  return key !== 0 ? key : a.title.localeCompare(b.title);
}

/**
 * What the dashboard's task panel shows: every one-off to-do that needs
 * attention today — undated (nothing to wait for), due today or overdue, or
 * starred — plus anything finished *today* so a tick doesn't vanish under the
 * pointer. A to-do completed on an earlier day is history and drops off.
 */
export function dashboardTasks(seeds: Seed[], todayStr: string): Seed[] {
  return seeds.filter((s) => {
    if (!isTask(s)) return false;
    const done = doneDate(s);
    if (done) return done === todayStr;
    return !s.date || s.date <= todayStr || s.important;
  });
}

/**
 * Dashboard order: starred first, then by due day (undated last), then the
 * order they were added — `sort` is stable, so equal keys keep array order.
 */
export function byDashboardOrder(a: Seed, b: Seed): number {
  if (a.important !== b.important) return a.important ? -1 : 1;
  if (a.date !== b.date) {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export interface ListGroup {
  /** List id, or '' for unfiled. Resolve the name via `DataContext`'s `listById`. */
  list: string;
  seeds: Seed[];
}

/**
 * Seeds grouped by list id for display: unfiled first (it's where anything
 * typed in a hurry lands, so it shouldn't be buried), then the lists in
 * `order`'s sequence (the user's manual `sort`). A list with nothing left is
 * naturally absent, and one not in `order` (deleted since a seed was
 * assigned, before its reference clears) sorts after every ordered one.
 * Each group is sorted by `byImportanceThenDue`.
 */
export function groupByList(seeds: Seed[], order: string[] = []): ListGroup[] {
  const groups = new Map<string, Seed[]>();
  for (const s of seeds) {
    const key = s.list.trim();
    const group = groups.get(key);
    if (group) group.push(s);
    else groups.set(key, [s]);
  }
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === '') return -1;
      if (b === '') return 1;
      const ra = rank.get(a) ?? Number.POSITIVE_INFINITY;
      const rb = rank.get(b) ?? Number.POSITIVE_INFINITY;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    })
    .map(([list, group]) => ({ list, seeds: group.sort(byImportanceThenDue) }));
}

/** Manual order of lists and tags (Settings' up/down), name as the tiebreak so equal sorts stay stable. */
export function bySort(a: { sort: number; name: string }, b: { sort: number; name: string }): number {
  return a.sort - b.sort || a.name.localeCompare(b.name);
}

/**
 * The two `sort` swaps that move a row one step up (`-1`) or down (`1`) in
 * an already-sorted list, or null at either end. Swapping two rows' `sort`
 * values instead of renumbering keeps the sync payload to two rows.
 */
export function moveSorted<T extends { id: string; sort: number }>(
  sorted: T[],
  id: string,
  dir: -1 | 1,
): [{ id: string; sort: number }, { id: string; sort: number }] | null {
  const idx = sorted.findIndex((r) => r.id === id);
  const other = sorted[idx + dir];
  if (idx === -1 || !other) return null;
  return [
    { id: sorted[idx].id, sort: other.sort },
    { id: other.id, sort: sorted[idx].sort },
  ];
}

/** One past the highest `sort` in use — not the length, which collides once anything was reordered. */
export function nextSort(existing: { sort: number }[]): number {
  return existing.reduce((max, r) => Math.max(max, r.sort + 1), 0);
}
