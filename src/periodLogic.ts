import { addDays, diffDays } from './dates';
import { isDoneOn, isDueOn } from './habitLogic';
import type { Habit, Period } from './types';

export interface PeriodProgress {
  totalDays: number;
  /** Days elapsed including today, clamped to [0, totalDays]. */
  elapsedDays: number;
  totalWeeks: number;
  /** 1-based week currently in progress; 0 before start, totalWeeks after end. */
  currentWeek: number;
  /** 0..1 fraction of elapsed time. */
  timeFraction: number;
  /** 0..1 completion of linked habits over elapsed due days; null if nothing to measure. */
  habitCompletion: number | null;
}

export function periodsOn(periods: Period[], dateStr: string): Period[] {
  return periods.filter(p => p.startDate <= dateStr && dateStr <= p.endDate);
}

export function periodProgress(period: Period, habits: Habit[], todayStr: string): PeriodProgress {
  const totalDays = diffDays(period.startDate, period.endDate) + 1;
  const totalWeeks = Math.ceil(totalDays / 7);
  const elapsedDays = Math.min(totalDays, Math.max(0, diffDays(period.startDate, todayStr) + 1));
  const currentWeek = elapsedDays === 0 ? 0 : Math.ceil(elapsedDays / 7);

  const linked = period.habitIds
    .map(id => habits.find(h => h.id === id))
    .filter((h): h is Habit => !!h);

  let habitCompletion: number | null = null;
  if (linked.length > 0 && elapsedDays > 0) {
    const measureEnd = period.endDate < todayStr ? period.endDate : todayStr;
    const ratios: number[] = [];
    for (const habit of linked) {
      let due = 0;
      let done = 0;
      for (let d = period.startDate; d <= measureEnd; d = addDays(d, 1)) {
        if (isDueOn(habit, d)) {
          due++;
          if (isDoneOn(habit, d)) done++;
        }
      }
      if (due > 0) ratios.push(done / due);
    }
    if (ratios.length > 0) {
      habitCompletion = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    }
  }

  return {
    totalDays,
    elapsedDays,
    totalWeeks,
    currentWeek,
    timeFraction: totalDays === 0 ? 0 : elapsedDays / totalDays,
    habitCompletion,
  };
}

/** "Week 3 of 12" / "Starts Jul 20" / "Ended" summary line. */
export function periodStatusLabel(progress: PeriodProgress, period: Period, todayStr: string): string {
  if (todayStr < period.startDate) return 'Not started';
  if (todayStr > period.endDate) return 'Ended';
  return `Week ${progress.currentWeek} of ${progress.totalWeeks}`;
}
