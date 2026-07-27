import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { fmt, rotateWeek, weekdayAt } from '../../dates';
import { isDoneOn, isDueOn, isRepeating, isDone } from '../../todoLogic';
import { expandEvents, isBarOccurrence, isLongOccurrence, shortTime } from '../../eventLogic';
import { colorHex, PILL_BG_ALPHA } from '../../colors';
import AddModal from '../AddModal';
import { assignLanes, weekSegments } from './spans';
import type { CalendarEvent, FirstDayOfWeek, Todo } from '../../types';

export function getCalendarDays(
  month: Date,
  weekStart: FirstDayOfWeek = 1,
): { date: Date; isCurrentMonth: boolean }[] {
  const year = month.getFullYear();
  const m = month.getMonth();

  const firstDay = new Date(year, m, 1);
  const lastDay = new Date(year, m + 1, 0);

  // pad back to the week start, and forward to the last day of that week
  const startOffset = (firstDay.getDay() - weekStart + 7) % 7;
  const endOffset = (weekStart + 6 - lastDay.getDay() + 7) % 7;

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

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/** A phone column is ~50px — three letters plus padding is wider than that. */
const WEEKDAYS_NARROW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const EVENT_LANE_H = 20; // 18px bar + 2px gap
const MAX_BAR_LANES = 3;

/**
 * Day-cell wash for the week-plus spans ("periods") covering it: a flat tint
 * for one, diagonal zig-zag stripes of each color for overlaps.
 */
function periodBackground(hexes: string[]): string | undefined {
  if (hexes.length === 0) return undefined;
  if (hexes.length === 1) return `${hexes[0]}26`;
  const stripe = 9; // px per color band
  const stops = hexes
    .map((hex, i) => `${hex}2e ${i * stripe}px, ${hex}2e ${(i + 1) * stripe}px`)
    .join(', ');
  return `repeating-linear-gradient(135deg, ${stops})`;
}

export default function MonthView({ isMobile = false }: { isMobile?: boolean }) {
  const { currentMonth, selectedDate, setSelectedDate, setCalendarMode, todos, events, firstDayOfWeek } = useApp();
  const [editEvent, setEditEvent] = useState<{ event: CalendarEvent; date: string } | null>(null);
  const [editTodo, setEditTodo] = useState<Todo | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);

  const todayStr = fmt(new Date());
  const days = getCalendarDays(currentMonth, firstDayOfWeek);
  const weeks: { date: Date; isCurrentMonth: boolean }[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const rangeStart = fmt(days[0].date);
  const rangeEnd = fmt(days[days.length - 1].date);
  const occurrences = useMemo(
    () => expandEvents(events, rangeStart, rangeEnd),
    [events, rangeStart, rangeEnd]
  );

  const repeatingTodos = todos.filter(isRepeating);
  const onceTodos = todos.filter(t => !isRepeating(t));

  // A phone cell fits one legible chip; two only truncate each other away.
  const pillCap = isMobile ? 1 : 2;
  const pillClass = isMobile
    ? 'text-[9px] font-bold px-0.5 rounded-sm truncate hover:opacity-80'
    : 'text-[10px] font-bold px-xs py-0.5 rounded truncate hover:opacity-80';
  const pillBorder = isMobile ? '2px' : '3px';

  // One-time to-dos render as pills, so dots represent repeating ones only:
  // filled dot = completed, hollow ring = due but not (yet) done
  function getDateDots(dateStr: string) {
    return repeatingTodos
      .filter(t => isDueOn(t, dateStr, firstDayOfWeek) || isDoneOn(t, dateStr))
      .map(t => ({ hex: colorHex(t.colorKey), done: isDoneOn(t, dateStr) }))
      .slice(0, 4);
  }

  return (
    <div
      className={`flex-1 min-h-0 overflow-hidden flex flex-col bg-sheet ${
        // full bleed on a phone — the grid meets both screen edges
        isMobile ? '' : 'rounded-xl border shadow-2xl border-sheet-border'
      }`}
    >
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b flex-shrink-0 border-sheet-line bg-sheet-header">
        {rotateWeek(isMobile ? WEEKDAYS_NARROW : WEEKDAYS, firstDayOfWeek).map((day, i) => {
          // weekend follows the actual weekday, not the column index — under a
          // Sunday start, columns 5 and 6 are Friday and Saturday
          const dayNum = weekdayAt(i, firstDayOfWeek);
          const isWeekendCol = dayNum === 0 || dayNum === 6;
          return (
            <div
              key={i}
              className={
                isMobile
                  ? 'py-1 text-center text-[9px] font-bold text-sheet-txt-faint'
                  : `py-sm text-center text-label-md font-bold ${
                      isWeekendCol ? 'text-sheet-txt' : 'text-sheet-txt-faint'
                    }`
              }
            >
              {day}
            </div>
          );
        })}
      </div>

      {/* Week rows */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-hide">
        {weeks.map(week => {
          const weekDays = week.map(d => fmt(d.date));

          // week-plus spans (trips, programs — the old periods) tint their day
          // cells instead of taking a lane
          const longOccs = occurrences.filter(isLongOccurrence);

          const barOccs = occurrences.filter(o => isBarOccurrence(o) && !isLongOccurrence(o));
          const allBarLanes = assignLanes(weekSegments(barOccs, weekDays));
          const barLanes = allBarLanes.filter(l => l.lane < MAX_BAR_LANES);
          // bars that didn't fit fall back to pills in their start cell
          const overflowBars = allBarLanes.filter(l => l.lane >= MAX_BAR_LANES).map(l => l.seg.item);
          const nBarLanes = barLanes.length === 0 ? 0 : Math.max(...barLanes.map(l => l.lane)) + 1;

          const barsHeight = nBarLanes * EVENT_LANE_H;

          return (
            <div key={weekDays[0]} className={`flex-1 relative ${isMobile ? 'min-h-[76px]' : 'min-h-[92px]'}`}>
              {/* Day cells */}
              <div className="grid grid-cols-7 h-full">
                {week.map(({ date, isCurrentMonth }) => {
                  const dateStr = fmt(date);
                  const isToday = dateStr === todayStr;
                  const isSelected = dateStr === selectedDate;
                  const dots = getDateDots(dateStr);
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const dayOnce = onceTodos.filter(t => isDueOn(t, dateStr, firstDayOfWeek));
                  // timed single-day events + bars that overflowed the lane cap
                  const dayPillOccs = occurrences.filter(
                    o => o.startDate === dateStr &&
                      (!isBarOccurrence(o) || overflowBars.some(b => b.key === o.key))
                  );
                  // One cap across both kinds, so the "+N" count is honest
                  const shownOccs = dayPillOccs.slice(0, pillCap);
                  const shownOnce = dayOnce.slice(0, Math.max(0, pillCap - shownOccs.length));
                  const hiddenCount =
                    dayPillOccs.length + dayOnce.length - shownOccs.length - shownOnce.length;

                  const cellLongs = longOccs.filter(o => o.startDate <= dateStr && o.endDate >= dateStr);
                  const background = periodBackground(cellLongs.map(o => colorHex(o.event.colorKey)));
                  const longStarts = cellLongs.filter(o => o.startDate === dateStr);
                  const longEnds = cellLongs.filter(o => o.endDate === dateStr);

                  return (
                    <div
                      key={dateStr}
                      className={`calendar-cell relative cursor-pointer ${isMobile ? 'p-0.5' : 'p-sm'} ${!isCurrentMonth ? 'opacity-30' : ''} ${isSelected && !isToday && !background ? 'bg-primary/10' : ''}`}
                      style={{ background }}
                      // A phone tile is too small to be a useful agenda, so
                      // tapping drills into that day. Desktop has the room, so
                      // clicking there goes straight to "add on this date".
                      onClick={() => {
                        setSelectedDate(dateStr);
                        if (isMobile) setCalendarMode('day');
                        else setAddDate(dateStr);
                      }}
                    >
                      {/* half-border corner brackets marking period start/end days */}
                      {longStarts.map(o => (
                        <span key={`s-${o.key}`} className="pointer-events-none">
                          <span
                            className="absolute top-0 left-0 w-2 h-2"
                            style={{ borderTop: `2px solid ${colorHex(o.event.colorKey)}`, borderLeft: `2px solid ${colorHex(o.event.colorKey)}` }}
                          />
                          <span
                            className="absolute bottom-0 left-0 w-2 h-2"
                            style={{ borderBottom: `2px solid ${colorHex(o.event.colorKey)}`, borderLeft: `2px solid ${colorHex(o.event.colorKey)}` }}
                          />
                        </span>
                      ))}
                      {longEnds.map(o => (
                        <span key={`e-${o.key}`} className="pointer-events-none">
                          <span
                            className="absolute top-0 right-0 w-2 h-2"
                            style={{ borderTop: `2px solid ${colorHex(o.event.colorKey)}`, borderRight: `2px solid ${colorHex(o.event.colorKey)}` }}
                          />
                          <span
                            className="absolute bottom-0 right-0 w-2 h-2"
                            style={{ borderBottom: `2px solid ${colorHex(o.event.colorKey)}`, borderRight: `2px solid ${colorHex(o.event.colorKey)}` }}
                          />
                        </span>
                      ))}
                      <div className="flex items-start justify-between">
                        {isToday ? (
                          // flex-none: as a flex child it would otherwise
                          // stretch and render as a pill rather than a circle
                          <span
                            className={`flex-none flex items-center justify-center bg-primary text-on-primary rounded-full font-bold shadow-lg ${
                              isMobile ? 'w-6 h-6 text-[11px]' : 'w-7 h-7 text-body-sm'
                            }`}
                          >
                            {date.getDate()}
                          </span>
                        ) : (
                          <span
                            className={`${isMobile ? 'text-[11px] px-0.5' : 'text-body-sm'} ${
                              isWeekend ? 'font-bold text-sheet-txt' : 'text-sheet-txt-muted'
                            }`}
                          >
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

                      {/* period name, shown once on its start day */}
                      {longStarts.map(o => (
                        <div
                          key={`t-${o.key}`}
                          onClick={e => { e.stopPropagation(); setEditEvent({ event: o.event, date: o.startDate }); }}
                          className="text-[9px] font-bold uppercase tracking-wide truncate hover:opacity-70"
                          style={{ color: colorHex(o.event.colorKey) }}
                        >
                          {o.event.title}
                        </div>
                      ))}

                      {/* space reserved for the spanning bars overlay */}
                      {barsHeight > 0 && <div style={{ height: barsHeight }} />}

                      {/* Event + one-time to-do pills */}
                      {/* Phone cells are tall enough that bottom-pinned chips
                          float away from their date — group them instead. */}
                      <div className={`flex flex-col gap-0.5 overflow-hidden ${isMobile ? 'mt-0.5' : 'mt-auto'}`}>
                        {shownOccs.map(o => {
                          const hex = colorHex(o.event.colorKey);
                          return (
                            <div
                              key={o.key}
                              onClick={e => { e.stopPropagation(); setEditEvent({ event: o.event, date: o.startDate }); }}
                              className={pillClass}
                              style={{
                                backgroundColor: `${hex}${PILL_BG_ALPHA}`,
                                borderLeft: `${pillBorder} solid ${hex}`,
                                color: hex,
                              }}
                            >
                              {!isMobile && o.event.startTime && !o.event.allDay && (
                                <span className="font-normal opacity-70">{shortTime(o.event.startTime)} </span>
                              )}
                              {o.event.title}
                            </div>
                          );
                        })}
                        {shownOnce.map(todo => {
                          const hex = colorHex(todo.colorKey);
                          return (
                            <div
                              key={todo.id}
                              onClick={e => { e.stopPropagation(); setEditTodo(todo); }}
                              className={`${pillClass} ${isDone(todo) ? 'line-through opacity-50' : ''}`}
                              style={{
                                backgroundColor: `${hex}${PILL_BG_ALPHA}`,
                                borderLeft: `${pillBorder} solid ${hex}`,
                                color: hex,
                              }}
                            >
                              {todo.name}
                            </div>
                          );
                        })}
                        {hiddenCount > 0 && (
                          <div className={`text-[9px] text-sheet-txt-faint ${isMobile ? 'pl-0.5' : 'pl-xs'}`}>
                            +{hiddenCount}{isMobile ? '' : ' more'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Spanning bars overlay: all-day/multi-day event bars */}
              {barsHeight > 0 && (
                <div
                  className="absolute left-0 right-0 grid grid-cols-7 pointer-events-none"
                  // clears the day-number row, which is shorter under p-0.5
                  style={{ top: isMobile ? 22 : 34, gridAutoRows: 'min-content' }}
                >
                  {barLanes.map(({ seg, lane }) => {
                    const hex = colorHex(seg.item.event.colorKey);
                    return (
                      <div
                        key={seg.item.key}
                        onClick={e => { e.stopPropagation(); setEditEvent({ event: seg.item.event, date: seg.item.startDate }); }}
                        className="pointer-events-auto cursor-pointer text-[10px] font-bold px-xs truncate hover:opacity-90"
                        style={{
                          gridColumn: `${seg.startCol} / span ${seg.span}`,
                          gridRow: lane + 1,
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

      {editEvent && <AddModal editEvent={editEvent.event} editEventDate={editEvent.date} onClose={() => setEditEvent(null)} />}
      {editTodo && <AddModal editTodo={editTodo} onClose={() => setEditTodo(null)} />}
      {addDate && <AddModal defaultDate={addDate} defaultType="event" onClose={() => setAddDate(null)} />}
    </div>
  );
}
