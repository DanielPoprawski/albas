import {
  addDays as dfAddDays,
  addMonths as dfAddMonths,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  eachDayOfInterval,
  format,
  parseISO,
  startOfWeek,
} from 'date-fns';
import type { FirstDayOfWeek } from './types';

/*
 * Dates are `YYYY-MM-DD` strings in local wall-clock time everywhere in the
 * app (they sort as dates, and the whole model is timezone-free). These are
 * the string-in/string-out helpers over date-fns.
 */

export function fmt(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/** Local midnight of a `YYYY-MM-DD` string. */
export function parse(dateStr: string): Date {
  return parseISO(dateStr);
}

/** Wall-clock `HH:MM` of a Date. */
export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Now, rounded *down* to a quarter hour — the start you'd have typed anyway. */
export function nowFloor15(): string {
  const d = new Date();
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
  return hhmm(d);
}

/** `HH:MM` plus N minutes, clamped to 23:59 so an evening start can't wrap. */
export function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Whole days from `fromStr` to `toStr` (negative if `toStr` is earlier). */
export function diffDays(fromStr: string, toStr: string): number {
  return differenceInCalendarDays(parse(toStr), parse(fromStr));
}

/** `dateStr` shifted by `n` days (n may be negative). */
export function addDays(dateStr: string, n: number): string {
  return fmt(dfAddDays(parse(dateStr), n));
}

/** `dateStr` shifted by `n` calendar months, day-of-month clamped to the target month's end. */
export function addMonths(dateStr: string, n: number): string {
  return fmt(dfAddMonths(parse(dateStr), n));
}

/** Whole calendar months from `fromStr`'s month to `toStr`'s month. */
export function monthsBetween(fromStr: string, toStr: string): number {
  return differenceInCalendarMonths(parse(toStr), parse(fromStr));
}

/** "2026-07-04" -> "Jul 4" */
export function shortDate(dateStr: string): string {
  return parse(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "2026-09-18" -> "Fri 18 Sep 2026" — how a `DateField` shows its value; '' stays ''. */
export function fieldDate(dateStr: string): string {
  if (!dateStr) return '';
  return parse(dateStr).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * The seven dates of the week containing `d`, starting on `firstDay`
 * (0 = Sunday, 1 = Monday). As of v1.7 the default is Sunday, matching the
 * default setting — a missing argument and an unconfigured app agree.
 */
export function weekOf(d: Date, firstDay: FirstDayOfWeek = 0): string[] {
  const start = startOfWeek(d, { weekStartsOn: firstDay });
  return eachDayOfInterval({ start, end: dfAddDays(start, 6) }).map(fmt);
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

/**
 * A timestamp as the status bar wants it: the clock time, plus the date only
 * when it isn't today. A sync that happened this session is almost always
 * minutes old, and "24 Aug" in front of it every time is noise; a sync from
 * last week needs the day or the time alone is a lie.
 */
export function stampLabel(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return fmt(d) === fmt(new Date(now)) ? time : `${shortDate(fmt(d))} ${time}`;
}

/**
 * Coarse "how long ago", deliberately approximate — the point of the status
 * bar's copy is "recent enough?", not a duration. Rounds down, so it never
 * claims more time has passed than actually has, and stops at days because
 * anything older than that is a problem the bar can't express anyway.
 */
export function timeAgo(ms: number, now: number = Date.now()): string {
  const secs = Math.max(0, Math.floor((now - ms) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
