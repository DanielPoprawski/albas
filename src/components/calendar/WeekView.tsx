import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { COLOR_CLASSES } from '../../colors';
import { useApp } from '../../context/AppContext';
import { fmt, parse, rotateWeek, weekOf } from '../../dates';
import { expandSeeds, type Occurrence } from '../../seedLogic';
import { seedTitle, sharedOpacity, sharedTitleAttr } from '../../sharedLogic';
import type { Seed } from '../../types';
import AddModal from '../AddModal';
import { Icon } from '../ui/icon';
import HourGrid from './HourGrid';
import { assignLanes, gridSeeds, laneCount, occDone, occKind, occToggleDate, weekSegments } from './monthModel';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export default function WeekView() {
  const { selectedDate, setSelectedDate, allSeeds, firstDayOfWeek, isVisible, colorOf, iconOf, toggleDone } = useApp();
  const [editing, setEditing] = useState<{ seed: Seed; date: string } | null>(null);
  const [addAt, setAddAt] = useState<{ date: string; time: string } | null>(null);
  // Shared seeds are read-only — every edit path funnels through here.
  const open = (o: Occurrence) => {
    if (o.seed.sharedBy) return;
    setEditing({ seed: o.seed, date: o.startDate });
  };

  const todayStr = fmt(new Date());
  const anchor = selectedDate ?? todayStr;
  const weekDays = weekOf(parse(anchor), firstDayOfWeek);
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const dayLabels = rotateWeek(DAY_NAMES, firstDayOfWeek);

  const occurrences = useMemo(
    () => expandSeeds(gridSeeds(allSeeds, isVisible), weekStart, weekEnd, firstDayOfWeek),
    [allSeeds, isVisible, weekStart, weekEnd, firstDayOfWeek],
  );
  const longOccs = occurrences.filter((o) => occKind(o) === 'long');
  const barOccs = occurrences.filter((o) => occKind(o) === 'bar');
  const chipOccs = occurrences.filter((o) => occKind(o) === 'chip');
  const timedOccs = occurrences.filter((o) => occKind(o) === 'timed');

  const longLanes = assignLanes(weekSegments(longOccs, weekDays));
  const nLongLanes = laneCount(longLanes);
  const barLanes = assignLanes(weekSegments(barOccs, weekDays));
  const nBarLanes = laneCount(barLanes);
  // to-do chips sit in the single grid row below every bar lane
  const chipRow = nLongLanes + nBarLanes + 1;

  const hasAllDayContent = longLanes.length > 0 || barLanes.length > 0 || chipOccs.length > 0;

  return (
    <div className="flex-1 min-h-0 border overflow-hidden shadow-modal flex flex-col border-line bg-surface">
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
              type="button"
              key={dateStr}
              onClick={() => setSelectedDate(dateStr)}
              className={`flex-1 py-sm flex flex-col items-center gap-0.5 cursor-pointer ${isPast ? 'bg-past-cell' : ''} ${
                isToday ? 'today-cell' : ''
              }`}
            >
              <span className={`text-xs font-bold tracking-wider ${isWeekend ? 'text-ink' : 'text-ink-muted'}`}>
                {dayLabels[i]}
              </span>
              <span
                className={`w-7 h-7 flex items-center justify-center text-sm font-bold ${
                  isToday
                    ? 'bg-accent text-on-accent shadow-pop'
                    : isSelected
                      ? 'bg-accent/15 text-accent'
                      : 'text-ink-secondary'
                }`}
              >
                {parse(dateStr).getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* All-day section: thin multi-day lanes, all-day bars, to-do chips */}
      {hasAllDayContent && (
        <div className="flex border-b flex-shrink-0 border-line">
          <div className="flex-shrink-0 w-gutter-w flex items-start justify-end pr-2 pt-1">
            <span className="text-xs text-ink-muted uppercase">all day</span>
          </div>
          <div className="flex-1 grid grid-cols-7 auto-rows-min py-1">
            {longLanes.map(({ seg, lane }) => (
              <div
                key={`l-${seg.item.key}`}
                title={sharedTitleAttr(seg.item.seed) ?? seg.item.seed.title}
                onClick={() => open(seg.item)}
                className={cn(
                  'cursor-pointer h-[0.3125rem] mb-0.5 opacity-65',
                  COLOR_CLASSES[colorOf(seg.item.seed)].bg,
                  seg.startsHere && 'ml-1.5',
                  seg.endsHere && 'mr-1.5',
                )}
                // dynamic: grid placement
                style={{ gridColumn: `${seg.startCol} / span ${seg.span}`, gridRow: lane + 1 }}
              />
            ))}
            {barLanes.map(({ seg, lane }) => {
              const icon = seg.startsHere ? iconOf(seg.item.seed) : null;
              return (
                <div
                  key={seg.item.key}
                  onClick={() => open(seg.item)}
                  title={sharedTitleAttr(seg.item.seed)}
                  className={cn(
                    'cursor-pointer flex items-center gap-1 text-xs font-bold px-xs overflow-hidden whitespace-nowrap hover:opacity-90 hover:shadow-pop h-lane-h leading-(--spacing-lane-h) mb-0.5 text-on-accent',
                    COLOR_CLASSES[colorOf(seg.item.seed)].bg,
                    seg.startsHere && 'ml-1',
                    seg.endsHere && 'mr-1',
                  )}
                  // dynamic: grid placement, dimmed when shared
                  style={{
                    gridColumn: `${seg.startCol} / span ${seg.span}`,
                    gridRow: nLongLanes + lane + 1,
                    opacity: sharedOpacity(seg.item.seed),
                  }}
                >
                  {icon && <Icon name={icon} size="0.75rem" />}
                  {seg.startsHere ? seedTitle(seg.item.seed) : '…'}
                </div>
              );
            })}
            {/* to-do chips, one sub-grid row under the bars */}
            {weekDays.map((dateStr, i) => {
              const chips = chipOccs.filter((o) => o.startDate === dateStr);
              if (chips.length === 0) return null;
              return (
                <div
                  key={dateStr}
                  className="flex flex-col gap-0.5 px-0.5"
                  // dynamic: grid placement of the day column
                  style={{ gridColumn: `${i + 1} / span 1`, gridRow: chipRow }}
                >
                  {chips.slice(0, 3).map((o) => {
                    const c = COLOR_CLASSES[colorOf(o.seed)];
                    const icon = iconOf(o.seed);
                    const done = occDone(o);
                    return (
                      <div
                        key={o.key}
                        onClick={() => open(o)}
                        title={sharedTitleAttr(o.seed)}
                        className={cn(
                          'flex items-center gap-1 cursor-pointer text-xs font-bold px-xs py-0.5 overflow-hidden whitespace-nowrap hover:opacity-80 hover:shadow-pop border-l-3 border-current',
                          c.tint,
                          c.text,
                          done && 'line-through opacity-50',
                        )}
                        // dynamic: dimmed when shared
                        style={{ opacity: sharedOpacity(o.seed) }}
                      >
                        {!o.seed.sharedBy && (
                          <Icon
                            name={done ? 'check_box' : 'check_box_outline_blank'}
                            size="0.75rem"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDone(o.seed.id, occToggleDate(o, todayStr));
                            }}
                          />
                        )}
                        {icon && <Icon name={icon} size="0.75rem" />}
                        <span className="min-w-0 truncate">{seedTitle(o.seed)}</span>
                      </div>
                    );
                  })}
                  {chips.length > 3 && <div className="text-xs text-ink-muted pl-xs">+{chips.length - 3} more</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <HourGrid
        days={weekDays}
        occurrences={timedOccs}
        onEdit={open}
        onToggle={(o) => toggleDone(o.seed.id, occToggleDate(o, todayStr))}
        onSelectDate={setSelectedDate}
        onAddAt={(date, time) => setAddAt({ date, time })}
      />

      {editing && <AddModal edit={editing.seed} editDate={editing.date} onClose={() => setEditing(null)} />}
      {addAt && <AddModal defaultDate={addAt.date} defaultTime={addAt.time} onClose={() => setAddAt(null)} />}
    </div>
  );
}
