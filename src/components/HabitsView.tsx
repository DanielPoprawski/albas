import { useState } from 'react';
import { Bell } from 'lucide-react';
import AddModal from './AddModal';
import { useApp } from '../context/AppContext';
import { fmt } from '../dates';
import { isDueOn, isRepeating } from '../todoLogic';
import { colorHex } from '../colors';
import type { Todo } from '../types';

const HISTORY_LEN = 63; // 9 weeks

interface HabitData {
  todo: Todo;
  currentStreak: number;
  bestStreak: number;
  weeklyRate: number;
  history: number[];
  heatmapCells: { bg: string; border: string }[];
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

function getHabitHistory(todo: Todo, dayCount: number): number[] {
  const today = new Date();
  const history: number[] = [];

  for (let i = dayCount - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = fmt(date);
    history.push(todo.completions[dateStr] ? 1 : 0);
  }

  return history;
}

function getCategory(todo: Todo): string {
  if (todo.category) return todo.category;
  // Fallback based on schedule
  if (todo.schedule.type === 'once') return 'Task';
  if (todo.schedule.type === 'every' && todo.schedule.fromDone) return 'Chore';
  return 'Habit';
}

function StatCard({
  value,
  label,
}: {
  value: string | number;
  label: string;
}) {
  return (
    <div className="flex-1 bg-white border border-[var(--t-border)] px-[var(--space-20)] py-[var(--space-16)]">
      <div
        className="font-heading font-bold text-[26px] leading-none"
        style={{ fontFamily: 'var(--t-font-heading)' }}
      >
        {value}
      </div>
      <div className="text-[12px] text-[var(--t-ink-secondary)] mt-[var(--space-4)]">
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
    <div className="bg-white border border-[var(--t-border)] p-[var(--space-20)] mb-[var(--space-24)]">
      <div
        className="text-[12px] font-bold uppercase tracking-[0.5px] text-[var(--t-ink-muted)] mb-[var(--space-16)]"
        style={{ fontFamily: 'var(--t-font-heading)' }}
      >
        This Week
      </div>
      <div
        className="flex items-end gap-[var(--space-12)] h-[110px]"
      >
        {weekBars.map((bar, idx) => (
          <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full gap-[var(--space-8)]">
            <div className="w-full flex-1 flex flex-col justify-end">
              <div
                className="w-full"
                style={{
                  background: 'var(--t-accent)',
                  height: bar.pct + '%',
                  minHeight: '4px',
                }}
              />
            </div>
            <div className="text-[11px] text-[var(--t-ink-muted)]">{bar.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HabitCard({ habit }: { habit: HabitData }) {
  const { toggleTodo } = useApp();
  const color = colorHex(habit.todo.colorKey);
  const tagBg = color + '14';

  return (
    <div className="bg-white border border-[var(--t-border)] p-[var(--space-18)] flex flex-col gap-[var(--space-14)] transition-colors hover:border-[var(--t-accent)]">
      {/* Top row: color dot + name + cadence tag */}
      <div className="flex items-center gap-[var(--space-10)]">
        <div
          className="w-[10px] h-[10px] flex-shrink-0"
          style={{ background: color }}
        />
        <div
          className="text-[14px] font-bold flex-1"
          style={{ fontFamily: 'var(--t-font-heading)' }}
        >
          {habit.todo.name}
        </div>
        <div
          className="text-[10px] font-bold uppercase tracking-[0.5px] px-[var(--space-8)] py-[3px] flex-shrink-0"
          style={{
            color: color,
            background: tagBg,
            fontFamily: 'var(--t-font-heading)',
          }}
        >
          {getCategory(habit.todo)}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-[var(--space-20)]">
        <div className="flex flex-col">
          <span
            className="text-[18px] font-bold"
            style={{ fontFamily: 'var(--t-font-heading)' }}
          >
            {habit.currentStreak}
          </span>
          <span className="text-[10px] text-[var(--t-ink-muted)]">Day streak</span>
        </div>
        <div className="flex flex-col">
          <span
            className="text-[18px] font-bold"
            style={{ fontFamily: 'var(--t-font-heading)' }}
          >
            {habit.bestStreak}
          </span>
          <span className="text-[10px] text-[var(--t-ink-muted)]">Best streak</span>
        </div>
        <div className="flex flex-col">
          <span
            className="text-[18px] font-bold"
            style={{ fontFamily: 'var(--t-font-heading)' }}
          >
            {habit.weeklyRate}%
          </span>
          <span className="text-[10px] text-[var(--t-ink-muted)]">This week</span>
        </div>
      </div>

      {/* Reminder line */}
      <div className="flex items-center gap-[6px] text-[11px] text-[var(--t-ink-secondary)]">
        <Bell size={13} />
        Reminder · {habit.reminderTime || 'No time set'}
      </div>

      {/* Heatmap */}
      <div
        className="grid gap-[2px]"
        style={{
          gridAutoFlow: 'column',
          gridTemplateRows: 'repeat(7, 9px)',
        }}
      >
        {habit.heatmapCells.map((cell, idx) => (
          <div
            key={idx}
            className="w-[9px] h-[9px]"
            style={{
              background: cell.bg,
              border: `1px solid ${cell.border}`,
            }}
          />
        ))}
      </div>

      {/* Done button */}
      <button
        onClick={() => toggleTodo(habit.todo.id, fmt(new Date()))}
        className={`border border-[var(--t-accent)] px-[var(--space-12)] py-[var(--space-8)] text-[12px] font-bold transition-colors ${
          habit.doneToday
            ? 'bg-[var(--t-accent)] text-white hover:bg-[var(--t-accent-hover)]'
            : 'bg-white text-[var(--t-accent)] hover:bg-[var(--t-accent-tint)]'
        }`}
        style={{ fontFamily: 'var(--t-font-body)' }}
      >
        {habit.doneToday ? 'Completed today' : 'Mark as done'}
      </button>
    </div>
  );
}

export default function HabitsView() {
  const { todos } = useApp();
  const today = fmt(new Date());
  const [adding, setAdding] = useState(false);

  // Filter to repeating todos (habits)
  const habits: HabitData[] = todos
    .filter(t => isRepeating(t))
    .map(todo => {
      const history = getHabitHistory(todo, HISTORY_LEN);
      const { current, best } = computeStreaks(history);
      const last7 = history.slice(-7);
      const weeklyRate = Math.round(
        (last7.reduce((a, b) => a + b, 0) / 7) * 100
      );
      const doneToday = !!todo.completions[today];
      const color = colorHex(todo.colorKey);

      const heatmapCells = history.map(d => ({
        bg: d ? color : 'var(--t-subtle)',
        border: d ? color : 'var(--t-border)',
      }));

      return {
        todo,
        currentStreak: current,
        bestStreak: best,
        weeklyRate,
        history,
        heatmapCells,
        doneToday,
        reminderTime: todo.time || 'No time set',
      };
    });

  // Calculate overall stats
  const todayDoneCount = habits.filter(h => h.doneToday).length;
  const bestOverallStreak = habits.length > 0 ? Math.max(...habits.map(h => h.currentStreak)) : 0;

  let weekSum = 0;
  for (const h of habits) {
    const last7 = h.history.slice(-7);
    weekSum += last7.reduce((a, b) => a + b, 0);
  }
  const weeklyRateOverall =
    habits.length > 0 ? Math.round((weekSum / (habits.length * 7)) * 100) : 0;


  return (
    // `flex-1 min-w-0` + a white ground: this is the design's `.main-column`,
    // and as a bare child of the shell's flex row it would otherwise size to
    // its content and let the page grey show through.
    <div className="flex-1 min-w-0 flex flex-col bg-surface overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-[2px] px-[var(--space-24)] py-[var(--space-16)] border-b border-[var(--t-border)]">
        <h1
          className="text-[18px] font-bold text-[var(--t-ink)]"
          style={{ fontFamily: 'var(--t-font-heading)' }}
        >
          Habits
        </h1>
        <p className="text-[12px] text-[var(--t-ink-muted)]">
          Build consistency, one day at a time.
        </p>
      </div>

      {/* Body - scrollable */}
      <div className="flex-1 overflow-y-auto px-[var(--space-24)] py-[var(--space-24)]">
        {/* Stats row */}
        <div className="flex flex-col md:flex-row gap-[var(--space-16)] mb-[var(--space-20)]">
          <StatCard value={`${todayDoneCount}/${habits.length}`} label="Completed today" />
          <StatCard value={bestOverallStreak} label="Longest active streak" />
          <StatCard value={`${weeklyRateOverall}%`} label="Weekly completion rate" />
        </div>

        {/* Week chart */}
        {habits.length > 0 && <WeekChart habits={habits} />}

        {/* Habits grid */}
        {habits.length > 0 ? (
          <div
            className="grid gap-[var(--space-16)]"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            }}
          >
            {habits.map(h => (
              <HabitCard key={h.todo.id} habit={h} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--t-ink-muted)]">
            <p className="text-[14px]">No habits yet.</p>
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setAdding(true)}
        className="add-fab"
        title="Add new habit"
      >
        +
      </button>

      {adding && <AddModal defaultType="habit" onClose={() => setAdding(false)} />}
    </div>
  );
}
