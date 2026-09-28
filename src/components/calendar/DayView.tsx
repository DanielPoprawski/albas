import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { COLOR_CLASSES } from '../../colors';
import { useApp } from '../../context/AppContext';
import { fmt, shortDate } from '../../dates';
import { expandSeeds, type Occurrence } from '../../seedLogic';
import { seedTitle, sharedOpacity, sharedTitleAttr } from '../../sharedLogic';
import type { Seed } from '../../types';
import AddModal from '../AddModal';
import { Icon } from '../ui/icon';
import HourGrid from './HourGrid';
import { occDone, occKind, occToggleDate } from './monthModel';

export default function DayView() {
  const { selectedDate, setSelectedDate, allSeeds, toggleDone, firstDayOfWeek, isVisible, colorOf, iconOf } = useApp();
  const [editing, setEditing] = useState<{ seed: Seed; date: string } | null>(null);
  const [addAt, setAddAt] = useState<{ date: string; time: string } | null>(null);
  // Shared seeds are read-only — every edit path funnels through here.
  const open = (o: Occurrence) => {
    if (o.seed.sharedBy) return;
    setEditing({ seed: o.seed, date: o.startDate });
  };

  const todayStr = fmt(new Date());
  const dateStr = selectedDate ?? todayStr;

  // Unlike the grids, the day has room for habits due today.
  const occurrences = useMemo(
    () =>
      expandSeeds(
        allSeeds.filter((s) => s.date !== null && isVisible(s)),
        dateStr,
        dateStr,
        firstDayOfWeek,
      ),
    [allSeeds, isVisible, dateStr, firstDayOfWeek],
  );
  const longOccs = occurrences.filter((o) => occKind(o) === 'long');
  const barOccs = occurrences.filter((o) => occKind(o) === 'bar');
  const chipOccs = occurrences.filter((o) => occKind(o) === 'chip');
  const timedOccs = occurrences.filter((o) => occKind(o) === 'timed');
  const hasAllDayContent = longOccs.length > 0 || barOccs.length > 0 || chipOccs.length > 0;

  return (
    <div className="flex-1 min-h-0 border overflow-hidden shadow-modal flex flex-col border-line bg-surface">
      {/* All-day strip */}
      {hasAllDayContent && (
        <div className="border-b flex-shrink-0 px-sm py-sm flex flex-col gap-xs border-line bg-subtle">
          {/* week-plus spans (trips, programs) shown as summary lines */}
          {longOccs.map((o) => (
            <button
              type="button"
              key={o.key}
              onClick={() => open(o)}
              title={sharedTitleAttr(o.seed)}
              className="flex items-center gap-sm cursor-pointer text-left hover:opacity-80 hover:shadow-pop"
              // dynamic: shared seeds are dimmed
              style={{ opacity: sharedOpacity(o.seed) }}
            >
              <span className={cn('w-2 h-2 flex-shrink-0', COLOR_CLASSES[colorOf(o.seed)].bg)} />
              <span className="text-sm font-semibold text-ink">{seedTitle(o.seed)}</span>
              <span className="text-xs text-ink-muted">
                {shortDate(o.startDate)} – {shortDate(o.endDate)}
              </span>
            </button>
          ))}

          <div className="flex flex-wrap gap-xs">
            {barOccs.map((o) => (
              <button
                type="button"
                key={o.key}
                onClick={() => open(o)}
                title={sharedTitleAttr(o.seed)}
                className={cn(
                  'text-xs font-bold px-sm py-0.5 cursor-pointer hover:opacity-90 hover:shadow-pop text-on-accent',
                  COLOR_CLASSES[colorOf(o.seed)].bg,
                )}
                // dynamic: dimmed when shared
                style={{ opacity: sharedOpacity(o.seed) }}
              >
                {seedTitle(o.seed)}
              </button>
            ))}
            {chipOccs.map((o) => {
              const c = COLOR_CLASSES[colorOf(o.seed)];
              const icon = iconOf(o.seed);
              const done = occDone(o);
              const own = !o.seed.sharedBy;
              return (
                <button
                  type="button"
                  key={o.key}
                  onClick={() => (own ? toggleDone(o.seed.id, occToggleDate(o, todayStr)) : undefined)}
                  onDoubleClick={() => open(o)}
                  title={own ? (done ? 'Mark not done' : 'Mark done') : sharedTitleAttr(o.seed)}
                  className={cn(
                    'text-xs font-bold px-sm py-0.5 cursor-pointer border border-current flex items-center gap-xs',
                    c.text,
                    done ? c.tint : 'bg-transparent opacity-70',
                  )}
                >
                  <Icon name={done ? 'check_circle' : 'circle'} size="0.75rem" />
                  {icon && <Icon name={icon} size="0.75rem" />}
                  {seedTitle(o.seed)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <HourGrid
        days={[dateStr]}
        occurrences={timedOccs}
        onEdit={open}
        onSelectDate={setSelectedDate}
        onAddAt={(date, time) => setAddAt({ date, time })}
      />

      {editing && <AddModal edit={editing.seed} editDate={editing.date} onClose={() => setEditing(null)} />}
      {addAt && <AddModal defaultDate={addAt.date} defaultTime={addAt.time} onClose={() => setAddAt(null)} />}
    </div>
  );
}
