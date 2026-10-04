import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from '../ui/icon';
import { cn } from '@/lib/utils';
import { COLOR_CLASSES } from '../../colors';
import { useApp } from '../../context/AppContext';
import { repeatLabel } from '../../seedLogic';
import type { RowClickResult } from '../bulk/useListSelection';
import { Dot, Tag } from '../ui/tag';
import HabitStrip from './HabitStrip';
import { fallbackLabel, type HabitData, ROUTINE_OPTIONS } from './habitModel';

const STAT_LABELS: [keyof Pick<HabitData, 'currentStreak' | 'bestStreak' | 'weeklyRate'>, string, string][] = [
  ['currentStreak', 'Streak', ''],
  ['bestStreak', 'Best', ''],
  ['weeklyRate', 'Week', '%'],
];

/**
 * One habit as a list row: a drag handle, today's check, identity, the last
 * four weeks as a strip, three numbers, and the chevron that opens its
 * drawer (`children`, rendered under the row so it moves with it). Below
 * `wide` (1100px) the stats and tag go so the name keeps its room; on a
 * phone the strip wraps onto its own line. Must sit in a `SortableContext`.
 */
export default function HabitRow({
  habit,
  today,
  open,
  onToggleOpen,
  selected = false,
  onRowClick,
  onContextMenu,
  draggable = true,
  children,
}: {
  habit: HabitData;
  today: string;
  open: boolean;
  onToggleOpen: () => void;
  selected?: boolean;
  /** Ctrl/Shift selection; a `'plain'` result means the click should open the drawer instead. */
  onRowClick?: (e: React.MouseEvent) => RowClickResult;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Show the drag handle (pointless with a single habit). */
  draggable?: boolean;
  /** The open drawer. */
  children?: ReactNode;
}) {
  const { toggleDone, firstDayOfWeek, colorOf, iconOf } = useApp();
  const { seed } = habit;
  const color = colorOf(seed);
  const icon = iconOf(seed);
  const routine = ROUTINE_OPTIONS.find((o) => o.value === seed.routine);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: seed.id,
  });

  const handleClick = (e: React.MouseEvent) => {
    const result = onRowClick ? onRowClick(e) : 'plain';
    if (result === 'plain') onToggleOpen();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleOpen();
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={cn('bg-surface', isDragging && 'relative z-10 shadow-card opacity-90')}
      // dynamic: dnd-kit's live drag offset
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        data-open={open || undefined}
        data-selected={selected || undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={onContextMenu}
        className={cn(
          'flex items-center gap-5 px-3 py-[0.875rem] cursor-pointer transition-colors duration-150 hover:bg-surface-hover data-[open]:bg-surface-hover max-md:flex-wrap',
          selected && 'bg-accent/10 data-[open]:bg-accent/15 ring-1 ring-inset ring-accent/30 border-l-2 border-accent',
        )}
      >
        {draggable && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            aria-label="Drag to reorder"
            title="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
            className="-ml-1 -mr-3 shrink-0 touch-none cursor-grab text-ink-muted hover:text-ink active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <Icon name="drag_indicator" size="0.875rem" />
          </button>
        )}
        <button
          type="button"
          aria-pressed={habit.doneToday}
          title={habit.doneToday ? 'Completed today — click to undo' : 'Mark as done'}
          onClick={(e) => {
            e.stopPropagation();
            toggleDone(seed.id, today);
          }}
          className={cn(
            'group size-[1.375rem] shrink-0 flex items-center justify-center border border-accent transition-colors',
            habit.doneToday
              ? 'bg-accent text-on-accent hover:bg-accent-hover'
              : 'bg-surface text-accent hover:bg-accent-tint',
          )}
        >
          <Icon
            name="check"
            size="0.8125rem"
            className={cn('transition-opacity', habit.doneToday ? 'opacity-100' : 'opacity-0 group-hover:opacity-35')}
          />
        </button>

        <div className="flex flex-col gap-1 min-w-0 min-w-[12rem] max-w-[24rem]">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon ? (
              <Icon name={icon} size="0.875rem" className={COLOR_CLASSES[color].text} />
            ) : (
              <Dot color={color} size={10} />
            )}
            <span className="font-heading text-sm font-bold text-ink truncate">{seed.title}</span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden max-wide:hidden">
            <Tag color={color} className="shrink-0">
              {routine?.label ?? fallbackLabel(seed)}
            </Tag>
            <Tag className="shrink-0">{repeatLabel(seed, firstDayOfWeek)}</Tag>
            {seed.reminders.length > 0 && (
              <span className="flex items-center gap-1 text-meta text-ink-muted whitespace-nowrap">
                <Icon name="notifications" size="0.75rem" aria-label="Reminder" />
                {seed.time ?? 'due days'}
              </span>
            )}
          </div>
        </div>

        <HabitStrip
          seed={seed}
          cells={habit.strip}
          color={color}
          today={today}
          cellClass="size-[1rem]"
          className="flex-1 min-w-0 items-start max-md:basis-full max-md:order-last"
        />

        <div className="flex gap-3.5 w-[11.875rem] shrink-0 max-wide:hidden">
          {STAT_LABELS.map(([key, label, suffix]) => (
            <div key={key} className="flex flex-col">
              <span className="font-heading text-[1rem] font-bold leading-[1.1] text-ink tabular-nums">
                {habit[key]}
                {suffix}
              </span>
              <span className="text-[0.625rem] text-ink-muted">{label}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Hide details' : 'Show details'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleOpen();
          }}
          className="size-7 shrink-0 flex items-center justify-center border border-transparent text-ink-muted transition-colors hover:text-ink hover:border-line hover:bg-subtle"
        >
          <Icon
            name="expand_more"
            size="0.875rem"
            className={cn('transition-transform duration-200', open && 'rotate-180')}
          />
        </button>
      </div>
      {children}
    </div>
  );
}
