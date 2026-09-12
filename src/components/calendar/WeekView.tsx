import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { fmt, parse, rotateWeek, weekOf } from '../../dates';
import { expandEvents, isBarOccurrence, isLongOccurrence } from '../../eventLogic';
import { isDone, isDueOn, isRepeating } from '../../todoLogic';
import { colorHex, PILL_BG_ALPHA } from '../../colors';
import { eventTitle, sharedOpacity, sharedTitleAttr } from '../../sharedLogic';
import AddModal from '../AddModal';
import HourGrid from './HourGrid';
import { assignLanes, laneCount, weekSegments } from './monthModel';
import type { CalendarEvent, Todo } from '../../types';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export default function WeekView() {
  const { selectedDate, setSelectedDate, todos, allEvents, firstDayOfWeek } = useApp();
  const [editEvent, setEditEvent] = useState<{ event: CalendarEvent; date: string } | null>(null);
  const [editTodo, setEditTodo] = useState<Todo | null>(null);
  const [addAt, setAddAt] = useState<{ date: string; time: string } | null>(null);
  // Shared events are read-only — every edit path funnels through here.
  const openEvent = (event: CalendarEvent, date: string) => {
    if (event.sharedBy) return;
    setEditEvent({ event, date });
  };

  const todayStr = fmt(new Date());
  const anchor = selectedDate ?? todayStr;
  const weekDays = weekOf(parse(anchor), firstDayOfWeek);
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const dayLabels = rotateWeek(DAY_NAMES, firstDayOfWeek);

  const occurrences = useMemo(() => expandEvents(allEvents, weekStart, weekEnd), [allEvents, weekStart, weekEnd]);
  const longOccs = occurrences.filter(isLongOccurrence);
  const barOccs = occurrences.filter((o) => isBarOccurrence(o) && !isLongOccurrence(o));
  const timedOccs = occurrences.filter((o) => !isBarOccurrence(o));

  const longLanes = assignLanes(weekSegments(longOccs, weekDays));
  const nLongLanes = laneCount(longLanes);
  const eventLanes = assignLanes(weekSegments(barOccs, weekDays));
  const nEventLanes = laneCount(eventLanes);
  // to-do chips sit in the single grid row below every bar lane
  const todoRow = nLongLanes + nEventLanes + 1;

  const onceTodos = todos.filter((t) => !isRepeating(t));
  const dayOnce = (dateStr: string) => onceTodos.filter((t) => isDueOn(t, dateStr, firstDayOfWeek));
  const hasAllDayContent =
    longLanes.length > 0 ||
    eventLanes.length > 0 ||
    onceTodos.some((t) => t.dueDate && t.dueDate >= weekStart && t.dueDate <= weekEnd);

  return (
    <div className="flex-1 min-h-0 rounded-xl border overflow-hidden shadow-2xl flex flex-col border-line bg-surface">
      {/* Weekday header */}
      <div className="flex border-b flex-shrink-0 border-line bg-subtle">
        <div className="flex-shrink-0 w-gutter-w" />
        {weekDays.map((dateStr, i) => {
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          const isPast = dateStr < todayStr;
          // weekend from the real weekday, not the column index
          const dayNum = parse(dateStr).getDay();
          const isWeekend = dayNum === 0 || dayNum === 6;
          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(dateStr)}
              className={`flex-1 py-sm flex flex-col items-center gap-0.5 cursor-pointer ${isPast ? 'bg-past-cell' : ''}`}
            >
              <span className={`text-xs font-bold tracking-wider ${isWeekend ? 'text-ink' : 'text-ink-muted'}`}>
                {dayLabels[i]}
              </span>
              <span
                className={`w-7 h-7 flex items-center justify-center rounded-full text-body-sm font-bold ${
                  isToday
                    ? 'bg-primary text-on-primary shadow-lg'
                    : isSelected
                      ? 'bg-primary/15 text-primary'
                      : 'text-ink-secondary'
                }`}
              >
                {parse(dateStr).getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* All-day section: thin week-plus lanes, all-day/multi-day event bars, to-do chips */}
      {hasAllDayContent && (
        <div className="flex border-b flex-shrink-0 border-line">
          <div className="flex-shrink-0 w-gutter-w flex items-start justify-end pr-2 pt-1">
            <span className="text-xs text-ink-muted uppercase">all day</span>
          </div>
          <div className="flex-1 grid grid-cols-7 auto-rows-min py-1">
            {longLanes.map(({ seg, lane }) => {
              const hex = colorHex(seg.item.event.colorKey);
              return (
                <div
                  key={`l-${seg.item.key}`}
                  title={sharedTitleAttr(seg.item.event) ?? seg.item.event.title}
                  onClick={() => openEvent(seg.item.event, seg.item.startDate)}
                  className={`cursor-pointer h-[0.3125rem] mb-0.5 opacity-65 ${seg.startsHere ? 'ml-1.5' : ''} ${seg.endsHere ? 'mr-1.5' : ''}`}
                  // dynamic: grid placement and the event's own colour
                  style={{
                    gridColumn: `${seg.startCol} / span ${seg.span}`,
                    gridRow: lane + 1,
                    backgroundColor: hex,
                  }}
                />
              );
            })}
            {eventLanes.map(({ seg, lane }) => {
              const hex = colorHex(seg.item.event.colorKey);
              return (
                <div
                  key={seg.item.key}
                  onClick={() => openEvent(seg.item.event, seg.item.startDate)}
                  title={sharedTitleAttr(seg.item.event)}
                  className={`cursor-pointer text-xs font-bold px-xs truncate hover:opacity-90 h-lane-h leading-(--spacing-lane-h) mb-0.5 ${seg.startsHere ? 'ml-1' : ''} ${seg.endsHere ? 'mr-1' : ''}`}
                  // dynamic: grid placement and the event's own colour
                  style={{
                    gridColumn: `${seg.startCol} / span ${seg.span}`,
                    gridRow: nLongLanes + lane + 1,
                    backgroundColor: `${hex}cc`,
                    color: 'var(--t-on-accent)',
                    opacity: sharedOpacity(seg.item.event),
                  }}
                >
                  {seg.startsHere ? eventTitle(seg.item.event) : '…'}
                </div>
              );
            })}
            {/* one-time to-do chips, one sub-grid row under the bars */}
            {weekDays.map((dateStr, i) => {
              const dts = dayOnce(dateStr);
              if (dts.length === 0) return null;
              return (
                <div
                  key={dateStr}
                  className="flex flex-col gap-0.5 px-0.5"
                  // dynamic: grid placement of the day column
                  style={{ gridColumn: `${i + 1} / span 1`, gridRow: todoRow }}
                >
                  {dts.slice(0, 3).map((todo) => {
                    const hex = colorHex(todo.colorKey);
                    return (
                      <div
                        key={todo.id}
                        onClick={() => setEditTodo(todo)}
                        className={`cursor-pointer text-xs font-bold px-xs py-0.5 rounded truncate hover:opacity-80 ${isDone(todo) ? 'line-through opacity-50' : ''}`}
                        // dynamic: the to-do's own colour
                        style={{
                          backgroundColor: `${hex}${PILL_BG_ALPHA}`,
                          borderLeft: `0.1875rem solid ${hex}`,
                          color: hex,
                        }}
                      >
                        {todo.name}
                      </div>
                    );
                  })}
                  {dts.length > 3 && <div className="text-xs text-ink-muted pl-xs">+{dts.length - 3} more</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <HourGrid
        days={weekDays}
        occurrences={timedOccs}
        onEditEvent={openEvent}
        onSelectDate={setSelectedDate}
        onAddAt={(date, time) => setAddAt({ date, time })}
      />

      {editEvent && (
        <AddModal editEvent={editEvent.event} editEventDate={editEvent.date} onClose={() => setEditEvent(null)} />
      )}
      {editTodo && <AddModal editTodo={editTodo} onClose={() => setEditTodo(null)} />}
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
