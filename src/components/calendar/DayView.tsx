import { useMemo, useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fmt, shortDate } from '../../dates';
import { expandEvents, isBarOccurrence, isLongOccurrence } from '../../eventLogic';
import { isDoneOn, isDueOn, valueOn } from '../../todoLogic';
import { colorHex } from '../../colors';
import { eventTitle, sharedOpacity, sharedTitleAttr } from '../../sharedLogic';
import AddModal from '../AddModal';
import HourGrid from './HourGrid';
import type { CalendarEvent } from '../../types';

export default function DayView() {
  const { selectedDate, setSelectedDate, todos, allEvents, toggleTodo, firstDayOfWeek } = useApp();
  const [editEvent, setEditEvent] = useState<{ event: CalendarEvent; date: string } | null>(null);
  const [addAt, setAddAt] = useState<{ date: string; time: string } | null>(null);
  // Shared events are read-only — every edit path funnels through here.
  const openEvent = (event: CalendarEvent, date: string) => {
    if (event.sharedBy) return;
    setEditEvent({ event, date });
  };

  const todayStr = fmt(new Date());
  const dateStr = selectedDate ?? todayStr;

  const occurrences = useMemo(() => expandEvents(allEvents, dateStr, dateStr), [allEvents, dateStr]);
  const longOccs = occurrences.filter(isLongOccurrence);
  const barOccs = occurrences.filter((o) => isBarOccurrence(o) && !isLongOccurrence(o));
  const timedOccs = occurrences.filter((o) => !isBarOccurrence(o));

  const dayTodos = todos.filter((t) => isDueOn(t, dateStr, firstDayOfWeek) || valueOn(t, dateStr) > 0);
  const hasAllDayContent = longOccs.length > 0 || barOccs.length > 0 || dayTodos.length > 0;

  return (
    <div className="flex-1 min-h-0 border overflow-hidden shadow-modal flex flex-col border-line bg-surface">
      {/* All-day strip */}
      {hasAllDayContent && (
        <div className="border-b flex-shrink-0 px-sm py-sm flex flex-col gap-xs border-line bg-subtle">
          {/* week-plus spans (trips, programs) shown as summary lines */}
          {longOccs.map((o) => {
            const hex = colorHex(o.event.colorKey);
            return (
              <button
                type="button"
                key={o.key}
                onClick={() => openEvent(o.event, o.startDate)}
                title={sharedTitleAttr(o.event)}
                className="flex items-center gap-sm cursor-pointer text-left hover:opacity-80"
                // dynamic: shared events are dimmed
                style={{ opacity: sharedOpacity(o.event) }}
              >
                {/* dynamic: the event's own colour */}
                <span className="w-2 h-2 flex-shrink-0" style={{ backgroundColor: hex }} />
                <span className="text-sm font-semibold text-ink">{eventTitle(o.event)}</span>
                <span className="text-xs text-ink-muted">
                  {shortDate(o.startDate)} – {shortDate(o.endDate)}
                </span>
              </button>
            );
          })}

          <div className="flex flex-wrap gap-xs">
            {barOccs.map((o) => {
              const hex = colorHex(o.event.colorKey);
              return (
                <button
                  type="button"
                  key={o.key}
                  onClick={() => openEvent(o.event, o.startDate)}
                  title={sharedTitleAttr(o.event)}
                  className="text-xs font-bold px-sm py-0.5 cursor-pointer hover:opacity-90"
                  // dynamic: the event's own colour, dimmed when shared
                  style={{ backgroundColor: `${hex}cc`, color: 'var(--t-on-accent)', opacity: sharedOpacity(o.event) }}
                >
                  {eventTitle(o.event)}
                </button>
              );
            })}
            {dayTodos.map((todo) => {
              const done = isDoneOn(todo, dateStr);
              const hex = colorHex(todo.colorKey);
              return (
                <button
                  type="button"
                  key={todo.id}
                  onClick={() => toggleTodo(todo.id, dateStr)}
                  title={done ? 'Mark not done' : 'Mark done'}
                  className="text-xs font-bold px-sm py-0.5 cursor-pointer border flex items-center gap-xs"
                  // dynamic: the to-do's own colour
                  style={{
                    borderColor: hex,
                    backgroundColor: done ? `${hex}26` : 'transparent',
                    color: hex,
                    opacity: done ? 1 : 0.7,
                  }}
                >
                  {done ? <CheckCircle2 size="0.75rem" /> : <Circle size="0.75rem" />}
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
        onEditEvent={openEvent}
        onSelectDate={setSelectedDate}
        onAddAt={(date, time) => setAddAt({ date, time })}
      />

      {editEvent && (
        <AddModal editEvent={editEvent.event} editEventDate={editEvent.date} onClose={() => setEditEvent(null)} />
      )}
      {addAt && (
        <AddModal
          defaultType="event"
          defaultDate={addAt.date}
          defaultStartTime={addAt.time}
          onClose={() => setAddAt(null)}
        />
      )}
    </div>
  );
}
