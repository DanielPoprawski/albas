import { RRule, type Frequency } from 'rrule';
import { addDays, diffDays } from './dates';
import type { CalendarEvent, Recurrence } from './types';

/*
 * rrule computes in "floating" time: a date is fed in as UTC midnight and
 * read back from the UTC fields, so the local timezone never shifts a day.
 */
export function floatingDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromFloating(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const FREQ: Record<Exclude<Recurrence['type'], 'none'>, Frequency> = {
  daily: RRule.DAILY,
  weekdays: RRule.WEEKLY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
};

const RRULE_WEEKDAYS = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA];

/** One concrete instance of a (possibly recurring) event. Dates inclusive. */
export interface Occurrence {
  event: CalendarEvent;
  startDate: string;
  endDate: string;
  /** Stable per-instance key for React lists and reminder dedupe. */
  key: string;
}

/** The rrule for a recurring event. Monthly on the 31st skips months without one — rrule's own rule. */
function ruleFor(event: CalendarEvent, rec: Exclude<Recurrence, { type: 'none' }>): RRule {
  const options: ConstructorParameters<typeof RRule>[0] = {
    freq: FREQ[rec.type],
    interval: Math.max(1, rec.interval ?? 1),
    dtstart: floatingDate(event.startDate),
    until: rec.until ? floatingDate(rec.until) : null,
  };

  if (rec.type === 'weekdays') {
    options.byweekday = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR];
  } else if (rec.type === 'weekly' && rec.days && rec.days.length > 0) {
    options.byweekday = rec.days.map((d) => RRULE_WEEKDAYS[d % 7]);
  }

  return new RRule(options);
}

/**
 * The occurrence a search hit should land on: the next one from today
 * (an instance already under way today counts), else the last one that
 * happened (a finished series), else the series start. Exdates are skipped.
 */
export function nearestOccurrence(event: CalendarEvent, todayStr: string): string {
  const rec = event.recurrence;
  if (rec.type === 'none') return event.startDate;
  const rule = ruleFor(event, rec);
  const exdates = new Set(rec.exdates ?? []);
  const duration = Math.max(0, diffDays(event.startDate, event.endDate));

  let d = rule.after(floatingDate(addDays(todayStr, -duration)), true);
  while (d && exdates.has(fromFloating(d))) d = rule.after(d, false);
  if (d) return fromFloating(d);

  let p = rule.before(floatingDate(todayStr), false);
  while (p && exdates.has(fromFloating(p))) p = rule.before(p, false);
  return p ? fromFloating(p) : event.startDate;
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

    if (rec.type === 'none') {
      if (event.startDate <= rangeEnd && event.endDate >= rangeStart) {
        out.push(occurrence(event, event.startDate, duration));
      }
      continue;
    }

    const rule = ruleFor(event, rec);
    // An occurrence that started up to `duration` days before the range still overlaps it.
    const exdates = rec.exdates ?? [];
    for (const d of rule.between(floatingDate(addDays(rangeStart, -duration)), floatingDate(rangeEnd), true)) {
      const start = fromFloating(d);
      if (!exdates.includes(start)) out.push(occurrence(event, start, duration));
    }
  }

  return out.sort((a, b) =>
    a.startDate !== b.startDate
      ? a.startDate.localeCompare(b.startDate)
      : (a.event.startTime ?? '').localeCompare(b.event.startTime ?? ''),
  );
}

/** True when the occurrence spans more than one day or the event is all-day. */
export function isBarOccurrence(o: Occurrence): boolean {
  return o.event.allDay || o.startDate !== o.endDate;
}

/**
 * Week-plus spans (trips, 12-week programs — the old "periods") render as
 * thin background lanes instead of thick titled bars.
 */
export function isLongOccurrence(o: Occurrence): boolean {
  return diffDays(o.startDate, o.endDate) + 1 >= 7;
}

/** "14:30" -> minutes since midnight. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** "14:30" -> "2:30 PM" (locale-independent 12h for compact pills). */
/**
 * Where an event's end lands when its start moves from `oldStart` to
 * `newStart`: the same distance, so rescheduling keeps the span's length
 * instead of making the user edit both dates.
 */
export function movedEnd(oldStart: string, newStart: string, end: string): string {
  return addDays(end, diffDays(oldStart, newStart));
}

export function shortTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}
