import { diffDays, fmt, parse } from './dates';
import type { Habit } from './types';

export function valueOn(habit: Habit, dateStr: string): number {
  return habit.completions[dateStr] ?? 0;
}

export function isDoneOn(habit: Habit, dateStr: string): boolean {
  return valueOn(habit, dateStr) >= habit.target;
}

/** Most recent day strictly before `dateStr` on which the habit was completed. */
function lastDoneBefore(habit: Habit, dateStr: string): string | null {
  let best: string | null = null;
  for (const [d, v] of Object.entries(habit.completions)) {
    if (v >= habit.target && d < dateStr && (!best || d > best)) best = d;
  }
  return best;
}

export function isDueOn(habit: Habit, dateStr: string): boolean {
  if (dateStr < habit.createdAt) return false;
  const s = habit.schedule;
  switch (s.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return s.days.includes(parse(dateStr).getDay());
    case 'interval':
      return diffDays(habit.createdAt, dateStr) % s.every === 0;
    case 'chore': {
      // Anchored to the last completion: missing a day pushes the next due
      // date back instead of piling up early reminders.
      if (isDoneOn(habit, dateStr)) return true;
      const last = lastDoneBefore(habit, dateStr);
      if (!last) return true; // never done yet — due now
      return diffDays(last, dateStr) >= s.every;
    }
  }
}

/**
 * Consecutive due days completed, counting back from today.
 * An unfinished today doesn't break the streak; non-due days are skipped.
 */
export function streakOf(habit: Habit): number {
  const d = new Date();
  const todayStr = fmt(d);
  if (isDueOn(habit, todayStr) && !isDoneOn(habit, todayStr)) {
    d.setDate(d.getDate() - 1);
  }
  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const s = fmt(d);
    if (s < habit.createdAt) break;
    if (isDueOn(habit, s)) {
      if (!isDoneOn(habit, s)) break;
      streak++;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** Human-readable schedule summary, e.g. "every 3 days (chore)". */
export function scheduleLabel(habit: Habit): string {
  const s = habit.schedule;
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (s.type) {
    case 'daily': return 'daily';
    case 'weekdays': return s.days.length === 7 ? 'daily'
      : [1, 2, 3, 4, 5, 6, 0].filter(d => s.days.includes(d)).map(d => DAY_NAMES[d]).join(' ');
    case 'interval': return s.every === 1 ? 'daily' : `every ${s.every} days`;
    case 'chore': return `every ${s.every} days after last done`;
  }
}
