import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { fmt, parse, rotateWeek, weekOf } from '../../dates';
import { expandEvents, isBarOccurrence, isLongOccurrence } from '../../eventLogic';
import { isDone, isDueOn, isRepeating } from '../../todoLogic';
import { colorHex, PILL_BG_ALPHA } from '../../colors';
import { eventTitle, sharedOpacity, sharedTitleAttr } from '../../sharedDisplay';
import AddModal from '../AddModal';
import HourGrid, { GUTTER_W } from './HourGrid';
import { assignLanes, weekSegments } from './spans';
import type { CalendarEvent, Todo } from '../../types';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export default function WeekView() {
  const { selectedDate, setSelectedDate, todos, events, sharedEvents, firstDayOfWeek } = useApp();
  const [editEvent, setEditEvent] = useState<{ event: CalendarEvent; date: string } | null>(null);
  const [editTodo, setEditTodo] = useState<Todo | null>(null);
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

  const occurrences = useMemo(
    () => expandEvents([...events, ...sharedEvents], weekStart, weekEnd),
    [events, sharedEvents, weekStart, weekEnd]
  );
  const longOccs = occurrences.filter(isLongOccurrence);
  const barOccs = occurrences.filter(o => isBarOccurrence(o) && !isLongOccurrence(o));
  const timedOccs = occurrences.filter(o => !isBarOccurrence(o));

  const longLanes = assignLanes(weekSegments(longOccs, weekDays));
  const nLongLanes = longLanes.length === 0 ? 0 : Math.max(...longLanes.map(l => l.lane)) + 1;
  const eventLanes = assignLanes(weekSegments(barOccs, weekDays));
  const nEventLanes = eventLanes.length === 0 ? 0 : Math.max(...eventLanes.map(l => l.lane)) + 1;
  // to-do chips sit in the single grid row below every bar lane
  const todoRow = nLongLanes + nEventLanes + 1;

  const onceTodos = todos.filter(t => !isRepeating(t));
  const dayOnce = (dateStr: string) => onceTodos.filter(t => isDueOn(t, dateStr, firstDayOfWeek));
  const hasAllDayContent =
    longLanes.length > 0 || eventLanes.length > 0 ||
    onceTodos.some(t => t.dueDate && t.dueDate >= weekStart && t.dueDate <= weekEnd);

  return (
    <div className="flex-1 min-h-0 rounded-xl border overflow-hidden shadow-2xl flex flex-col border-sheet-border bg-sheet">
      {/* Weekday header */}
      <div className="flex border-b flex-shrink-0 border-sheet-line bg-sheet-header">
        <div style={{ width: GUTTER_W }} className="flex-shrink-0" />
        {weekDays.map((dateStr, i) => {
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          // weekend from the real weekday, not the column index
          const dayNum = parse(dateStr).getDay();
          const isWeekend = dayNum === 0 || dayNum === 6;
          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(dateStr)}
              className="flex-1 py-sm flex flex-col items-center gap-0.5 cursor-pointer"
            >
              <span className={`text-[10px] font-bold tracking-wider ${isWeekend ? 'text-sheet-txt' : 'text-sheet-txt-faint'}`}>
                {dayLabels[i]}
              </span>
              <span
                className={`w-7 h-7 flex items-center justify-center rounded-full text-body-sm font-bold ${
                  isToday
                    ? 'bg-primary text-on-primary shadow-lg'
                    : isSelected
                      ? 'bg-primary/15 text-primary'
                      : 'text-sheet-txt-muted'
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
        <div className="flex border-b flex-shrink-0 border-sheet-line">
          <div style={{ width: GUTTER_W }} className="flex-shrink-0 flex items-start justify-end pr-2 pt-1">
            <span className="text-[9px] text-sheet-txt-faint uppercase">all day</span>
          </div>
          <div className="flex-1 grid grid-cols-7 py-1" style={{ gridAutoRows: 'min-content' }}>
            {longLanes.map(({ seg, lane }) => {
              const hex = colorHex(seg.item.event.colorKey);
              return (
                <div
                  key={`l-${seg.item.key}`}
                  title={sharedTitleAttr(seg.item.event) ?? seg.item.event.title}
                  onClick={() => openEvent(seg.item.event, seg.item.startDate)}
                  className="cursor-pointer"
                  style={{
                    gridColumn: `${seg.startCol} / span ${seg.span}`,
                    gridRow: lane + 1,
                    height: 5,
                    marginBottom: 2,
                    marginLeft: seg.startsHere ? 6 : 0,
                    marginRight: seg.endsHere ? 6 : 0,
                    backgroundColor: hex,
                    opacity: 0.65,
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
                  className="cursor-pointer text-[10px] font-bold px-xs truncate hover:opacity-90"
                  style={{
                    gridColumn: `${seg.startCol} / span ${seg.span}`,
                    gridRow: nLongLanes + lane + 1,
                    height: 18,
                    lineHeight: '18px',
                    marginBottom: 2,
                    marginLeft: seg.startsHere ? 4 : 0,
                    marginRight: seg.endsHere ? 4 : 0,
                    backgroundColor: `${hex}cc`,
                    color: '#fff',
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
                  style={{ gridColumn: `${i + 1} / span 1`, gridRow: todoRow }}
                >
                  {dts.slice(0, 3).map(todo => {
                    const hex = colorHex(todo.colorKey);
                    return (
                      <div
                        key={todo.id}
                        onClick={() => setEditTodo(todo)}
                        className={`cursor-pointer text-[10px] font-bold px-xs py-0.5 rounded truncate hover:opacity-80 ${isDone(todo) ? 'line-through opacity-50' : ''}`}
                        style={{
                          backgroundColor: `${hex}${PILL_BG_ALPHA}`,
                          borderLeft: `3px solid ${hex}`,
                          color: hex,
                        }}
                      >
                        {todo.name}
                      </div>
                    );
                  })}
                  {dts.length > 3 && (
                    <div className="text-[9px] text-sheet-txt-faint pl-xs">+{dts.length - 3} more</div>
                  )}
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
      />

      {editEvent && <AddModal editEvent={editEvent.event} editEventDate={editEvent.date} onClose={() => setEditEvent(null)} />}
      {editTodo && <AddModal editTodo={editTodo} onClose={() => setEditTodo(null)} />}
    </div>
  );
}
