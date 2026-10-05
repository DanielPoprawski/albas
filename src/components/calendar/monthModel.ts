import { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { diffDays, fmt } from '../../dates';
import { completionDay, expandSeeds, isDone, isDoneOn, isHabit, isRepeating, type Occurrence } from '../../seedLogic';
import type { ColorKey, FirstDayOfWeek, Seed } from '../../types';

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

/* ── Occurrence kinds ── */

/**
 * How an occurrence is drawn on every calendar surface: a multi-day wash, an
 * all-day bar, a same-day chip, or a timed block in the hour grid. A doable
 * seed with no time is a chip even though it is "all-day" — it is a thing to
 * tick off, not a stretch of time — and one with a time is a block.
 */
export type OccKind = 'long' | 'bar' | 'chip' | 'timed';

export function occKind(o: Occurrence): OccKind {
  if (o.startDate !== o.endDate) return 'long';
  if (o.seed.time) return 'timed';
  return o.seed.track ? 'chip' : 'bar';
}

/** Whether a doable occurrence reads as done: a one-off on any day, a habit on that day. */
export function occDone(o: Occurrence): boolean {
  return isRepeating(o.seed) ? isDoneOn(o.seed, o.startDate) : isDone(o.seed);
}

/** The day a tick on this occurrence logs to (see `completionDay`). */
export function occToggleDate(o: Occurrence, todayStr: string): string {
  return isRepeating(o.seed) ? o.startDate : completionDay(o.seed, todayStr);
}

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
  /** Cell wash from the first multi-day span covering this day, if any. */
  wash: ColorKey | undefined;
  longStarts: Occurrence[];
  longEnds: Occurrence[];
  shownOccs: Occurrence[];
  /** Chips dropped by the pill cap. */
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
  onEdit: (o: Occurrence) => void;
  /** Tick a doable occurrence. */
  onToggle: (o: Occurrence) => void;
  onDayClick: (dateStr: string) => void;
  /** The "+N more" overflow: show the whole day. */
  onShowDay: (dateStr: string) => void;
}

/** The only things that differ between the two layouts; see each field. */
export interface MonthModelOptions {
  /** Chips a cell may show. A phone cell fits one legible one to a desktop's two. */
  pillCap: number;
  /** Floor on the row count, so the row height doesn't jump between months. */
  minWeeks?: number;
}

/**
 * The seeds a grid draws: dated, not hidden, and not a habit — repeating
 * to-dos never mark the month or week grid; the day view and Habits list them.
 */
export function gridSeeds(allSeeds: Seed[], isVisible: (s: Seed) => boolean): Seed[] {
  return allSeeds.filter((s) => s.date !== null && !isHabit(s) && isVisible(s));
}

/**
 * Everything the month grid draws, derived once and shared by both layouts.
 * All grid logic belongs here — a fix applied in one layout only is exactly
 * what this split exists to prevent.
 */
export function useMonthModel({ pillCap, minWeeks = 0 }: MonthModelOptions): WeekRow[] {
  const { currentMonth, selectedDate, allSeeds, firstDayOfWeek, isVisible, colorOf } = useApp();

  const todayStr = fmt(new Date());
  const days = getCalendarDays(currentMonth, firstDayOfWeek, minWeeks);

  const rangeStart = fmt(days[0].date);
  const rangeEnd = fmt(days[days.length - 1].date);
  // Shared seeds ride the same pipeline (lanes, pills, washes, overflow);
  // each carries `sharedBy`, which the render sites use to dim and de-click.
  const occurrences = useMemo(
    () => expandSeeds(gridSeeds(allSeeds, isVisible), rangeStart, rangeEnd, firstDayOfWeek),
    [allSeeds, isVisible, rangeStart, rangeEnd, firstDayOfWeek],
  );

  return useMemo(() => {
    const weeks: { date: Date; isCurrentMonth: boolean }[][] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

    // multi-day spans tint their day cells instead of taking a lane
    const longOccs = occurrences.filter((o) => occKind(o) === 'long');
    const barOccs = occurrences.filter((o) => occKind(o) === 'bar');

    return weeks.map((week) => {
      const weekDays = week.map((d) => fmt(d.date));

      const allBarLanes = assignLanes(weekSegments(barOccs, weekDays));
      const barLanes = allBarLanes.filter((l) => l.lane < MAX_BAR_LANES);
      // bars that didn't fit fall back to pills in their start cell
      const overflowBars = allBarLanes.filter((l) => l.lane >= MAX_BAR_LANES).map((l) => l.seg.item);
      const nBarLanes = laneCount(barLanes);

      const cells = week.map(({ date, isCurrentMonth }): DayCell => {
        const dateStr = fmt(date);

        // chips: timed and untimed same-day occurrences + bars that overflowed the lane cap
        const dayPills = occurrences.filter((o) => {
          if (o.startDate !== dateStr) return false;
          const kind = occKind(o);
          return kind === 'chip' || kind === 'timed' || overflowBars.some((b) => b.key === o.key);
        });
        const shownOccs = dayPills.slice(0, pillCap);

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
          wash: cellLongs.length > 0 ? colorOf(cellLongs[0].seed) : undefined,
          longStarts: cellLongs.filter((o) => o.startDate === dateStr),
          longEnds: cellLongs.filter((o) => o.endDate === dateStr),
          shownOccs,
          hiddenCount: dayPills.length - shownOccs.length,
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
  }, [currentMonth, selectedDate, occurrences, todayStr, pillCap, minWeeks, colorOf]);
}
