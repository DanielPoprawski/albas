import { useEffect, useRef, useState } from 'react';
import { fmt } from '../../dates';
import { shortTime, timeToMinutes, type Occurrence } from '../../eventLogic';
import { colorHex } from '../../colors';
import { eventTitle, sharedOpacity, sharedTitleAttr } from '../../sharedLogic';
import type { CalendarEvent } from '../../types';

/** `top`/`height` for a point `min` minutes into the day, in hour-grid units. */
function atMinutes(min: number): string {
  return `calc(var(--spacing-hour-h) * ${min / 60})`;
}

interface Positioned {
  occ: Occurrence;
  startMin: number;
  endMin: number;
  lane: number;
  lanes: number;
}

/** Greedy overlap layout: cluster overlapping events, assign lanes within each cluster. */
function layoutDay(occs: Occurrence[]): Positioned[] {
  const items = occs
    .filter((o) => o.event.startTime)
    .map((o) => {
      const startMin = timeToMinutes(o.event.startTime!);
      const rawEnd = o.event.endTime ? timeToMinutes(o.event.endTime) : startMin + 60;
      return { o, startMin, endMin: Math.min(1440, Math.max(rawEnd, startMin + 30)) };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const out: Positioned[] = [];
  let laneEnds: number[] = [];
  let cluster: { item: (typeof items)[number]; lane: number }[] = [];

  const flush = () => {
    const lanes = laneEnds.length;
    for (const { item, lane } of cluster) {
      out.push({ occ: item.o, startMin: item.startMin, endMin: item.endMin, lane, lanes });
    }
    laneEnds = [];
    cluster = [];
  };

  for (const item of items) {
    if (laneEnds.length > 0 && item.startMin >= Math.max(...laneEnds)) flush();
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = item.endMin;
    cluster.push({ item, lane });
  }
  flush();
  return out;
}

function hourLabel(h: number): string {
  return shortTime(`${String(h).padStart(2, '0')}:00`);
}

interface Props {
  days: string[]; // 1 (day view) or 7 (week view) YYYY-MM-DD strings
  /** Timed single-day occurrences only (bars live in the all-day section). */
  occurrences: Occurrence[];
  onEditEvent: (event: CalendarEvent, occurrenceDate: string) => void;
  onSelectDate?: (dateStr: string) => void;
  /** A click on empty grid: the day and the hour (`HH:00`) under the pointer. */
  onAddAt?: (dateStr: string, time: string) => void;
}

export default function HourGrid({ days, occurrences, onEditEvent, onSelectDate, onAddAt }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Open on 07:00: the grid is 24 equal hours tall, whatever the font scale.
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: (el.scrollHeight * 7) / 24 });
  }, []);

  // The current-time line moves on its own, once a minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const todayStr = fmt(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    // min-h-0 is load-bearing: flex items default to min-height:auto, which would let
    // the 1152px body below dictate this element's height and defeat overflow-y-auto.
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
      <div className="flex h-[calc(var(--spacing-hour-h)*24)]">
        {/* Time gutter */}
        <div className="flex-shrink-0 relative w-gutter-w">
          {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
            <span
              key={h}
              className="absolute right-2 text-xs text-ink-muted -translate-y-1/2"
              // dynamic: one label per hour, positioned in grid units
              style={{ top: atMinutes(h * 60) }}
            >
              {hourLabel(h)}
            </span>
          ))}
        </div>

        {/* Day columns */}
        {days.map((dateStr) => {
          const positioned = layoutDay(occurrences.filter((o) => o.startDate === dateStr));
          const isToday = dateStr === todayStr;
          return (
            <div
              key={dateStr}
              className={`flex-1 relative border-l border-line ${isToday ? 'today-cell' : ''}`}
              onClick={(e) => {
                onSelectDate?.(dateStr);
                if (!onAddAt) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const hour = Math.min(23, Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * 24)));
                onAddAt(dateStr, `${String(hour).padStart(2, '0')}:00`);
              }}
            >
              {/* hour lines */}
              {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-line"
                  // dynamic: one rule per hour, positioned in grid units
                  style={{ top: atMinutes(h * 60) }}
                />
              ))}

              {/* current time line */}
              {isToday && (
                <div
                  className="absolute left-0 right-0 z-10 pointer-events-none"
                  // dynamic: the current wall-clock minute
                  style={{ top: atMinutes(nowMin) }}
                >
                  <div className="h-[2px] bg-danger" />
                  <div className="w-2 h-2 bg-danger -mt-[0.3125rem] -ml-[0.25rem]" />
                </div>
              )}

              {/* timed events */}
              {positioned.map(({ occ, startMin, endMin, lane, lanes }) => {
                const hex = colorHex(occ.event.colorKey);
                const minutes = endMin - startMin;
                return (
                  <div
                    key={occ.key}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditEvent(occ.event, occ.startDate);
                    }}
                    title={sharedTitleAttr(occ.event)}
                    className="absolute rounded px-xs py-0.5 cursor-pointer overflow-hidden hover:opacity-90"
                    // dynamic: the event's own time span, lane, and colour
                    style={{
                      top: atMinutes(startMin),
                      height: `calc(${atMinutes(minutes)} - 0.125rem)`,
                      left: `calc(${(lane / lanes) * 100}% + 0.125rem)`,
                      width: `calc(${(1 / lanes) * 100}% - 0.25rem)`,
                      backgroundColor: `${hex}26`,
                      borderLeft: `0.1875rem solid ${hex}`,
                      opacity: sharedOpacity(occ.event),
                    }}
                  >
                    {/* dynamic: the event's own colour */}
                    <div className="text-xs font-bold truncate" style={{ color: hex }}>
                      {eventTitle(occ.event)}
                    </div>
                    {/* dynamic: the event's own colour */}
                    {minutes >= 45 && (
                      <div className="text-xs opacity-70 truncate" style={{ color: hex }}>
                        {shortTime(occ.event.startTime!)}
                        {occ.event.endTime ? ` – ${shortTime(occ.event.endTime)}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
