import { COLOR_CLASSES } from '../../colors';
import { targetOf, valueOn } from '../../seedLogic';
import type { ColorKey, Seed } from '../../types';
import { cn } from '@/lib/utils';
import type { HistoryCell } from './habitModel';

/**
 * One day of a habit's history. Shared by the strips and the drawer's 16-week
 * heatmap, which differ only in size (`className`). Six states:
 * - done: filled in the habit's colour; partly counted: its tint and line
 * - due today, still open: hollow in the habit's line
 * - due on a past day and missed (late): the danger tint — except for a
 *   quota, whose open days aren't misses until the period is over
 * - due later: hollow, faded and inert
 * - a day the schedule never asks for: a small grey square, still clickable
 *   on past days so an off-schedule completion can be recorded
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
  const open = !cell.done && !partial;
  const offDay = open && !cell.due;
  const missed = open && cell.due && !cell.future && !cell.today && seed.repeat.type !== 'timesPer';
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
          : `${cell.dateStr}${cell.done ? ' — done' : partial ? ` — ${value}/${targetOf(seed)}` : missed ? ' — missed' : ''}`
      }
      aria-label={`${cell.dateStr}${cell.done ? ', done' : missed ? ', missed' : ''}`}
      aria-pressed={cell.done}
      className={cn(
        'p-0 box-border border transition-transform duration-150 cursor-pointer disabled:cursor-default disabled:opacity-40',
        cell.done && `${c.bg} border-transparent`,
        partial && `${c.tint} ${c.line}`,
        offDay && 'scale-50 bg-line border-transparent',
        missed && 'bg-danger-tint border-danger/50',
        open && cell.due && cell.today && `bg-subtle ${c.line}`,
        open && cell.due && !cell.today && !missed && 'bg-transparent border-line',
        className,
      )}
    />
  );
}
