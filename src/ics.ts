import { RRule, rrulestr } from 'rrule';
import { addDays, fmt, hhmm } from './dates';
import type { Repeat, RepeatUnit, Seed } from './types';

/*
 * rrule computes in "floating" time: a date is fed in as UTC midnight and
 * read back from the UTC fields, so the local timezone never shifts a day.
 */
function floatingDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromFloating(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Minimal iCalendar (RFC 5545) VEVENT parser, targeting what Google Calendar
 * exports. Handles all-day and timed events, UTC ("...Z") and wall-clock
 * datetimes, and simple RRULEs (FREQ + INTERVAL + UNTIL/COUNT). TZID times
 * are treated as local wall-clock — right for events created in your own
 * timezone, approximate for foreign ones.
 */

interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): IcsProp | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const [nameAndParams, value] = [line.slice(0, colon), line.slice(colon + 1)];
  const parts = nameAndParams.split(';');
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq !== -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: parts[0].toUpperCase(), params, value };
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** "20260723" or "20260723T090000(Z)" -> { date, time } in local wall-clock. */
function parseDt(value: string): { date: string; time: string | null } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return { date: `${y}-${mo}-${d}`, time: null };
  if (z) {
    const local = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? '0')));
    return {
      date: fmt(local),
      time: hhmm(local),
    };
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

const FREQ_UNIT: Partial<Record<number, RepeatUnit>> = {
  [RRule.DAILY]: 'day',
  [RRule.WEEKLY]: 'week',
  [RRule.MONTHLY]: 'month',
  [RRule.YEARLY]: 'year',
};

/**
 * RRULE → the app's `Repeat`. FREQ/INTERVAL/UNTIL/COUNT and a weekly BYDAY
 * survive; anything finer is dropped, and COUNT is resolved to the last
 * occurrence's date.
 */
function parseRrule(value: string, startDate: string): Repeat {
  let rule: RRule;
  try {
    rule = rrulestr(`RRULE:${value}`, { dtstart: floatingDate(startDate) }) as RRule;
  } catch {
    return { type: 'none' };
  }
  const o = rule.origOptions;
  const n = Math.max(1, o.interval ?? 1);
  const unit = o.freq === undefined ? undefined : FREQ_UNIT[o.freq];
  if (!unit) return { type: 'none' };
  const byday = Array.isArray(o.byweekday) ? o.byweekday : o.byweekday ? [o.byweekday] : [];
  // rrule weekdays are Monday-based (MO = 0); the app uses JS getDay() (Sun = 0).
  const WEEKDAY_STR = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  const mondayBased = (d: (typeof byday)[number]): number =>
    typeof d === 'number' ? d : typeof d === 'string' ? WEEKDAY_STR.indexOf(d) : d.weekday;
  const days = unit === 'week' ? byday.map((d) => (mondayBased(d) + 1) % 7).filter((d) => d >= 0) : [];

  let until: string | null = null;
  // UNTIL keeps its own calendar date (the UTC timestamp's), never shifted
  // into local time — the app bounds by day anyway.
  if (o.until) until = fromFloating(o.until);
  else if (o.count && o.count > 0) {
    const all = rule.all();
    const last = all[all.length - 1];
    if (last) until = fromFloating(last);
  }
  return { type: 'every', n, unit, ...(days.length ? { days } : {}), until };
}

export interface IcsImportResult {
  seeds: Seed[];
  skipped: number;
}

export function parseIcs(text: string): IcsImportResult {
  // unfold continuation lines (RFC 5545 §3.1)
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);

  const seeds: Seed[] = [];
  let skipped = 0;
  let cur: Record<string, IcsProp> | null = null;

  const flush = (props: Record<string, IcsProp>) => {
    // modified instances of recurring events would duplicate the base series
    if (props['RECURRENCE-ID'] || props.STATUS?.value === 'CANCELLED') return;
    const start = props.DTSTART && parseDt(props.DTSTART.value);
    if (!start) {
      skipped++;
      return;
    }

    const allDay = props.DTSTART!.params.VALUE === 'DATE' || start.time === null;
    const end = props.DTEND ? parseDt(props.DTEND.value) : null;

    let endDate = start.date;
    let endTime: string | null = null;
    if (end) {
      if (allDay) {
        // DTEND is exclusive for all-day events
        endDate = end.date > start.date ? addDays(end.date, -1) : start.date;
      } else {
        endDate = end.date >= start.date ? end.date : start.date;
        endTime = end.time;
        // zero-length or inverted same-day ends are meaningless — drop them
        if (endDate === start.date && endTime && start.time && endTime <= start.time) endTime = null;
      }
    }

    const uid = props.UID?.value;
    // A stable id per UID so a re-import updates in place instead of duplicating.
    seeds.push({
      id: uid ? `gcal:${uid}` : crypto.randomUUID(),
      title: props.SUMMARY ? unescapeText(props.SUMMARY.value) : '(untitled)',
      notes: props.DESCRIPTION ? unescapeText(props.DESCRIPTION.value) : '',
      color: null,
      list: '',
      tags: [],
      important: false,
      sort: 0,
      routine: '',
      createdAt: fmt(new Date()),
      date: start.date,
      time: allDay ? null : start.time,
      endDate: endDate > start.date ? endDate : null,
      endTime: allDay ? null : endTime,
      repeat: props.RRULE ? parseRrule(props.RRULE.value, start.date) : { type: 'none' },
      track: null,
      reminders: [],
      done: {},
    });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur) flush(cur);
      cur = null;
      continue;
    }
    if (cur === null) continue;
    const prop = parseLine(line);
    // keep the first DTSTART etc.; later duplicates are malformed anyway
    if (prop && !(prop.name in cur)) cur[prop.name] = prop;
  }

  return { seeds, skipped };
}
