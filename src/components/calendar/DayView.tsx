import { useMemo, useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fmt, shortDate } from '../../dates';
import { expandEvents, isBarOccurrence, isLongOccurrence } from '../../eventLogic';
import { isDoneOn, isDueOn, valueOn } from '../../todoLogic';
import { colorHex } from '../../colors';
import AddModal from '../AddModal';
import HourGrid from './HourGrid';
import type { CalendarEvent } from '../../types';

export default function DayView() {
  const { selectedDate, setSelectedDate, todos, events, toggleTodo, firstDayOfWeek } = useApp();
  const [editEvent, setEditEvent] = useState<{ event: CalendarEvent; date: string } | null>(null);

  const todayStr = fmt(new Date());
  const dateStr = selectedDate ?? todayStr;

  const occurrences = useMemo(
    () => expandEvents(events, dateStr, dateStr),
    [events, dateStr]
  );
  const longOccs = occurrences.filter(isLongOccurrence);
  const barOccs = occurrences.filter(o => isBarOccurrence(o) && !isLongOccurrence(o));
  const timedOccs = occurrences.filter(o => !isBarOccurrence(o));

  const dayTodos = todos.filter(t => isDueOn(t, dateStr, firstDayOfWeek) || valueOn(t, dateStr) > 0);
  const hasAllDayContent = longOccs.length > 0 || barOccs.length > 0 || dayTodos.length > 0;

  return (
    <div className="flex-1 min-h-0 rounded-xl border overflow-hidden shadow-2xl flex flex-col border-sheet-border bg-sheet">
      {/* All-day strip */}
      {hasAllDayContent && (
        <div className="border-b flex-shrink-0 px-sm py-sm flex flex-col gap-xs border-sheet-line bg-sheet-header">
          {/* week-plus spans (trips, programs) shown as summary lines */}
          {longOccs.map(o => {
            const hex = colorHex(o.event.colorKey);
            return (
              <button
                key={o.key}
                onClick={() => setEditEvent({ event: o.event, date: o.startDate })}
                className="flex items-center gap-sm cursor-pointer text-left hover:opacity-80"
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                <span className="text-body-sm font-semibold text-sheet-txt">{o.event.title}</span>
                <span className="text-[10px] text-sheet-txt-faint">
                  {shortDate(o.startDate)} – {shortDate(o.endDate)}
                </span>
              </button>
            );
          })}

          <div className="flex flex-wrap gap-xs">
            {barOccs.map(o => {
              const hex = colorHex(o.event.colorKey);
              return (
                <button
                  key={o.key}
                  onClick={() => setEditEvent({ event: o.event, date: o.startDate })}
                  className="text-[11px] font-bold px-sm py-0.5 rounded-full cursor-pointer hover:opacity-90"
                  style={{ backgroundColor: `${hex}cc`, color: '#fff' }}
                >
                  {o.event.title}
                </button>
              );
            })}
            {dayTodos.map(todo => {
              const done = isDoneOn(todo, dateStr);
              const hex = colorHex(todo.colorKey);
              return (
                <button
                  key={todo.id}
                  onClick={() => toggleTodo(todo.id, dateStr)}
                  title={done ? 'Mark not done' : 'Mark done'}
                  className="text-[11px] font-bold px-sm py-0.5 rounded-full cursor-pointer border flex items-center gap-xs"
                  style={{
                    borderColor: hex,
                    backgroundColor: done ? `${hex}26` : 'transparent',
                    color: hex,
                    opacity: done ? 1 : 0.7,
                  }}
                >
                  {done ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                  {todo.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <HourGrid
        days={[dateStr]}
        occurrences={timedOccs}
        onEditEvent={(event, date) => setEditEvent({ event, date })}
        onSelectDate={setSelectedDate}
      />

      {editEvent && <AddModal editEvent={editEvent.event} editEventDate={editEvent.date} onClose={() => setEditEvent(null)} />}
    </div>
  );
}
