import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import { isDoneOn, isDueOn } from '../../habitLogic';
import { expandEvents, isBarOccurrence, shortTime, type Occurrence } from '../../eventLogic';
import { HABIT_COLORS } from '../habitColors';
import AddModal from '../AddModal';
import { assignLanes, weekSegments } from './spans';
import type { CalendarEvent } from '../../types';

export function getCalendarDays(month: Date): { date: Date; isCurrentMonth: boolean }[] {
  const year = month.getFullYear();
  const m = month.getMonth();

  const firstDay = new Date(year, m, 1);
  const lastDay = new Date(year, m + 1, 0);

  // Monday-start offset
  const startOffset = (firstDay.getDay() + 6) % 7;
  const endOffset = (7 - lastDay.getDay()) % 7;

  const start = new Date(firstDay);
  start.setDate(start.getDate() - startOffset);
  const end = new Date(lastDay);
  end.setDate(end.getDate() + endOffset);

  const days: { date: Date; isCurrentMonth: boolean }[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push({ date: new Date(cur), isCurrentMonth: cur.getMonth() === m });
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const PERIOD_LANE_H = 7;  // 5px bar + 2px gap
const EVENT_LANE_H = 20;  // 18px bar + 2px gap
const MAX_BAR_LANES = 3;

export default function MonthView() {
  const { currentMonth, selectedDate, setSelectedDate, tasks, habits, events, periods } = useApp();
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);

  const todayStr = fmt(new Date());
  const days = getCalendarDays(currentMonth);
  const weeks: { date: Date; isCurrentMonth: boolean }[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const rangeStart = fmt(days[0].date);
  const rangeEnd = fmt(days[days.length - 1].date);
  const occurrences = useMemo(
    () => expandEvents(events, rangeStart, rangeEnd),
    [events, rangeStart, rangeEnd]
  );

  // Tasks render as pills, so dots represent habits only:
  // filled dot = completed, hollow ring = due but not (yet) done
  function getDateDots(dateStr: string) {
    return habits
      .filter(h => isDueOn(h, dateStr) || isDoneOn(h, dateStr))
      .map(h => ({ hex: HABIT_COLORS[h.colorKey].hex, done: isDoneOn(h, dateStr) }))
      .slice(0, 4);
  }

  return (
    <div className="flex-1 rounded-xl border overflow-hidden shadow-2xl flex flex-col" style={{ borderColor: 'rgba(195,198,215,0.2)', backgroundColor: '#f8f9ff' }}>
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b flex-shrink-0" style={{ borderColor: 'rgba(195,198,215,0.3)', backgroundColor: 'rgba(229,238,255,0.5)' }}>
        {WEEKDAYS.map((day, i) => (
          <div
            key={day}
            className={`py-sm text-center text-label-md font-bold ${
              i >= 5 ? 'text-on-surface' : 'text-outline'
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div className="flex-1 flex flex-col overflow-y-auto scrollbar-hide">
        {weeks.map(week => {
          const weekDays = week.map(d => fmt(d.date));

          const periodLanes = assignLanes(weekSegments(periods, week.length === 7 ? weekDays : weekDays));
          const nPeriodLanes = periodLanes.length === 0 ? 0 : Math.max(...periodLanes.map(l => l.lane)) + 1;

          const barOccs = occurrences.filter(isBarOccurrence);
          const allBarLanes = assignLanes(weekSegments(barOccs, weekDays));
          const barLanes = allBarLanes.filter(l => l.lane < MAX_BAR_LANES);
          // bars that didn't fit fall back to pills in their start cell
          const overflowBars = allBarLanes.filter(l => l.lane >= MAX_BAR_LANES).map(l => l.seg.item);
          const nBarLanes = barLanes.length === 0 ? 0 : Math.max(...barLanes.map(l => l.lane)) + 1;

          const barsHeight = nPeriodLanes * PERIOD_LANE_H + nBarLanes * EVENT_LANE_H;

          return (
            <div key={weekDays[0]} className="flex-1 relative min-h-[92px]">
              {/* Day cells */}
              <div className="grid grid-cols-7 h-full">
                {week.map(({ date, isCurrentMonth }) => {
                  const dateStr = fmt(date);
                  const isToday = dateStr === todayStr;
                  const isSelected = dateStr === selectedDate;
                  const dots = getDateDots(dateStr);
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const dayTasks = tasks.filter(t => t.date === dateStr);
                  // timed single-day events + bars that overflowed the lane cap
                  const dayPillOccs = occurrences.filter(
                    o => o.startDate === dateStr &&
                      (!isBarOccurrence(o) || overflowBars.some(b => b.key === o.key))
                  );
                  const pillCount = dayPillOccs.length + dayTasks.length;

                  return (
                    <div
                      key={dateStr}
                      className={`calendar-cell p-sm cursor-pointer ${!isCurrentMonth ? 'opacity-30' : ''} ${isSelected && !isToday ? 'bg-blue-50' : ''}`}
                      onClick={() => setSelectedDate(dateStr)}
                    >
                      <div className="flex items-start justify-between">
                        {isToday ? (
                          <span className="w-7 h-7 flex items-center justify-center bg-primary text-white rounded-full font-bold text-body-sm shadow-lg">
                            {date.getDate()}
                          </span>
                        ) : (
                          <span className={`text-body-sm ${isWeekend ? 'font-bold text-on-surface' : 'text-on-surface-variant'}`}>
                            {date.getDate()}
                          </span>
                        )}
                        {dots.length > 0 && (
                          <div className="flex gap-0.5 mt-0.5">
                            {dots.map((dot, i) => (
                              <div
                                key={i}
                                className="w-1.5 h-1.5 rounded-full"
                                style={dot.done
                                  ? { backgroundColor: dot.hex }
                                  : { border: `1.5px solid ${dot.hex}`, opacity: 0.55 }}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* space reserved for the spanning bars overlay */}
                      {barsHeight > 0 && <div style={{ height: barsHeight }} />}

                      {/* Event + task pills */}
                      <div className="mt-auto flex flex-col gap-0.5 overflow-hidden">
                        {dayPillOccs.slice(0, 2).map(o => {
                          const hex = HABIT_COLORS[o.event.colorKey].hex;
                          return (
                            <div
                              key={o.key}
                              onClick={e => { e.stopPropagation(); setEditEvent(o.event); }}
                              className="text-[10px] font-bold px-xs py-0.5 rounded truncate hover:opacity-80"
                              style={{
                                backgroundColor: `${hex}1a`,
                                borderLeft: `3px solid ${hex}`,
                                color: hex,
                              }}
                            >
                              {o.event.startTime && !o.event.allDay && (
                                <span className="font-normal opacity-70">{shortTime(o.event.startTime)} </span>
                              )}
                              {o.event.title}
                            </div>
                          );
                        })}
                        {dayTasks.slice(0, Math.max(0, 2 - dayPillOccs.length)).map(task => (
                          <div
                            key={task.id}
                            className="text-[10px] font-bold px-xs py-0.5 rounded truncate"
                            style={{
                              backgroundColor: 'rgba(0,74,198,0.1)',
                              borderLeft: '3px solid #004ac6',
                              color: '#003ea8',
                            }}
                          >
                            {task.title}
                          </div>
                        ))}
                        {pillCount > 2 && (
                          <div className="text-[9px] text-outline pl-xs">+{pillCount - 2} more</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Spanning bars overlay: period lanes on top, then all-day/multi-day event bars */}
              {barsHeight > 0 && (
                <div
                  className="absolute left-0 right-0 grid grid-cols-7 pointer-events-none"
                  style={{ top: 34, gridAutoRows: 'min-content' }}
                >
                  {periodLanes.map(({ seg, lane }) => {
                    const hex = HABIT_COLORS[seg.item.colorKey].hex;
                    return (
                      <div
                        key={`p-${seg.item.id}`}
                        title={seg.item.name}
                        className="pointer-events-auto cursor-pointer"
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
                  {barLanes.map(({ seg, lane }) => {
                    const hex = HABIT_COLORS[seg.item.event.colorKey].hex;
                    return (
                      <div
                        key={seg.item.key}
                        onClick={e => { e.stopPropagation(); setEditEvent(seg.item.event); }}
                        className="pointer-events-auto cursor-pointer text-[10px] font-bold px-xs truncate hover:opacity-90"
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
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editEvent && <AddModal editEvent={editEvent} onClose={() => setEditEvent(null)} />}
    </div>
  );
}
