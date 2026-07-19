import { useEffect, useRef } from 'react';
import { fmt } from '../../dates';
import { shortTime, timeToMinutes, type Occurrence } from '../../eventLogic';
import { HABIT_COLORS } from '../habitColors';
import type { CalendarEvent } from '../../types';

export const HOUR_H = 48; // px per hour
export const GUTTER_W = 56; // px, time-label column

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
    .filter(o => o.event.startTime)
    .map(o => {
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
    let lane = laneEnds.findIndex(end => end <= item.startMin);
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
  onEditEvent: (event: CalendarEvent) => void;
  onSelectDate?: (dateStr: string) => void;
}

export default function HourGrid({ days, occurrences, onEditEvent, onSelectDate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 7 * HOUR_H });
  }, []);

  const now = new Date();
  const todayStr = fmt(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-hide">
      <div className="flex" style={{ height: 24 * HOUR_H }}>
        {/* Time gutter */}
        <div className="flex-shrink-0 relative" style={{ width: GUTTER_W }}>
          {Array.from({ length: 23 }, (_, i) => i + 1).map(h => (
            <span
              key={h}
              className="absolute right-2 text-[10px] text-outline -translate-y-1/2"
              style={{ top: h * HOUR_H }}
            >
              {hourLabel(h)}
            </span>
          ))}
        </div>

        {/* Day columns */}
        {days.map(dateStr => {
          const positioned = layoutDay(occurrences.filter(o => o.startDate === dateStr));
          const isToday = dateStr === todayStr;
          return (
            <div
              key={dateStr}
              className="flex-1 relative border-l"
              style={{ borderColor: 'rgba(0,0,0,0.06)' }}
              onClick={() => onSelectDate?.(dateStr)}
            >
              {/* hour lines */}
              {Array.from({ length: 23 }, (_, i) => i + 1).map(h => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t"
                  style={{ top: h * HOUR_H, borderColor: 'rgba(0,0,0,0.05)' }}
                />
              ))}

              {/* current time line */}
              {isToday && (
                <div
                  className="absolute left-0 right-0 z-10 pointer-events-none"
                  style={{ top: (nowMin / 60) * HOUR_H }}
                >
                  <div className="h-[2px] bg-tertiary-container" />
                  <div className="w-2 h-2 rounded-full bg-tertiary-container -mt-[5px] -ml-[4px]" />
                </div>
              )}

              {/* timed events */}
              {positioned.map(({ occ, startMin, endMin, lane, lanes }) => {
                const hex = HABIT_COLORS[occ.event.colorKey].hex;
                const height = ((endMin - startMin) / 60) * HOUR_H;
                return (
                  <div
                    key={occ.key}
                    onClick={e => { e.stopPropagation(); onEditEvent(occ.event); }}
                    className="absolute rounded px-xs py-0.5 cursor-pointer overflow-hidden hover:opacity-90"
                    style={{
                      top: (startMin / 60) * HOUR_H,
                      height: height - 2,
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${(1 / lanes) * 100}% - 4px)`,
                      backgroundColor: `${hex}26`,
                      borderLeft: `3px solid ${hex}`,
                    }}
                  >
                    <div className="text-[10px] font-bold truncate" style={{ color: hex }}>
                      {occ.event.title}
                    </div>
                    {height >= 34 && (
                      <div className="text-[9px] opacity-70 truncate" style={{ color: hex }}>
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
