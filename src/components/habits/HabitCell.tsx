import { COLOR_CLASSES } from '../../colors';
import { targetOf, valueOn } from '../../seedLogic';
import type { ColorKey, Seed } from '../../types';
import { cn } from '@/lib/utils';
import type { HistoryCell } from './habitModel';

/**
 * One day of a habit's history — a square painted in the habit's colour
 * when done, hollow otherwise, faded and inert for days still to come. Shared
 * by the row's 28-day strip and the drawer's 16-week heatmap, which differ
 * only in size (`className`).
 */
export default function HabitCell({
  cell,
  seed,
  color,
  className,
  onClick,
}: {
  cell: HistoryCell;
  seed: Seed;
  color: ColorKey;
  className: string;
  onClick: (dateStr: string) => void;
}) {
  const value = seed.track?.kind === 'count' ? valueOn(seed, cell.dateStr) : 0;
  const partial = !cell.done && value > 0;
  // A past day the schedule never asked for: dimmed, no "missed" fill, still
  // clickable so an off-schedule completion can be recorded.
  const offDay = !cell.due && !cell.future && !cell.done && !partial;
  const c = COLOR_CLASSES[color];
  return (
    <button
      type="button"
      disabled={cell.future}
      onClick={(e) => {
        e.stopPropagation();
        onClick(cell.dateStr);
      }}
      title={
        cell.future
          ? cell.dateStr
          : `${cell.dateStr}${cell.done ? ' — done' : partial ? ` — ${value}/${targetOf(seed)}` : ''}`
      }
      aria-label={`${cell.dateStr}${cell.done ? ', done' : ''}`}
      aria-pressed={cell.done}
      className={cn(
        'p-0 box-border border transition-transform duration-150 cursor-pointer disabled:cursor-default disabled:opacity-40',
        cell.done && `${c.bg} border-transparent`,
        partial && `${c.tint} ${c.line}`,
        !cell.done && !partial && (cell.future || offDay ? 'bg-transparent border-line' : 'bg-subtle border-line'),
        offDay && 'opacity-40',
        className,
      )}
    />
  );
}
