import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { COLOR_CLASSES } from '../../colors';
import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import { type Occurrence, shortTime, timeToMinutes } from '../../seedLogic';
import { seedTitle, sharedOpacity, sharedTitleAttr } from '../../sharedLogic';
import { Icon } from '../ui/icon';
import { occDone } from './monthModel';

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

/** Greedy overlap layout: cluster overlapping occurrences, assign lanes within each cluster. */
function layoutDay(occs: Occurrence[]): Positioned[] {
  const items = occs
    .filter((o) => o.seed.time)
    .map((o) => {
      const startMin = timeToMinutes(o.seed.time!);
      const rawEnd = o.seed.endTime ? timeToMinutes(o.seed.endTime) : startMin + 60;
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
  /** Timed single-day occurrences only (bars and chips live in the all-day section). */
  occurrences: Occurrence[];
  onEdit: (o: Occurrence) => void;
  /** The checkbox on a doable block. */
  onToggle: (o: Occurrence) => void;
  onSelectDate?: (dateStr: string) => void;
  /** A click on empty grid: the day and the hour (`HH:00`) under the pointer. */
  onAddAt?: (dateStr: string, time: string) => void;
}

export default function HourGrid({ days, occurrences, onEdit, onToggle, onSelectDate, onAddAt }: Props) {
  const { colorOf, iconOf } = useApp();
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

              {/* timed blocks: a tint fill, a mark-coloured left rule and text (via `border-current`) */}
              {positioned.map(({ occ, startMin, endMin, lane, lanes }) => {
                const c = COLOR_CLASSES[colorOf(occ.seed)];
                const icon = iconOf(occ.seed);
                const done = !!occ.seed.track && occDone(occ);
                const minutes = endMin - startMin;
                return (
                  <div
                    key={occ.key}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(occ);
                    }}
                    title={sharedTitleAttr(occ.seed)}
                    className={cn(
                      'absolute px-xs py-0.5 cursor-pointer overflow-hidden hover:opacity-90 hover:shadow-pop border-l-3 border-current',
                      c.tint,
                      c.text,
                    )}
                    // dynamic: the occurrence's own time span and lane, dimmed when shared
                    style={{
                      top: atMinutes(startMin),
                      height: `calc(${atMinutes(minutes)} - 0.125rem)`,
                      left: `calc(${(lane / lanes) * 100}% + 0.125rem)`,
                      width: `calc(${(1 / lanes) * 100}% - 0.25rem)`,
                      opacity: sharedOpacity(occ.seed),
                    }}
                  >
                    <div className="flex items-center gap-1 text-xs font-bold overflow-hidden whitespace-nowrap">
                      {occ.seed.track && !occ.seed.sharedBy && (
                        <Icon
                          name={done ? 'check_box' : 'check_box_outline_blank'}
                          size="0.75rem"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggle(occ);
                          }}
                        />
                      )}
                      {icon && <Icon name={icon} size="0.75rem" />}
                      <span className={cn('min-w-0 truncate', done && 'line-through opacity-50')}>
                        {seedTitle(occ.seed)}
                      </span>
                    </div>
                    {minutes >= 45 && (
                      <div className="text-xs opacity-70 overflow-hidden whitespace-nowrap">
                        {shortTime(occ.seed.time!)}
                        {occ.seed.endTime ? ` – ${shortTime(occ.seed.endTime)}` : ''}
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
