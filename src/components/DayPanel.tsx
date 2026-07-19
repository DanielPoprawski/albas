import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { fmt, longDate, shortDate } from '../dates';
import { isDoneOn, isDueOn, valueOn } from '../habitLogic';
import { occurrencesOn, shortTime } from '../eventLogic';
import { periodsOn, periodProgress, periodStatusLabel } from '../periodLogic';
import TaskItem from './TaskItem';
import AddModal from './AddModal';
import { HABIT_COLORS } from './habitColors';
import type { CalendarEvent, Task } from '../types';

export default function DayPanel() {
  const { selectedDate, tasks, habits, events, periods, toggleHabit, setHabitValue } = useApp();
  const [editing, setEditing] = useState<Task | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  if (!selectedDate) return null;

  const todayStr = fmt(new Date());
  const dayTasks = tasks.filter(t => t.date === selectedDate);
  // Habits due that day, plus any with progress logged on an off day
  const dayHabits = habits.filter(h => isDueOn(h, selectedDate) || valueOn(h, selectedDate) > 0);
  const dayOccs = occurrencesOn(events, selectedDate);
  const dayPeriods = periodsOn(periods, selectedDate);

  return (
    <div className="mb-lg px-xs">
      <h3 className="text-label-md text-primary-fixed-dim mb-md uppercase tracking-wider">
        {longDate(selectedDate)}
      </h3>

      {/* Periods covering the selected day */}
      {dayPeriods.length > 0 && (
        <div className="space-y-xs mb-sm">
          {dayPeriods.map(period => {
            const hex = HABIT_COLORS[period.colorKey].hex;
            const progress = periodProgress(period, habits, todayStr);
            return (
              <div key={period.id} className="flex items-center gap-sm p-xs rounded-lg bg-white/5">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                <span className="text-body-sm text-inverse-on-surface min-w-0 truncate">{period.name}</span>
                <span className="text-[9px] text-outline-variant ml-auto flex-shrink-0 whitespace-nowrap">
                  {periodStatusLabel(progress, period, todayStr).toLowerCase()}
                  {progress.habitCompletion !== null && ` · ${Math.round(progress.habitCompletion * 100)}%`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Events on the selected day */}
      {dayOccs.length > 0 && (
        <div className="space-y-xs mb-sm">
          {dayOccs.map(o => {
            const hex = HABIT_COLORS[o.event.colorKey].hex;
            const multiDay = o.startDate !== o.endDate;
            return (
              <button
                key={o.key}
                onClick={() => setEditingEvent(o.event)}
                className="w-full flex items-center gap-sm p-xs rounded-lg hover:bg-white/5 transition-all text-left cursor-pointer"
              >
                <span className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                <span className="text-body-sm text-inverse-on-surface min-w-0 truncate">{o.event.title}</span>
                <span className="text-[9px] text-outline-variant ml-auto flex-shrink-0 whitespace-nowrap">
                  {multiDay
                    ? `${shortDate(o.startDate)} – ${shortDate(o.endDate)}`
                    : o.event.allDay || !o.event.startTime
                      ? 'all day'
                      : `${shortTime(o.event.startTime)}${o.event.endTime ? ` – ${shortTime(o.event.endTime)}` : ''}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Habits due on the selected day */}
      <div className="space-y-xs mb-sm">
        {dayHabits.map(habit => {
          const done = isDoneOn(habit, selectedDate);
          const value = valueOn(habit, selectedDate);
          const hex = HABIT_COLORS[habit.colorKey].hex;
          return (
            <div key={habit.id} className="flex items-center gap-sm p-xs rounded-lg hover:bg-white/5 transition-all">
              <button
                onClick={() => toggleHabit(habit.id, selectedDate)}
                title={done ? 'Mark not done' : 'Mark done'}
                className="h-4 w-4 flex-shrink-0 rounded-full border-2 flex items-center justify-center transition-all"
                style={{ borderColor: hex, backgroundColor: done ? hex : 'transparent' }}
              >
                {done && (
                  <span
                    className="material-symbols-outlined text-white"
                    style={{ fontSize: '11px', fontVariationSettings: "'FILL' 1, 'wght' 700" }}
                  >
                    check
                  </span>
                )}
              </button>

              <span className={`text-body-sm min-w-0 truncate ${done ? 'text-outline-variant' : 'text-inverse-on-surface'}`}>
                {habit.name}
              </span>

              {habit.kind === 'measurable' ? (
                <span className="ml-auto flex items-center gap-xs flex-shrink-0">
                  <button
                    onClick={() => setHabitValue(habit.id, selectedDate, Math.max(0, value - 1))}
                    className="w-5 h-5 flex items-center justify-center rounded bg-white/10 hover:bg-white/20 text-outline-variant transition-colors"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>remove</span>
                  </button>
                  <span className="text-[10px] text-outline-variant tabular-nums whitespace-nowrap" style={done ? { color: hex } : undefined}>
                    {value}/{habit.target}{habit.unit ? ` ${habit.unit}` : ''}
                  </span>
                  <button
                    onClick={() => setHabitValue(habit.id, selectedDate, value + 1)}
                    className="w-5 h-5 flex items-center justify-center rounded bg-white/10 hover:bg-white/20 text-outline-variant transition-colors"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>add</span>
                  </button>
                </span>
              ) : (
                <span className="text-[9px] text-outline-variant ml-auto flex-shrink-0">
                  {done ? 'done' : 'due'}
                </span>
              )}
            </div>
          );
        })}
        {dayHabits.length === 0 && habits.length > 0 && (
          <p className="text-[11px] text-outline-variant px-xs">No habits due this day.</p>
        )}
      </div>

      {/* Tasks due on the selected day */}
      <div className="space-y-xs">
        {dayTasks.map(task => (
          <TaskItem key={task.id} task={task} onEdit={setEditing} showDate={false} />
        ))}
        {dayTasks.length === 0 && (
          <p className="text-[11px] text-outline-variant px-xs">No tasks scheduled for this day.</p>
        )}
      </div>

      {editing && <AddModal editTask={editing} onClose={() => setEditing(null)} />}
      {editingEvent && <AddModal editEvent={editingEvent} onClose={() => setEditingEvent(null)} />}
    </div>
  );
}
