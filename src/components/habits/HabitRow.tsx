import { Bell, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colorHex } from '../../colors';
import { useApp } from '../../context/AppContext';
import { repeatLabel } from '../../todoLogic';
import type { RowClickResult } from '../bulk/useListSelection';
import { Dot, Tag } from '../ui/tag';
import HabitStrip from './HabitStrip';
import { fallbackLabel, type HabitData } from './habitModel';

const STAT_LABELS: [keyof Pick<HabitData, 'currentStreak' | 'bestStreak' | 'weeklyRate'>, string, string][] = [
  ['currentStreak', 'Streak', ''],
  ['bestStreak', 'Best', ''],
  ['weeklyRate', 'Week', '%'],
];

/**
 * One habit as a list row: today's check, identity, the last four weeks as
 * a strip, three numbers, and the chevron that opens its drawer. Below
 * `wide` (1100px) the stats and tag go so the name keeps its room; on a
 * phone the strip wraps onto its own line.
 */
export default function HabitRow({
  habit,
  today,
  open,
  onToggleOpen,
  selected = false,
  onRowClick,
  onContextMenu,
}: {
  habit: HabitData;
  today: string;
  open: boolean;
  onToggleOpen: () => void;
  selected?: boolean;
  /** Ctrl/Shift selection; a `'plain'` result means the click should open the drawer instead. */
  onRowClick?: (e: React.MouseEvent) => RowClickResult;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const { toggleTodo, categoryById, firstDayOfWeek } = useApp();
  const { todo } = habit;
  const color = colorHex(todo.colorKey);
  const category = categoryById(todo.category);

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
        selected && 'bg-accent-tint data-[open]:bg-accent-tint',
      )}
    >
      <button
        type="button"
        aria-pressed={habit.doneToday}
        title={habit.doneToday ? 'Completed today — click to undo' : 'Mark as done'}
        onClick={(e) => {
          e.stopPropagation();
          toggleTodo(todo.id, today);
        }}
        className={cn(
          'group size-[1.375rem] shrink-0 flex items-center justify-center border border-accent transition-colors',
          habit.doneToday
            ? 'bg-accent text-on-accent hover:bg-accent-hover'
            : 'bg-surface text-accent hover:bg-accent-tint',
        )}
      >
        <Check
          size="0.8125rem"
          strokeWidth={3}
          className={cn('transition-opacity', habit.doneToday ? 'opacity-100' : 'opacity-0 group-hover:opacity-35')}
        />
      </button>

      <div className="flex flex-col gap-1 min-w-0 w-[13.75rem] max-wide:w-[12.5rem]">
        <div className="flex items-center gap-2.5 min-w-0">
          <Dot accent={color} size={10} />
          <span className="font-heading text-sm font-bold text-ink truncate">{todo.name}</span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden max-wide:hidden">
          <Tag accent={category ? colorHex(category.colorKey) : color} className="shrink-0">
            {category?.name ?? fallbackLabel(todo)}
          </Tag>
          <Tag className="shrink-0">{repeatLabel(todo.schedule, firstDayOfWeek)}</Tag>
          {todo.reminder && (
            <span className="flex items-center gap-1 text-meta text-ink-muted whitespace-nowrap">
              <Bell size="0.75rem" aria-label="Reminder" />
              {todo.time ?? 'due days'}
            </span>
          )}
        </div>
      </div>

      <HabitStrip
        todo={todo}
        cells={habit.strip}
        color={color}
        today={today}
        cellClass="size-[0.875rem]"
        className="flex-1 min-w-0 items-start max-md:basis-full max-md:order-last"
      />

      <div className="flex gap-3.5 w-[11.875rem] shrink-0 max-wide:hidden">
        {STAT_LABELS.map(([key, label, suffix]) => (
          <div key={key} className="flex flex-col">
            <span className="font-heading text-[0.9375rem] font-bold leading-[1.1] text-ink tabular-nums">
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
        <ChevronDown size="0.875rem" className={cn('transition-transform duration-200', open && 'rotate-180')} />
      </button>
    </div>
  );
}
