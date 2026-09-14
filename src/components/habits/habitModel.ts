import { addDays, parse } from '../../dates';
import { bestStreakOf, isDoneOn, isDueOn, streakOf, valueOn } from '../../todoLogic';
import type { FirstDayOfWeek, Todo } from '../../types';

/** The drawer's heatmap: this many week columns, the last one being this week. */
export const HISTORY_WEEKS = 16;
/** The row's strip: the most recent days, oldest → today. */
export const STRIP_DAYS = 28;

export interface HistoryCell {
  dateStr: string;
  /** `isDoneOn` — value reached the target, the same test the dashboard uses. */
  done: boolean;
  /** `isDueOn` — a past non-due day is neither a hit nor a miss. */
  due: boolean;
  /** Days after today are shown but not clickable. */
  future: boolean;
}

export interface HabitData {
  todo: Todo;
  currentStreak: number;
  bestStreak: number;
  weeklyRate: number;
  /** Past-to-today, one entry per calendar day of the heatmap. */
  history: number[];
  /** The full heatmap, `HISTORY_WEEKS × 7`, oldest first. */
  cells: HistoryCell[];
  /** The last `STRIP_DAYS` non-future cells. */
  strip: HistoryCell[];
  /** Done due days ÷ due days of the heatmap, as a percentage. */
  completion: number;
  doneToday: boolean;
}

/**
 * The past `HISTORY_WEEKS` as whole weeks aligned to the user's week start,
 * ending with the current week (so the last column runs past today into
 * greyed-out future days). Every cell keeps its date, because the grid is
 * clickable — any past day can be marked done from here.
 */
export function getHabitCells(todo: Todo, firstDayOfWeek: FirstDayOfWeek, todayStr: string): HistoryCell[] {
  const offset = (parse(todayStr).getDay() - firstDayOfWeek + 7) % 7;
  const start = addDays(todayStr, -offset - (HISTORY_WEEKS - 1) * 7);
  return cellsFor(
    todo,
    Array.from({ length: HISTORY_WEEKS * 7 }, (_, i) => addDays(start, i)),
    firstDayOfWeek,
    todayStr,
  );
}

/** One cell per day of `dates`, in the given order — what every `HabitStrip` draws from. */
export function cellsFor(todo: Todo, dates: string[], firstDayOfWeek: FirstDayOfWeek, todayStr: string): HistoryCell[] {
  return dates.map((dateStr) => ({
    dateStr,
    done: isDoneOn(todo, dateStr),
    due: isDueOn(todo, dateStr, firstDayOfWeek),
    future: dateStr > todayStr,
  }));
}

/** Done due days over due days, as a whole percentage; 0 when nothing was due. */
function rateOf(cells: HistoryCell[]): number {
  const due = cells.filter((c) => c.due);
  if (due.length === 0) return 0;
  return Math.round((due.filter((c) => c.done).length / due.length) * 100);
}

/**
 * Streaks and rates come from `todoLogic` (`streakOf`/`bestStreakOf`/`isDueOn`)
 * so the Habits view, the drawer and the dashboard can never disagree about
 * what "done" or "streak" means for a schedule.
 */
export function buildHabitData(todo: Todo, firstDayOfWeek: FirstDayOfWeek, todayStr: string): HabitData {
  const cells = getHabitCells(todo, firstDayOfWeek, todayStr);
  const past = cells.filter((c) => !c.future);
  const history: number[] = past.map((c) => (c.done ? 1 : 0));
  return {
    todo,
    currentStreak: streakOf(todo, firstDayOfWeek),
    bestStreak: bestStreakOf(todo, firstDayOfWeek),
    weeklyRate: rateOf(past.slice(-7)),
    history,
    cells,
    strip: past.slice(-STRIP_DAYS),
    completion: rateOf(past),
    doneToday: isDoneOn(todo, todayStr),
  };
}

/** Falls back to a schedule-shaped label when the habit has no category. */
export function fallbackLabel(todo: Todo): string {
  if (todo.schedule.type === 'once') return 'Task';
  if (todo.schedule.type === 'every' && todo.schedule.fromDone) return 'Chore';
  return 'Habit';
}

/**
 * What a click on a day cell means, on every surface (`HabitStrip` is the
 * only caller): yes/no toggles, measurable counts up and wraps to 0 past the
 * target.
 */
export function cycleCell(
  todo: Todo,
  dateStr: string,
  toggleTodo: (id: string, date: string) => void,
  setTodoValue: (id: string, date: string, value: number) => void,
): void {
  if (todo.kind === 'yesno') {
    toggleTodo(todo.id, dateStr);
    return;
  }
  const v = valueOn(todo, dateStr);
  setTodoValue(todo.id, dateStr, v >= todo.target ? 0 : v + 1);
}

/**
 * One label per week column of the heatmap: the month's short name where a
 * new month starts (and on the first column), blank elsewhere. A label whose
 * successor would land fewer than three columns later is dropped, so two
 * short months never run together as "MAYJUN".
 */
export function monthLabels(cells: HistoryCell[], weeks: number): (string | null)[] {
  const starts: number[] = [];
  let prev = '';
  for (let w = 0; w < weeks; w++) {
    const first = cells[w * 7]?.dateStr ?? '';
    const month = first.slice(0, 7);
    if (w === 0 || month !== prev) starts.push(w);
    prev = month;
  }
  const labels: (string | null)[] = Array.from({ length: weeks }, () => null);
  for (let i = 0; i < starts.length; i++) {
    const next = starts[i + 1];
    if (next !== undefined && next - starts[i] < 3) continue;
    const w = starts[i];
    labels[w] = parse(cells[w * 7].dateStr)
      .toLocaleDateString(undefined, { month: 'short' })
      .toUpperCase();
  }
  return labels;
}

/** Weekday initial (S M T W T F S) for a `YYYY-MM-DD` day. */
export function weekdayInitial(dateStr: string): string {
  return 'SMTWTFS'[parse(dateStr).getDay()];
}
