import type { Dispatch, SetStateAction } from 'react';
import { addDays, fmt, parse } from './dates';
import type { CalendarMode } from './types';

/**
 * The two pieces of `UiContext` state the calendar navigates with. Passed in
 * rather than read here so these helpers stay plain functions any surface —
 * the header, the mobile nav, the search palette, a keyboard shortcut — can
 * call without being a React component.
 */
export interface CalendarNavApi {
  setCurrentMonth: Dispatch<SetStateAction<Date>>;
  setSelectedDate: (date: string | null) => void;
}

/** First of the month a `YYYY-MM-DD` day falls in. */
export function monthOf(dateStr: string): Date {
  const d = parse(dateStr);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** True when `month` (any day of it) is the month `now` falls in. */
export function isThisMonth(month: Date, now: Date = new Date()): boolean {
  return month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
}

/** Make the viewed month contain `dateStr`, without re-creating it if it already does. */
export function syncMonth(api: CalendarNavApi, dateStr: string): void {
  const d = parse(dateStr);
  api.setCurrentMonth((m) =>
    m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth()
      ? m
      : new Date(d.getFullYear(), d.getMonth(), 1),
  );
}

/** Select a day and show its month — what a search hit or a picker lands on. */
export function jumpTo(api: CalendarNavApi, dateStr: string): void {
  api.setCurrentMonth(monthOf(dateStr));
  api.setSelectedDate(dateStr);
}

export function goToday(api: CalendarNavApi): void {
  jumpTo(api, fmt(new Date()));
}

export function stepMonth(api: CalendarNavApi, dir: 1 | -1): void {
  api.setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + dir, 1));
}

export function stepYear(api: CalendarNavApi, dir: 1 | -1): void {
  api.setCurrentMonth((m) => new Date(m.getFullYear() + dir, m.getMonth(), 1));
}

/**
 * Prev/next for the mode being viewed: a month in month view, seven days or
 * one day (moving the selected day and keeping the month in step) otherwise.
 */
export function stepPeriod(api: CalendarNavApi, mode: CalendarMode, anchor: string, dir: 1 | -1): void {
  if (mode === 'month') {
    stepMonth(api, dir);
    return;
  }
  const next = addDays(anchor, dir * (mode === 'week' ? 7 : 1));
  api.setSelectedDate(next);
  syncMonth(api, next);
}
