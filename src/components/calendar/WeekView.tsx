import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { fmt, parse, weekOf } from '../../dates';
import { expandEvents, isBarOccurrence } from '../../eventLogic';
import { HABIT_COLORS } from '../habitColors';
import AddModal from '../AddModal';
import HourGrid, { GUTTER_W } from './HourGrid';
import { assignLanes, weekSegments } from './spans';
import type { CalendarEvent } from '../../types';

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export default function WeekView() {
  const { selectedDate, setSelectedDate, tasks, events, periods } = useApp();
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);

  const todayStr = fmt(new Date());
  const anchor = selectedDate ?? todayStr;
  const weekDays = weekOf(parse(anchor));
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];

  const occurrences = useMemo(
    () => expandEvents(events, weekStart, weekEnd),
    [events, weekStart, weekEnd]
  );
  const barOccs = occurrences.filter(isBarOccurrence);
  const timedOccs = occurrences.filter(o => !isBarOccurrence(o));

  const periodLanes = assignLanes(weekSegments(periods, weekDays));
  const nPeriodLanes = periodLanes.length === 0 ? 0 : Math.max(...periodLanes.map(l => l.lane)) + 1;
  const eventLanes = assignLanes(weekSegments(barOccs, weekDays));

  const dayTasks = (dateStr: string) => tasks.filter(t => t.date === dateStr);
  const hasAllDayContent = periodLanes.length > 0 || eventLanes.length > 0 || tasks.some(t => t.date && t.date >= weekStart && t.date <= weekEnd);

  return (
    <div className="flex-1 rounded-xl border overflow-hidden shadow-2xl flex flex-col" style={{ borderColor: 'rgba(195,198,215,0.2)', backgroundColor: '#f8f9ff' }}>
      {/* Weekday header */}
      <div className="flex border-b flex-shrink-0" style={{ borderColor: 'rgba(195,198,215,0.3)', backgroundColor: 'rgba(229,238,255,0.5)' }}>
        <div style={{ width: GUTTER_W }} className="flex-shrink-0" />
        {weekDays.map((dateStr, i) => {
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(dateStr)}
              className="flex-1 py-sm flex flex-col items-center gap-0.5 cursor-pointer"
            >
              <span className={`text-[10px] font-bold tracking-wider ${i >= 5 ? 'text-on-surface' : 'text-outline'}`}>
                {DAY_NAMES[i]}
              </span>
              <span
                className={`w-7 h-7 flex items-center justify-center rounded-full text-body-sm font-bold ${
                  isToday
                    ? 'bg-primary text-white shadow-lg'
                    : isSelected
                      ? 'bg-primary/15 text-primary'
                      : 'text-on-surface-variant'
                }`}
              >
                {parse(dateStr).getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* All-day section: period lanes, all-day/multi-day event bars, task chips */}
      {hasAllDayContent && (
        <div className="flex border-b flex-shrink-0" style={{ borderColor: 'rgba(195,198,215,0.3)' }}>
          <div style={{ width: GUTTER_W }} className="flex-shrink-0 flex items-start justify-end pr-2 pt-1">
            <span className="text-[9px] text-outline uppercase">all day</span>
          </div>
          <div className="flex-1 grid grid-cols-7 py-1" style={{ gridAutoRows: 'min-content' }}>
            {periodLanes.map(({ seg, lane }) => {
              const hex = HABIT_COLORS[seg.item.colorKey].hex;
              return (
                <div
                  key={`p-${seg.item.id}`}
                  title={seg.item.name}
                  style={{
                    gridColumn: `${seg.startCol} / span ${seg.span}`,
                    gridRow: lane + 1,
                    height: 5,
                    marginBottom: 2,
                    marginLeft: seg.startsHere ? 6 : 0,
                    marginRight: seg.endsHere ? 6 : 0,
                    borderRadius: seg.startsHere && seg.endsHere ? 9999
                      : seg.startsHere ? '9999px 0 0 9999px'
                      : seg.endsHere ? '0 9999px 9999px 0' : 0,
                    backgroundColor: hex,
                    opacity: 0.65,
                  }}
                />
              );
            })}
            {eventLanes.map(({ seg, lane }) => {
              const hex = HABIT_COLORS[seg.item.event.colorKey].hex;
              return (
                <div
                  key={seg.item.key}
                  onClick={() => setEditEvent(seg.item.event)}
                  className="cursor-pointer text-[10px] font-bold px-xs truncate hover:opacity-90"
                  style={{
                    gridColumn: `${seg.startCol} / span ${seg.span}`,
                    gridRow: nPeriodLanes + lane + 1,
                    height: 18,
                    lineHeight: '18px',
                    marginBottom: 2,
                    marginLeft: seg.startsHere ? 4 : 0,
                    marginRight: seg.endsHere ? 4 : 0,
                    borderRadius: seg.startsHere && seg.endsHere ? 6
                      : seg.startsHere ? '6px 0 0 6px'
                      : seg.endsHere ? '0 6px 6px 0' : 0,
                    backgroundColor: `${hex}cc`,
                    color: '#fff',
                  }}
                >
                  {seg.startsHere ? seg.item.event.title : '…'}
                </div>
              );
            })}
            {/* task chips, one sub-grid row under the bars */}
            {weekDays.map((dateStr, i) => {
              const dts = dayTasks(dateStr);
              if (dts.length === 0) return null;
              return (
                <div
                  key={dateStr}
                  className="flex flex-col gap-0.5 px-0.5"
                  style={{ gridColumn: `${i + 1} / span 1`, gridRow: 90 }}
                >
                  {dts.slice(0, 3).map(task => (
                    <div
                      key={task.id}
                      className={`text-[10px] font-bold px-xs py-0.5 rounded truncate ${task.completed ? 'line-through opacity-50' : ''}`}
                      style={{
                        backgroundColor: 'rgba(0,74,198,0.1)',
                        borderLeft: '3px solid #004ac6',
                        color: '#003ea8',
                      }}
                    >
                      {task.title}
                    </div>
                  ))}
                  {dts.length > 3 && (
                    <div className="text-[9px] text-outline pl-xs">+{dts.length - 3} more</div>
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
        onEditEvent={setEditEvent}
        onSelectDate={setSelectedDate}
      />

      {editEvent && <AddModal editEvent={editEvent} onClose={() => setEditEvent(null)} />}
    </div>
  );
}
