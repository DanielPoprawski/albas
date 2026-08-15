// How a shared (read-only) event is marked wherever events render. Central so
// the month pills, bars, week lanes, day strip and hour grid can't drift: the
// owner's initial in the label, a dimmed body, and an explanatory tooltip.

import type { CalendarEvent } from './types';

/** "s · Dinner" — the sharing account's initial prefixes the title. */
export function eventTitle(e: CalendarEvent): string {
  return e.sharedBy ? `${e.sharedBy[0].toUpperCase()} · ${e.title}` : e.title;
}

/** Shared items draw dimmed; `undefined` leaves own items untouched. */
export function sharedOpacity(e: CalendarEvent): number | undefined {
  return e.sharedBy ? 0.55 : undefined;
}

export function sharedTitleAttr(e: CalendarEvent): string | undefined {
  return e.sharedBy ? `Shared by ${e.sharedBy} (read-only)` : undefined;
}
