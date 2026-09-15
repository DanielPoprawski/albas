import { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { diffDays, fmt } from '../../dates';
import { isDueOn, isRepeating } from '../../todoLogic';
import { expandEvents, isBarOccurrence, isLongOccurrence } from '../../eventLogic';
import { colorHex } from '../../colors';
import type { Occurrence } from '../../eventLogic';
import type { FirstDayOfWeek, Todo } from '../../types';

export function getCalendarDays(
  month: Date,
  weekStart: FirstDayOfWeek = 0,
  minWeeks = 0,
): { date: Date; isCurrentMonth: boolean }[] {
  const year = month.getFullYear();
  const m = month.getMonth();

  const firstDay = new Date(year, m, 1);
  const lastDay = new Date(year, m + 1, 0);

  // pad back to the week start, and forward to the last day of that week
  const startOffset = (firstDay.getDay() - weekStart + 7) % 7;
  const endOffset = (weekStart + 6 - lastDay.getDay() + 7) % 7;

  const start = new Date(firstDay);
  start.setDate(start.getDate() - startOffset);
  const end = new Date(lastDay);
  end.setDate(end.getDate() + endOffset);

  const days: { date: Date; isCurrentMonth: boolean }[] = [];
  const cur = new Date(start);
  // a month covers 4–6 weeks; `minWeeks` keeps trailing days coming so the row
  // count — and therefore the row height — doesn't jump between months
  while (cur <= end || days.length < minWeeks * 7) {
    days.push({ date: new Date(cur), isCurrentMonth: cur.getMonth() === m });
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

const MAX_BAR_LANES = 3;

/* ── Week spans ── */

/** A date-span clamped to one week row of the calendar. Columns are 1-based. */
export interface Segment<T> {
  item: T;
  startCol: number; // 1..7
  span: number; // 1..7
  startsHere: boolean; // true span start (round the left edge)
  endsHere: boolean; // true span end (round the right edge)
}

/** Clamp inclusive date-spans to a week (7 consecutive YYYY-MM-DD strings). */
export function weekSegments<T extends { startDate: string; endDate: string }>(
  items: T[],
  weekDays: string[],
): Segment<T>[] {
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const out: Segment<T>[] = [];
  for (const item of items) {
    if (item.startDate > weekEnd || item.endDate < weekStart) continue;
    const segStart = item.startDate > weekStart ? item.startDate : weekStart;
    const segEnd = item.endDate < weekEnd ? item.endDate : weekEnd;
    out.push({
      item,
      startCol: diffDays(weekStart, segStart) + 1,
      span: diffDays(segStart, segEnd) + 1,
      startsHere: item.startDate >= weekStart,
      endsHere: item.endDate <= weekEnd,
    });
  }
  return out;
}

/** How many lanes an assignment occupies (0 when empty). */
export function laneCount(lanes: { lane: number }[]): number {
  return lanes.reduce((n, l) => Math.max(n, l.lane + 1), 0);
}

/** Greedy lane assignment: first free lane whose segments don't overlap in columns. */
export function assignLanes<T>(segments: Segment<T>[]): { seg: Segment<T>; lane: number }[] {
  const sorted = [...segments].sort((a, b) => a.startCol - b.startCol || b.span - a.span);
  const laneEnds: number[] = []; // last occupied column per lane
  return sorted.map((seg) => {
    let lane = laneEnds.findIndex((end) => end < seg.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = seg.startCol + seg.span - 1;
    return { seg, lane };
  });
}

/* ── Cell model ── */

export interface DayCell {
  date: Date;
  dateStr: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  /** Strictly before today — drawn struck through. Today itself is not past. */
  isPast: boolean;
  /** From getDay(), not the column index — a Sunday start moves the weekend columns. */
  isWeekend: boolean;
  /** Cell wash from the week-plus spans covering this day, if any. */
  background: string | undefined;
  longStarts: Occurrence[];
  longEnds: Occurrence[];
  shownOccs: Occurrence[];
  shownOnce: Todo[];
  /** Events + to-dos dropped by the pill cap, counted together so "+N" is honest. */
  hiddenCount: number;
}

export interface WeekRow {
  key: string;
  days: DayCell[];
  barLanes: { seg: Segment<Occurrence>; lane: number }[];
  /** Lanes the bar overlay occupies (each `--spacing-lane-row` tall); 0 when the week has no bars. */
  barLaneCount: number;
}

/** What each layout variant receives; all state lives in the MonthView shell. */
export interface MonthLayoutProps {
  weeks: WeekRow[];
  onEditEvent: (o: Occurrence) => void;
  onEditTodo: (t: Todo) => void;
  onDayClick: (dateStr: string) => void;
}

/**
 * Day-cell wash for the week-plus spans ("periods") covering it: a flat tint
 * for one, diagonal zig-zag stripes of each color for overlaps.
 */
function periodBackground(hexes: string[]): string | undefined {
  if (hexes.length === 0) return undefined;
  if (hexes.length === 1) return `${hexes[0]}26`;
  const stripe = 0.5625; // rem per colour band
  const stops = hexes.map((hex, i) => `${hex}2e ${i * stripe}rem, ${hex}2e ${(i + 1) * stripe}rem`).join(', ');
  return `repeating-linear-gradient(135deg, ${stops})`;
}

/** The only things that differ between the two layouts; see each field. */
export interface MonthModelOptions {
  /** Chips a cell may show. A phone cell fits one legible one to a desktop's two. */
  pillCap: number;
  /** Floor on the row count, so the row height doesn't jump between months. */
  minWeeks?: number;
}

/**
 * Everything the month grid draws, derived once and shared by both layouts.
 * All grid logic belongs here — a fix applied in one layout only is exactly
 * what this split exists to prevent.
 */
export function useMonthModel({ pillCap, minWeeks = 0 }: MonthModelOptions): WeekRow[] {
  const { currentMonth, selectedDate, todos, allEvents, firstDayOfWeek } = useApp();

  const todayStr = fmt(new Date());
  const days = getCalendarDays(currentMonth, firstDayOfWeek, minWeeks);

  const rangeStart = fmt(days[0].date);
  const rangeEnd = fmt(days[days.length - 1].date);
  // Shared events ride the same pipeline (lanes, pills, washes, overflow);
  // each carries `sharedBy`, which the render sites use to dim and de-click.
  const occurrences = useMemo(() => expandEvents(allEvents, rangeStart, rangeEnd), [allEvents, rangeStart, rangeEnd]);

  return useMemo(() => {
    const weeks: { date: Date; isCurrentMonth: boolean }[][] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

    const onceTodos = todos.filter((t) => !isRepeating(t));

    // week-plus spans (trips, programs — the old periods) tint their day cells
    // instead of taking a lane
    const longOccs = occurrences.filter(isLongOccurrence);
    const barOccs = occurrences.filter((o) => isBarOccurrence(o) && !isLongOccurrence(o));

    return weeks.map((week) => {
      const weekDays = week.map((d) => fmt(d.date));

      const allBarLanes = assignLanes(weekSegments(barOccs, weekDays));
      const barLanes = allBarLanes.filter((l) => l.lane < MAX_BAR_LANES);
      // bars that didn't fit fall back to pills in their start cell
      const overflowBars = allBarLanes.filter((l) => l.lane >= MAX_BAR_LANES).map((l) => l.seg.item);
      const nBarLanes = laneCount(barLanes);

      const cells = week.map(({ date, isCurrentMonth }): DayCell => {
        const dateStr = fmt(date);

        // Repeating to-dos never mark the grid; the day view and Habits list them.
        const dayOnce = onceTodos.filter((t) => isDueOn(t, dateStr, firstDayOfWeek));
        // timed single-day events + bars that overflowed the lane cap
        const dayPillOccs = occurrences.filter(
          (o) => o.startDate === dateStr && (!isBarOccurrence(o) || overflowBars.some((b) => b.key === o.key)),
        );
        const shownOccs = dayPillOccs.slice(0, pillCap);
        const shownOnce = dayOnce.slice(0, Math.max(0, pillCap - shownOccs.length));

        const cellLongs = longOccs.filter((o) => o.startDate <= dateStr && o.endDate >= dateStr);

        return {
          date,
          dateStr,
          isCurrentMonth,
          isToday: dateStr === todayStr,
          isSelected: dateStr === selectedDate,
          // YYYY-MM-DD sorts lexically, so a string compare is a date compare
          isPast: dateStr < todayStr,
          isWeekend: date.getDay() === 0 || date.getDay() === 6,
          background: periodBackground(cellLongs.map((o) => colorHex(o.event.colorKey))),
          longStarts: cellLongs.filter((o) => o.startDate === dateStr),
          longEnds: cellLongs.filter((o) => o.endDate === dateStr),
          shownOccs,
          shownOnce,
          hiddenCount: dayPillOccs.length + dayOnce.length - shownOccs.length - shownOnce.length,
        };
      });

      return {
        key: weekDays[0],
        days: cells,
        barLanes,
        barLaneCount: nBarLanes,
      };
    });
    // `days` is rebuilt each render from currentMonth, so key on that instead
  }, [currentMonth, selectedDate, todos, occurrences, firstDayOfWeek, todayStr, pillCap, minWeeks]);
}
