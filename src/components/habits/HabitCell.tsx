import { valueOn } from '../../todoLogic';
import type { Todo } from '../../types';
import type { HistoryCell } from './habitModel';

/**
 * One day of a habit's history — a square painted in the habit's own colour
 * when done, hollow otherwise, faded and inert for days still to come. Shared
 * by the row's 28-day strip and the drawer's 16-week heatmap, which differ
 * only in size (`className`).
 */
export default function HabitCell({
  cell,
  todo,
  color,
  className,
  onClick,
}: {
  cell: HistoryCell;
  todo: Todo;
  color: string;
  className: string;
  onClick: (dateStr: string) => void;
}) {
  const value = todo.kind === 'measurable' ? valueOn(todo, cell.dateStr) : 0;
  const partial = !cell.done && value > 0;
  // A past day the schedule never asked for: dimmed, no "missed" fill, still
  // clickable so an off-schedule completion can be recorded.
  const offDay = !cell.due && !cell.future && !cell.done && !partial;
  return (
    <button
      type="button"
      disabled={cell.future}
      onClick={() => onClick(cell.dateStr)}
      title={
        cell.future
          ? cell.dateStr
          : `${cell.dateStr}${cell.done ? ' — done' : partial ? ` — ${value}/${todo.target}` : ''}`
      }
      aria-label={`${cell.dateStr}${cell.done ? ', done' : ''}`}
      aria-pressed={cell.done}
      className={`p-0 box-border border transition-transform duration-150 disabled:cursor-default disabled:opacity-40 ${offDay ? 'opacity-40' : ''} ${className}`}
      // dynamic: the habit's own colour
      style={{
        background: cell.done
          ? color
          : partial
            ? `${color}66`
            : cell.future || offDay
              ? 'transparent'
              : 'var(--t-subtle)',
        borderColor: cell.done || partial ? color : 'var(--t-border)',
      }}
    />
  );
}
