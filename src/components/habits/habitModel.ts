import { arrayMove } from '@dnd-kit/sortable';
import { addDays, parse } from '../../dates';
import { bestStreakOf, isDoneOn, isDueOn, kindLabel, streakOf, targetOf, valueOn } from '../../seedLogic';
import type { FirstDayOfWeek, HabitsLayout, Repeat, Routine, Seed } from '../../types';

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
  today: boolean;
}

export interface HabitData {
  seed: Seed;
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
export function getHabitCells(seed: Seed, firstDayOfWeek: FirstDayOfWeek, todayStr: string): HistoryCell[] {
  const offset = (parse(todayStr).getDay() - firstDayOfWeek + 7) % 7;
  const start = addDays(todayStr, -offset - (HISTORY_WEEKS - 1) * 7);
  return cellsFor(
    seed,
    Array.from({ length: HISTORY_WEEKS * 7 }, (_, i) => addDays(start, i)),
    firstDayOfWeek,
    todayStr,
  );
}

/** One cell per day of `dates`, in the given order — what every `HabitStrip` draws from. */
export function cellsFor(seed: Seed, dates: string[], firstDayOfWeek: FirstDayOfWeek, todayStr: string): HistoryCell[] {
  return dates.map((dateStr) => ({
    dateStr,
    done: isDoneOn(seed, dateStr),
    due: isDueOn(seed, dateStr, firstDayOfWeek),
    future: dateStr > todayStr,
    today: dateStr === todayStr,
  }));
}

/** Done due days over due days, as a whole percentage; 0 when nothing was due. */
function rateOf(cells: HistoryCell[]): number {
  const due = cells.filter((c) => c.due);
  if (due.length === 0) return 0;
  return Math.round((due.filter((c) => c.done).length / due.length) * 100);
}

/**
 * Streaks and rates come from `seedLogic` (`streakOf`/`bestStreakOf`/`isDueOn`)
 * so the Habits view, the drawer and the dashboard can never disagree about
 * what "done" or "streak" means for a schedule.
 */
export function buildHabitData(seed: Seed, firstDayOfWeek: FirstDayOfWeek, todayStr: string): HabitData {
  const cells = getHabitCells(seed, firstDayOfWeek, todayStr);
  const past = cells.filter((c) => !c.future);
  const history: number[] = past.map((c) => (c.done ? 1 : 0));
  return {
    seed,
    currentStreak: streakOf(seed, firstDayOfWeek),
    bestStreak: bestStreakOf(seed, firstDayOfWeek),
    weeklyRate: rateOf(past.slice(-7)),
    history,
    cells,
    strip: past.slice(-STRIP_DAYS),
    completion: rateOf(past),
    doneToday: isDoneOn(seed, todayStr),
  };
}

export const ROUTINE_OPTIONS: { value: Exclude<Routine, ''>; label: string }[] = [
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
];

/** The habit's routine: its tag, else its time of day (a reminder time), else none. */
export function routineOf(seed: Seed): Routine {
  if (seed.routine) return seed.routine;
  if (!seed.time) return '';
  return seed.time < '12:00' ? 'morning' : seed.time < '17:00' ? 'afternoon' : 'evening';
}

type Cadence = 'daily' | 'weekly' | 'monthly' | 'chores';

/** Which cadence bucket a repeat rule falls in — the Cadence layout needs no metadata. */
function cadenceOf(repeat: Repeat): Cadence {
  if (repeat.type === 'timesPer') return repeat.per === 'week' ? 'weekly' : 'monthly';
  if (repeat.type !== 'every' || (repeat.unit === 'day' && repeat.n <= 1 && !repeat.fromDone)) return 'daily';
  if (repeat.fromDone) return 'chores';
  if (repeat.unit === 'week' && repeat.days?.length === 7) return 'daily';
  return repeat.unit === 'day' || repeat.unit === 'week' ? 'weekly' : 'monthly';
}

export interface HabitGroup {
  key: string;
  /** Empty in the flat layout, where the list has no headers. */
  label: string;
  seeds: Seed[];
}

const CADENCE_LABELS: Record<Cadence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  chores: 'Chores',
};
const ROUTINE_LABELS: Record<Routine, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  '': 'Anytime',
};

/**
 * The Habits list under a layout preset: one flat group, or the habits
 * bucketed by cadence or routine in a fixed order, empty buckets dropped.
 * `habits` arrive in the user's order and keep it inside each group.
 */
export function groupHabits(habits: Seed[], layout: HabitsLayout): HabitGroup[] {
  if (layout === 'flat') return [{ key: 'all', label: '', seeds: habits }];
  const keys: string[] = layout === 'cadence' ? Object.keys(CADENCE_LABELS) : Object.keys(ROUTINE_LABELS);
  const labels: Record<string, string> = layout === 'cadence' ? CADENCE_LABELS : ROUTINE_LABELS;
  const of = layout === 'cadence' ? (s: Seed) => cadenceOf(s.repeat) : routineOf;
  return keys
    .map((key) => ({ key, label: labels[key], seeds: habits.filter((s) => of(s) === key) }))
    .filter((g) => g.seeds.length > 0);
}

/**
 * The `sort` writes that drop `activeId` where `overId` sits in the user's
 * ordered habit list: every row whose index moved gets `sort = index`, which
 * also renumbers rows still on the pre-order default the first time.
 */
export function reorderHabits(ordered: Seed[], activeId: string, overId: string): { id: string; sort: number }[] {
  const from = ordered.findIndex((s) => s.id === activeId);
  const to = ordered.findIndex((s) => s.id === overId);
  if (from === -1 || to === -1) return [];
  const moved = arrayMove(ordered, from, to);
  return moved.flatMap((s, i) => (s.sort === i ? [] : [{ id: s.id, sort: i }]));
}

/** A schedule-shaped label for the habit's identity tag: "Chore" for a from-done rule, else its kind. */
export function fallbackLabel(seed: Seed): string {
  if (seed.repeat.type === 'every' && seed.repeat.fromDone) return 'Chore';
  const kind = kindLabel(seed);
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * What a click on a day cell means, on every surface (`HabitStrip` is the
 * only caller): a check toggles, a count counts up and wraps to 0 past the
 * target.
 */
export function cycleCell(
  seed: Seed,
  dateStr: string,
  toggleDone: (id: string, date: string) => void,
  setDone: (id: string, date: string, value: number) => void,
): void {
  if (seed.track?.kind !== 'count') {
    toggleDone(seed.id, dateStr);
    return;
  }
  const v = valueOn(seed, dateStr);
  setDone(seed.id, dateStr, v >= targetOf(seed) ? 0 : v + 1);
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
