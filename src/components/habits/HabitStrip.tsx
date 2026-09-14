import { cn } from '@/lib/utils';
import { useApp } from '../../context/AppContext';
import type { Todo } from '../../types';
import HabitCell from './HabitCell';
import { cycleCell, type HistoryCell, weekdayInitial } from './habitModel';

/**
 * A run of day cells for one habit — the dashboards' current week, the
 * Habits page's last 28 days — with a weekday initial under each, today's in
 * the accent. Every click goes through `cycleCell`, so a yes/no habit toggles
 * and a measurable one counts up the same way wherever it is drawn.
 *
 * `cellClass` sizes the cells (`size-[…]`); it is applied to the labels too,
 * which is what keeps each initial centred under its cell without a per-cell
 * width in an inline style. `spread` spaces the columns across the full
 * width (the phone dashboard) instead of packing them from the left.
 */
export default function HabitStrip({
  todo,
  cells,
  color,
  today,
  cellClass,
  spread = false,
  className,
}: {
  todo: Todo;
  cells: HistoryCell[];
  /** The habit's own colour, as `colorHex(todo.colorKey)`. */
  color: string;
  today: string;
  cellClass: string;
  spread?: boolean;
  /** The wrapper — how the strip sits in its row. */
  className?: string;
}) {
  const { toggleTodo, setTodoValue } = useApp();
  const grid = cn('grid grid-flow-col auto-cols-max gap-[0.1875rem]', spread && 'justify-between');
  return (
    // Clicks stop here: the strip always sits in a row whose own click opens
    // an editor or a drawer, and a tick must not do both.
    <div
      className={cn('flex flex-col gap-1 max-w-full overflow-x-auto scrollbar-hide', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={grid} role="group" aria-label={`${todo.name}, last ${cells.length} days`}>
        {cells.map((cell) => (
          <HabitCell
            key={cell.dateStr}
            cell={cell}
            todo={todo}
            color={color}
            className={cn(cellClass, 'enabled:hover:scale-120')}
            onClick={(d) => cycleCell(todo, d, toggleTodo, setTodoValue)}
          />
        ))}
      </div>
      <div className={grid} aria-hidden>
        {cells.map((cell) => (
          <span
            key={cell.dateStr}
            className={cn(
              cellClass,
              'flex items-center justify-center text-[0.5625rem] leading-none uppercase',
              cell.dateStr === today ? 'text-accent font-bold' : 'text-ink-muted',
            )}
          >
            {weekdayInitial(cell.dateStr)}
          </span>
        ))}
      </div>
    </div>
  );
}
