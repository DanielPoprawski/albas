import { useMemo } from 'react';
import * as chrono from 'chrono-node';
import { fmt, hhmm } from './dates';

export interface NlDateComponent {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM`, present only when chrono is confident an hour was actually stated. */
  time?: string;
}

export interface NlDateMatch {
  start: NlDateComponent;
  end?: NlDateComponent;
  /** Where the matched phrase sits in the original text, for stripping/highlighting. */
  matched: { index: number; text: string };
}

function toComponent(c: chrono.ParsedComponents): NlDateComponent {
  const d = c.date();
  const time = c.isCertain('hour') ? hhmm(d) : undefined;
  return { date: fmt(d), time };
}

/**
 * Finds the first date/time phrase in free text ("lunch tomorrow at noon",
 * "renew passport by 5 sep"). `forwardDate: true` so a bare weekday/month
 * resolves to the next occurrence rather than the nearest one in the past —
 * the app's whole domain (to-dos, events) is forward-looking.
 */
export function parseWhen(text: string, ref: Date = new Date()): NlDateMatch | null {
  if (text.trim().length < 3) return null;
  const [result] = chrono.parse(text, ref, { forwardDate: true });
  if (!result) return null;
  return {
    start: toComponent(result.start),
    end: result.end ? toComponent(result.end) : undefined,
    matched: { index: result.index, text: result.text },
  };
}

/**
 * Removes the matched phrase from `text` and tidies what's left: collapses
 * the resulting double space and drops a now-dangling leading/trailing
 * connector word ("call mom on" -> "call mom", "on friday call mom" ->
 * "call mom").
 */
export function stripMatch(text: string, matched: { index: number; text: string }): string {
  const before = text.slice(0, matched.index);
  const after = text.slice(matched.index + matched.text.length);
  let out = `${before} ${after}`.replace(/\s{2,}/g, ' ').trim();
  out = out.replace(/^(on|at|for|by)\s+/i, '').replace(/\s+(on|at|for|by)$/i, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}

function dayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function pointLabel(c: NlDateComponent): string {
  return c.time ? `${dayLabel(c.date)} · ${c.time}` : dayLabel(c.date);
}

/**
 * "Fri 5 Sep · 15:00", "Tue 9 Sep · 14:00–16:00" for a same-day range, or
 * "Sun 13 Sep → Thu 17 Sep" when the end falls on another day.
 */
export function describeWhen(parsed: NlDateMatch): string {
  const start = pointLabel(parsed.start);
  const end = parsed.end;
  if (!end) return start;
  if (end.date === parsed.start.date) return end.time && parsed.start.time ? `${start}–${end.time}` : start;
  return `${start} → ${pointLabel(end)}`;
}

/**
 * The date fields' parser: chrono's *strict* grammar, day-first ("18/9" is
 * the 18th of September). Takes "18 sep", "sep 18", "Thu 18 Sep 2026",
 * "2026-09-18"; refuses "tomorrow" and "next friday" — those are for the
 * title, where the suggestion chip shows the interpretation before it lands.
 */
const strictDayFirst = new chrono.Chrono(chrono.en.configuration.createConfiguration(true, true));

export function parseStrictDate(text: string, ref: Date = new Date()): string | null {
  const [result] = strictDayFirst.parse(text.trim(), ref, { forwardDate: true });
  return result ? fmt(result.start.date()) : null;
}

/**
 * Memoized `parseWhen` for a title field. Skips anything under 3 characters
 * so a single keystroke doesn't run chrono for nothing — `parseWhen` already
 * enforces this, `useMemo` just avoids re-running it on every unrelated
 * re-render of the form.
 */
export function useNlDate(title: string): NlDateMatch | null {
  return useMemo(() => parseWhen(title), [title]);
}
