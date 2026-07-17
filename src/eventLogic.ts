import { addDays, diffDays, fmt, parse } from './dates';
import type { CalendarEvent } from './types';

/** One concrete instance of a (possibly recurring) event. Dates inclusive. */
export interface Occurrence {
  event: CalendarEvent;
  startDate: string;
  endDate: string;
  /** Stable per-instance key for React lists and reminder dedupe. */
  key: string;
}

function occurrence(event: CalendarEvent, startDate: string, durationDays: number): Occurrence {
  return {
    event,
    startDate,
    endDate: durationDays === 0 ? startDate : addDays(startDate, durationDays),
    key: `${event.id}:${startDate}`,
  };
}

/**
 * Expand events into concrete occurrences intersecting [rangeStart, rangeEnd]
 * (inclusive). Bounded by the visible range, so always cheap — never call with
 * an unbounded range.
 */
export function expandEvents(events: CalendarEvent[], rangeStart: string, rangeEnd: string): Occurrence[] {
  const out: Occurrence[] = [];

  for (const event of events) {
    const duration = Math.max(0, diffDays(event.startDate, event.endDate));
    const rec = event.recurrence;
    const until = rec.type !== 'none' && rec.until ? rec.until : null;
    const lastStart = until && until < rangeEnd ? until : rangeEnd;

    if (rec.type === 'none') {
      if (event.startDate <= rangeEnd && event.endDate >= rangeStart) {
        out.push(occurrence(event, event.startDate, duration));
      }
      continue;
    }

    if (rec.type === 'daily' || rec.type === 'weekly') {
      const step = rec.type === 'daily' ? Math.max(1, rec.interval) : 7 * Math.max(1, rec.interval);
      // first k >= 0 whose occurrence-end reaches the range
      const k = Math.max(0, Math.ceil((diffDays(event.startDate, rangeStart) - duration) / step));
      for (let start = addDays(event.startDate, k * step); start <= lastStart; start = addDays(start, step)) {
        out.push(occurrence(event, start, duration));
      }
      continue;
    }

    // monthly: same day-of-month every N months; months lacking that day are skipped
    const anchor = parse(event.startDate);
    const day = anchor.getDate();
    const interval = Math.max(1, rec.interval);
    for (let k = 0; ; k++) {
      const monthFirst = new Date(anchor.getFullYear(), anchor.getMonth() + k * interval, 1);
      if (fmt(monthFirst) > lastStart) break;
      const d = new Date(monthFirst.getFullYear(), monthFirst.getMonth(), day);
      if (d.getDate() !== day) continue; // JS rolled e.g. Feb 31 into March — skip this month
      const start = fmt(d);
      if (start > lastStart) break;
      if (addDays(start, duration) >= rangeStart) out.push(occurrence(event, start, duration));
    }
  }

  return out.sort((a, b) =>
    a.startDate !== b.startDate
      ? a.startDate.localeCompare(b.startDate)
      : (a.event.startTime ?? '').localeCompare(b.event.startTime ?? '')
  );
}

/** Occurrences covering a single day. */
export function occurrencesOn(events: CalendarEvent[], dateStr: string): Occurrence[] {
  return expandEvents(events, dateStr, dateStr).filter(
    o => o.startDate <= dateStr && o.endDate >= dateStr
  );
}

/** True when the occurrence spans more than one day or the event is all-day. */
export function isBarOccurrence(o: Occurrence): boolean {
  return o.event.allDay || o.startDate !== o.endDate;
}

/** "14:30" -> minutes since midnight. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** "14:30" -> "2:30 PM" (locale-independent 12h for compact pills). */
export function shortTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}
