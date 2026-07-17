import { diffDays } from '../../dates';

/** A date-span clamped to one week row of the calendar. Columns are 1-based. */
export interface Segment<T> {
  item: T;
  startCol: number; // 1..7
  span: number;     // 1..7
  startsHere: boolean; // true span start (round the left edge)
  endsHere: boolean;   // true span end (round the right edge)
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

/** Greedy lane assignment: first free lane whose segments don't overlap in columns. */
export function assignLanes<T>(segments: Segment<T>[]): { seg: Segment<T>; lane: number }[] {
  const sorted = [...segments].sort((a, b) => a.startCol - b.startCol || b.span - a.span);
  const laneEnds: number[] = []; // last occupied column per lane
  return sorted.map(seg => {
    let lane = laneEnds.findIndex(end => end < seg.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = seg.startCol + seg.span - 1;
    return { seg, lane };
  });
}
