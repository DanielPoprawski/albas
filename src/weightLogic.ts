import { addDays, fmt, parse, weekOf } from './dates';
import type { FirstDayOfWeek, WeightEntry, WeightUnit } from './types';

export const KG_PER_LB = 0.45359237;

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/** Stored weight (always kg) rendered in the user's chosen unit. */
export function displayWeight(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kgToLb(kg);
}

/** A typed-in weight converted back to the kg we store. */
export function toStoredKg(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : lbToKg(value);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface DayCell {
  date: string;
  /** Mean of every reading that day — the scale often records more than one. */
  weightKg: number | null;
  bodyFat: number | null;
}

export interface WeekRow {
  weekStart: string; // first day of the week, per the setting
  days: DayCell[]; // always 7, in first-day-of-week order
  avgKg: number | null;
  avgBodyFat: number | null;
}

/** Per-day means keyed by date, so a day with three weigh-ins counts once. */
function byDay(entries: WeightEntry[]): Map<string, DayCell> {
  const buckets = new Map<string, { kg: number[]; bf: number[] }>();
  for (const e of entries) {
    const b = buckets.get(e.date) ?? { kg: [], bf: [] };
    b.kg.push(e.weightKg);
    if (e.bodyFat != null) b.bf.push(e.bodyFat);
    buckets.set(e.date, b);
  }
  return new Map(
    [...buckets].map(([date, b]) => [date, { date, weightKg: mean(b.kg), bodyFat: mean(b.bf) }])
  );
}

/**
 * Week rows, newest first, covering every week from the first reading
 * to the current one — including blank weeks, so gaps stay visible rather than
 * silently collapsing.
 */
export function weeklyRows(entries: WeightEntry[], firstDay: FirstDayOfWeek = 1): WeekRow[] {
  if (entries.length === 0) return [];
  const days = byDay(entries);

  const dates = [...days.keys()].sort();
  const first = weekOf(parse(dates[0]), firstDay)[0];
  const last = weekOf(new Date(), firstDay)[0];

  const rows: WeekRow[] = [];
  for (let start = first; start <= last; start = addDays(start, 7)) {
    const cells = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i);
      return days.get(date) ?? { date, weightKg: null, bodyFat: null };
    });
    rows.push({
      weekStart: start,
      days: cells,
      avgKg: mean(cells.map(c => c.weightKg).filter((v): v is number => v != null)),
      avgBodyFat: mean(cells.map(c => c.bodyFat).filter((v): v is number => v != null)),
    });
  }
  return rows.reverse();
}

export interface MonthRow {
  /** YYYY-MM */
  month: string;
  avgBodyFat: number | null;
  avgKg: number | null;
  sampleCount: number;
}

/** Monthly averages, newest first. Only months with at least one reading. */
export function monthlyRows(entries: WeightEntry[]): MonthRow[] {
  const buckets = new Map<string, { kg: number[]; bf: number[] }>();
  for (const cell of byDay(entries).values()) {
    const month = cell.date.slice(0, 7);
    const b = buckets.get(month) ?? { kg: [], bf: [] };
    if (cell.weightKg != null) b.kg.push(cell.weightKg);
    if (cell.bodyFat != null) b.bf.push(cell.bodyFat);
    buckets.set(month, b);
  }
  return [...buckets]
    .map(([month, b]) => ({
      month,
      avgKg: mean(b.kg),
      avgBodyFat: mean(b.bf),
      sampleCount: b.kg.length,
    }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));
}

/** "2026-07" -> "July 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function currentMonthKey(): string {
  return fmt(new Date()).slice(0, 7);
}
