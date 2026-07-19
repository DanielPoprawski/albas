import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import { expandEvents, isBarOccurrence } from '../../eventLogic';
import { isDoneOn, isDueOn, valueOn } from '../../habitLogic';
import { periodsOn, periodProgress, periodStatusLabel } from '../../periodLogic';
import { HABIT_COLORS } from '../habitColors';
import AddModal from '../AddModal';
import HourGrid from './HourGrid';
import type { CalendarEvent } from '../../types';

export default function DayView() {
  const { selectedDate, tasks, habits, events, periods, toggleTask, toggleHabit } = useApp();
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);

  const todayStr = fmt(new Date());
  const dateStr = selectedDate ?? todayStr;

  const occurrences = useMemo(
    () => expandEvents(events, dateStr, dateStr),
    [events, dateStr]
  );
  const barOccs = occurrences.filter(isBarOccurrence);
  const timedOccs = occurrences.filter(o => !isBarOccurrence(o));

  const dayTasks = tasks.filter(t => t.date === dateStr);
  const dayHabits = habits.filter(h => isDueOn(h, dateStr) || valueOn(h, dateStr) > 0);
  const dayPeriods = periodsOn(periods, dateStr);
  const hasAllDayContent =
    barOccs.length > 0 || dayTasks.length > 0 || dayHabits.length > 0 || dayPeriods.length > 0;

  return (
    <div className="flex-1 rounded-xl border overflow-hidden shadow-2xl flex flex-col" style={{ borderColor: 'rgba(195,198,215,0.2)', backgroundColor: '#f8f9ff' }}>
      {/* All-day strip */}
      {hasAllDayContent && (
        <div className="border-b flex-shrink-0 px-sm py-sm flex flex-col gap-xs" style={{ borderColor: 'rgba(195,198,215,0.3)', backgroundColor: 'rgba(229,238,255,0.5)' }}>
          {dayPeriods.map(period => {
            const hex = HABIT_COLORS[period.colorKey].hex;
            const progress = periodProgress(period, habits, todayStr);
            return (
              <div key={period.id} className="flex items-center gap-sm">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                <span className="text-body-sm font-semibold text-on-surface">{period.name}</span>
                <span className="text-[10px] text-outline">
                  {periodStatusLabel(progress, period, todayStr)}
                  {progress.habitCompletion !== null && ` · ${Math.round(progress.habitCompletion * 100)}%`}
                </span>
              </div>
            );
          })}

          <div className="flex flex-wrap gap-xs">
            {barOccs.map(o => {
              const hex = HABIT_COLORS[o.event.colorKey].hex;
              return (
                <button
                  key={o.key}
                  onClick={() => setEditEvent(o.event)}
                  className="text-[11px] font-bold px-sm py-0.5 rounded-full cursor-pointer hover:opacity-90"
                  style={{ backgroundColor: `${hex}cc`, color: '#fff' }}
                >
                  {o.event.title}
                </button>
              );
            })}
            {dayTasks.map(task => (
              <button
                key={task.id}
                onClick={() => toggleTask(task.id)}
                title={task.completed ? 'Mark incomplete' : 'Mark complete'}
                className={`text-[11px] font-bold px-sm py-0.5 rounded-full cursor-pointer border ${task.completed ? 'line-through opacity-50' : ''}`}
                style={{
                  backgroundColor: 'rgba(0,74,198,0.1)',
                  borderColor: '#004ac6',
                  color: '#003ea8',
                }}
              >
                {task.title}
              </button>
            ))}
            {dayHabits.map(habit => {
              const done = isDoneOn(habit, dateStr);
              const hex = HABIT_COLORS[habit.colorKey].hex;
              return (
                <button
                  key={habit.id}
                  onClick={() => toggleHabit(habit.id, dateStr)}
                  title={done ? 'Mark not done' : 'Mark done'}
                  className="text-[11px] font-bold px-sm py-0.5 rounded-full cursor-pointer border flex items-center gap-xs"
                  style={{
                    borderColor: hex,
                    backgroundColor: done ? `${hex}26` : 'transparent',
                    color: hex,
                    opacity: done ? 1 : 0.7,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '12px', fontVariationSettings: done ? "'FILL' 1" : undefined }}>
                    {done ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  {habit.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <HourGrid
        days={[dateStr]}
        occurrences={timedOccs}
        onEditEvent={setEditEvent}
      />

      {editEvent && <AddModal editEvent={editEvent} onClose={() => setEditEvent(null)} />}
    </div>
  );
}
