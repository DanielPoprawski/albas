import { useState } from 'react';
import { Bell } from 'lucide-react';
import QuickAddField from './QuickAddField';
import SearchBar from './SearchBar';
import { useApp } from '../context/AppContext';
import { addDays, fmt } from '../dates';
import { isRepeating, valueOn } from '../todoLogic';
import { colorHex } from '../colors';
import { Tag } from './ui/tag';
import { cn } from '@/lib/utils';
import type { Category, FirstDayOfWeek, Todo } from '../types';

/** The month grid: this many week columns, the last one being this week. */
const HISTORY_WEEKS = 5;

interface HistoryCell {
  dateStr: string;
  done: boolean;
  /** Days after today are shown but not clickable. */
  future: boolean;
}

interface HabitData {
  todo: Todo;
  currentStreak: number;
  bestStreak: number;
  weeklyRate: number;
  /** Past-to-today, one entry per calendar day of the month grid. */
  history: number[];
  cells: HistoryCell[];
  doneToday: boolean;
  reminderTime: string;
}

function computeStreaks(history: number[]): { current: number; best: number } {
  let current = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]) current++;
    else break;
  }
  let best = 0,
    run = 0;
  for (const d of history) {
    if (d) {
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  return { current, best };
}

/**
 * The past month as whole weeks: `HISTORY_WEEKS` columns aligned to the
 * user's week start, ending with the current week (so the last column runs
 * past today into greyed-out future days). Every cell keeps its date, because
 * the grid is clickable — any past day can be marked done from here.
 */
function getHabitCells(todo: Todo, firstDayOfWeek: FirstDayOfWeek): HistoryCell[] {
  const today = new Date();
  const todayStr = fmt(today);
  // Back to the start of this week, then HISTORY_WEEKS - 1 more weeks.
  const offset = (today.getDay() - firstDayOfWeek + 7) % 7;
  const start = addDays(todayStr, -offset - (HISTORY_WEEKS - 1) * 7);
  const cells: HistoryCell[] = [];
  for (let i = 0; i < HISTORY_WEEKS * 7; i++) {
    const dateStr = addDays(start, i);
    cells.push({ dateStr, done: !!todo.completions[dateStr], future: dateStr > todayStr });
  }
  return cells;
}

/** Falls back to a schedule-shaped label when the habit has no category. */
function fallbackLabel(todo: Todo): string {
  if (todo.schedule.type === 'once') return 'Task';
  if (todo.schedule.type === 'every' && todo.schedule.fromDone) return 'Chore';
  return 'Habit';
}

/* TODO rework stats — the overall stat cards and the week chart are parked
   here (and their render site in HabitsView is commented out) until the
   numbers are redone.

function StatCard({
  value,
  label,
}: {
  value: string | number;
  label: string;
}) {
  return (
    <div className="flex-1 bg-surface border border-[var(--t-border)] px-5 py-4">
      <div
        className="font-heading font-bold text-2xl leading-none"
      >
        {value}
      </div>
      <div className="text-sm text-[var(--t-ink-secondary)] mt-1">
        {label}
      </div>
    </div>
  );
}

function WeekChart({ habits }: { habits: HabitData[] }) {
  const today = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekBars: { label: string; pct: number }[] = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = fmt(date);

    let done = 0;
    for (const h of habits) {
      // Check if this habit is due on this date
      if (isDueOn(h.todo, dateStr)) {
        done += h.todo.completions[dateStr] ? 1 : 0;
      }
    }

    const pct = habits.length > 0 ? Math.round((done / habits.length) * 100) : 0;
    weekBars.push({ label: dayNames[date.getDay()], pct });
  }

  return (
    <div className="bg-surface border border-[var(--t-border)] p-5 mb-6">
      <div
        className="font-heading text-sm font-bold uppercase tracking-[0.5px] text-[var(--t-ink-muted)] mb-4"
      >
        This Week
      </div>
      <div
        className="flex items-end gap-3 h-[6.875rem]"
      >
        {weekBars.map((bar, idx) => (
          <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full gap-2">
            <div className="w-full flex-1 flex flex-col justify-end">
              <div
                className="w-full bg-accent min-h-1"
                // dynamic: the bar is as tall as the percentage it shows
                style={{ height: bar.pct + '%' }}
              />
            </div>
            <div className="text-xs text-[var(--t-ink-muted)]">{bar.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

*/

function HabitCard({ habit }: { habit: HabitData }) {
  const { toggleTodo, setTodoValue, categoryById } = useApp();
  const color = colorHex(habit.todo.colorKey);
  const todo = habit.todo;
  const category = categoryById(todo.category);

  // Same semantics as the week strip on the dashboard (`todo/HabitsSection`):
  // yes/no toggles, measurable counts up and wraps to 0 past the target.
  function handleCellClick(dateStr: string) {
    if (todo.kind === 'yesno') {
      toggleTodo(todo.id, dateStr);
    } else {
      const v = valueOn(todo, dateStr);
      setTodoValue(todo.id, dateStr, v >= todo.target ? 0 : v + 1);
    }
  }

  return (
    <div className="row-hover p-4.5 flex flex-col gap-3.5">
      {/* Top row: color dot + name + cadence tag */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-[0.625rem] h-[0.625rem] flex-shrink-0"
          // dynamic: the habit's own colour
          style={{ background: color }}
        />
        <div className="font-heading text-base font-bold flex-1">{habit.todo.name}</div>
        <Tag accent={category ? colorHex(category.colorKey) : color} className="font-heading flex-shrink-0">
          {category?.name ?? fallbackLabel(todo)}
        </Tag>
      </div>

      {/* Stats row */}
      <div className="flex gap-5">
        <div className="flex flex-col">
          <span className="font-heading text-lg font-bold">{habit.currentStreak}</span>
          <span className="text-xs text-[var(--t-ink-muted)]">Day streak</span>
        </div>
        <div className="flex flex-col">
          <span className="font-heading text-lg font-bold">{habit.bestStreak}</span>
          <span className="text-xs text-[var(--t-ink-muted)]">Best streak</span>
        </div>
        <div className="flex flex-col">
          <span className="font-heading text-lg font-bold">{habit.weeklyRate}%</span>
          <span className="text-xs text-[var(--t-ink-muted)]">This week</span>
        </div>
      </div>

      {/* Reminder line */}
      <div className="flex items-center gap-[0.375rem] text-xs text-[var(--t-ink-secondary)]">
        <Bell size="0.8125rem" />
        Reminder · {habit.reminderTime || 'No time set'}
      </div>

      {/* Past month. Explicit tracks both ways: with implicit `auto` columns
          the grid's default `justify-content: stretch` spread the week
          columns across the card while the rows stayed 0.5625rem, which is why the
          horizontal gaps never matched the vertical ones. Columns are weeks,
          rows are weekdays, every cell 1rem square with a 0.25rem gap. */}
      <div
        className="grid grid-flow-col grid-rows-[repeat(7,1rem)] gap-1 justify-start"
        role="group"
        aria-label={`${todo.name}, past month`}
        // dynamic: one column per week of history
        style={{ gridTemplateColumns: `repeat(${HISTORY_WEEKS}, 1rem)` }}
      >
        {habit.cells.map((cell) => {
          const value = todo.kind === 'measurable' ? valueOn(todo, cell.dateStr) : 0;
          const partial = !cell.done && value > 0;
          return (
            <button
              key={cell.dateStr}
              type="button"
              disabled={cell.future}
              onClick={() => handleCellClick(cell.dateStr)}
              title={
                cell.future
                  ? cell.dateStr
                  : `${cell.dateStr}${cell.done ? ' — done' : partial ? ` — ${value}/${todo.target}` : ''}`
              }
              aria-label={`${cell.dateStr}${cell.done ? ', done' : ''}`}
              aria-pressed={cell.done}
              className="w-4 h-4 p-0 box-border transition-transform enabled:hover:scale-125 disabled:cursor-default"
              // dynamic: the habit's own colour
              style={{
                background: cell.done
                  ? color
                  : partial
                    ? `${color}66`
                    : cell.future
                      ? 'transparent'
                      : 'var(--t-subtle)',
                border: `1px solid ${cell.done || partial ? color : 'var(--t-border)'}`,
                opacity: cell.future ? 0.4 : 1,
              }}
            />
          );
        })}
      </div>

      {/* Done button */}
      <button
        onClick={() => toggleTodo(habit.todo.id, fmt(new Date()))}
        className={`border border-[var(--t-accent)] px-3 py-2 text-sm font-bold transition-colors ${
          habit.doneToday
            ? 'bg-[var(--t-accent)] text-on-accent hover:bg-[var(--t-accent-hover)]'
            : 'bg-surface text-[var(--t-accent)] hover:bg-[var(--t-accent-tint)]'
        }`}
      >
        {habit.doneToday ? 'Completed today' : 'Mark as done'}
      </button>
    </div>
  );
}

export default function HabitsView() {
  const { todos, firstDayOfWeek, categoriesFor } = useApp();
  const today = fmt(new Date());
  const [filter, setFilter] = useState<string | null>(null);
  const habitCategories = categoriesFor('habits');

  // Filter to repeating todos (habits), then to the selected category chip
  const habits: HabitData[] = todos
    .filter((t) => isRepeating(t))
    .filter((t) => filter === null || t.category === filter)
    .map((todo) => {
      const cells = getHabitCells(todo, firstDayOfWeek);
      const history: number[] = cells.filter((c) => !c.future).map((c) => (c.done ? 1 : 0));
      const { current, best } = computeStreaks(history);
      const last7 = history.slice(-7);
      const weeklyRate = Math.round((last7.reduce((a, b) => a + b, 0) / 7) * 100);
      const doneToday = !!todo.completions[today];

      return {
        todo,
        currentStreak: current,
        bestStreak: best,
        weeklyRate,
        history,
        cells,
        doneToday,
        reminderTime: todo.time || 'No time set',
      };
    });

  // TODO rework stats — the overall stat cards and the week chart are parked
  // (see the commented block in the body below) until the numbers are redone.
  // const todayDoneCount = habits.filter(h => h.doneToday).length;
  // const bestOverallStreak = habits.length > 0 ? Math.max(...habits.map(h => h.currentStreak)) : 0;
  // let weekSum = 0;
  // for (const h of habits) {
  //   const last7 = h.history.slice(-7);
  //   weekSum += last7.reduce((a, b) => a + b, 0);
  // }
  // const weeklyRateOverall =
  //   habits.length > 0 ? Math.round((weekSum / (habits.length * 7)) * 100) : 0;

  return (
    // `flex-1 min-w-0` + a white ground: this is the design's `.main-column`,
    // and as a bare child of the shell's flex row it would otherwise size to
    // its content and let the page grey show through.
    <div className="flex-1 min-w-0 flex flex-col bg-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-[var(--t-border)]">
        <div className="flex flex-col gap-[2px]">
          <h1 className="font-heading text-lg font-bold text-[var(--t-ink)]">Habits</h1>
          <p className="text-sm text-[var(--t-ink-muted)]">Build consistency, one day at a time.</p>
        </div>
        <SearchBar scope="habits" className="hidden md:block flex-shrink-0" />
      </div>

      {/* Body - scrollable */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* TODO rework stats — parked, not deleted:
        <div className="flex flex-col md:flex-row gap-4 mb-5">
          <StatCard value={`${todayDoneCount}/${habits.length}`} label="Completed today" />
          <StatCard value={bestOverallStreak} label="Longest active streak" />
          <StatCard value={`${weeklyRateOverall}%`} label="Weekly completion rate" />
        </div>
        {habits.length > 0 && <WeekChart habits={habits} />}
        */}

        {/* Filter chips — only worth showing once there's something to filter by. */}
        {habitCategories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Filter by category">
            <button type="button" onClick={() => setFilter(null)}>
              <Tag
                solid={filter === null}
                className={cn(
                  'cursor-pointer transition-opacity',
                  filter !== null && 'opacity-60 hover:opacity-100 bg-subtle text-ink-secondary',
                )}
              >
                All
              </Tag>
            </button>
            {habitCategories.map((c: Category) => (
              <button key={c.id} type="button" onClick={() => setFilter(c.id)}>
                <Tag
                  accent={colorHex(c.colorKey)}
                  solid={filter === c.id}
                  className={`cursor-pointer transition-opacity ${filter === c.id ? '' : 'opacity-70 hover:opacity-100'}`}
                >
                  {c.name}
                </Tag>
              </button>
            ))}
          </div>
        )}

        <QuickAddField type="habit" defaultCategory={filter ?? undefined} className="mb-4" />

        <div className="grid grid-cols-[repeat(auto-fill,minmax(21.25rem,1fr))] gap-4">
          {habits.map((h) => (
            <HabitCard key={h.todo.id} habit={h} />
          ))}
        </div>
      </div>
    </div>
  );
}
