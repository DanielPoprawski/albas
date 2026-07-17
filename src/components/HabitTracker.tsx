import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { fmt, weekOf } from '../dates';
import { isDoneOn, isDueOn, scheduleLabel, streakOf, valueOn } from '../habitLogic';
import AddModal from './AddModal';
import { HABIT_COLORS } from './habitColors';
import type { Habit } from '../types';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function HabitTracker() {
  const { habits, toggleHabit, setHabitValue, deleteHabit } = useApp();
  const [editing, setEditing] = useState<Habit | null>(null);

  const todayStr = fmt(new Date());
  const weekDates = weekOf(new Date());

  function handleCellClick(habit: Habit, date: string) {
    if (habit.kind === 'yesno') {
      toggleHabit(habit.id, date);
    } else {
      // Measurable: each click adds 1; a click at/past target resets to 0
      const v = valueOn(habit, date);
      setHabitValue(habit.id, date, v >= habit.target ? 0 : v + 1);
    }
  }

  return (
    <div className="mb-lg px-xs">
      <h3 className="text-label-md text-outline-variant mb-md uppercase tracking-wider">Habit Tracker</h3>

      <div className="space-y-md">
        {habits.map(habit => {
          const { text, hex } = HABIT_COLORS[habit.colorKey] ?? HABIT_COLORS.primary;
          const streak = streakOf(habit);

          return (
            <div key={habit.id} className="group">
              <div className="flex items-center gap-xs mb-xs">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${text}`} title={scheduleLabel(habit)}>
                  {habit.name}
                </span>
                <span className="text-[9px] text-outline-variant ml-auto">
                  {streak > 0 ? `${streak} day streak` : scheduleLabel(habit)}
                </span>
                <span className="hidden group-hover:flex gap-xs">
                  <button
                    title="Edit habit"
                    onClick={() => setEditing(habit)}
                    className="text-outline-variant hover:text-inverse-on-surface transition-colors"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>edit</span>
                  </button>
                  <button
                    title="Delete habit"
                    onClick={() => deleteHabit(habit.id)}
                    className="text-outline-variant hover:text-tertiary-container transition-colors"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>delete</span>
                  </button>
                </span>
              </div>
              <div className="flex justify-between">
                {weekDates.map((date, i) => {
                  const due = isDueOn(habit, date);
                  const done = isDoneOn(habit, date);
                  const value = valueOn(habit, date);
                  const isToday = date === todayStr;
                  const isFuture = date > todayStr;

                  let content: React.ReactNode;
                  if (done) {
                    content = (
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: '16px', color: hex, fontVariationSettings: "'FILL' 1, 'wght' 700" }}
                      >
                        check
                      </span>
                    );
                  } else if (habit.kind === 'measurable' && value > 0) {
                    content = <span className="text-[10px] font-bold" style={{ color: hex }}>{value}</span>;
                  } else if (!due || isFuture) {
                    content = (
                      <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'rgba(255,255,255,0.12)' }}>
                        {due ? 'radio_button_unchecked' : 'remove'}
                      </span>
                    );
                  } else {
                    content = (
                      <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'rgba(255,255,255,0.2)' }}>
                        close
                      </span>
                    );
                  }

                  return (
                    <button
                      key={date}
                      title={`${habit.name} – ${DAY_LABELS[i]}${due ? '' : ' (not scheduled)'}`}
                      disabled={isFuture}
                      onClick={() => handleCellClick(habit, date)}
                      className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${
                        isToday ? 'ring-1 ring-white/40' : ''
                      } ${isFuture ? 'cursor-default' : 'hover:bg-white/10'}`}
                    >
                      {content}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {habits.length === 0 && (
          <p className="text-[11px] text-outline-variant text-center py-md">No habits yet. Add one!</p>
        )}
      </div>

      {editing && <AddModal editHabit={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
