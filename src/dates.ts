import type { CalendarMode, FirstDayOfWeek } from './types';

export function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parse(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from `fromStr` to `toStr` (negative if `toStr` is earlier). */
export function diffDays(fromStr: string, toStr: string): number {
  const ms = parse(toStr).getTime() - parse(fromStr).getTime();
  // Math.round absorbs DST's ±1h drift
  return Math.round(ms / 86_400_000);
}

/** `dateStr` shifted by `n` days (n may be negative). */
export function addDays(dateStr: string, n: number): string {
  const d = parse(dateStr);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

/** `dateStr` shifted by `n` calendar months, day-of-month clamped to the target month's end. */
export function addMonths(dateStr: string, n: number): string {
  const d = parse(dateStr);
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d.getDate(), lastDay));
  return fmt(t);
}

/** Whole calendar months from `fromStr`'s month to `toStr`'s month. */
export function monthsBetween(fromStr: string, toStr: string): number {
  const a = parse(fromStr);
  const b = parse(toStr);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** "2026-07-04" -> "Jul 4" */
export function shortDate(dateStr: string): string {
  return parse(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "2026-07-04" -> "Saturday, Jul 4" */
export function longDate(dateStr: string): string {
  return parse(dateStr).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * The seven dates of the week containing `d`, starting on `firstDay`
 * (0 = Sunday, 1 = Monday). As of v1.7 the default is Sunday, matching the
 * default setting — a missing argument and an unconfigured app agree.
 */
export function weekOf(d: Date, firstDay: FirstDayOfWeek = 0): string[] {
  const start = new Date(d);
  start.setDate(d.getDate() - ((d.getDay() - firstDay + 7) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return fmt(day);
  });
}

/**
 * Reorder a Sunday-first array of seven into display order. Label tables are
 * written Sunday-first (matching `getDay()`) and rotated for display, so the
 * index of a column always maps back to a real weekday.
 */
export function rotateWeek<T>(sundayFirst: readonly T[], firstDay: FirstDayOfWeek): T[] {
  return Array.from({ length: 7 }, (_, i) => sundayFirst[(firstDay + i) % 7]);
}

/** `getDay()` value shown in display column `i`. */
export function weekdayAt(i: number, firstDay: FirstDayOfWeek): number {
  return (firstDay + i) % 7;
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The calendar's header label, shared by `Calendar` and the top bar so the
 * month name isn't rendered twice. The year is dropped in the current year —
 * it's the common case, and on a phone the title now shares its row with the
 * calendar nav, so a week range that keeps it truncates.
 */
export function calendarTitle(
  mode: CalendarMode,
  currentMonth: Date,
  anchor: string,
  firstDay: FirstDayOfWeek = 0,
): string {
  const thisYear = new Date().getFullYear();

  if (mode === 'week') {
    const weekDays = weekOf(parse(anchor), firstDay);
    const endYear = parse(weekDays[6]).getFullYear();
    const range = `${shortDate(weekDays[0])} – ${shortDate(weekDays[6])}`;
    return endYear === thisYear ? range : `${range}, ${endYear}`;
  }
  if (mode === 'day') return longDate(anchor);

  const name = MONTH_NAMES[currentMonth.getMonth()];
  const year = currentMonth.getFullYear();
  return year === thisYear ? name : `${name} ${year}`;
}
