import { cn } from '@/lib/utils';
import { useApp } from '../../context/AppContext';
import type { ColorKey, Seed } from '../../types';
import HabitCell from './HabitCell';
import { cycleCell, type HistoryCell, weekdayInitial } from './habitModel';

/**
 * A run of day cells for one habit — the dashboards' current week, the
 * Habits page's last 28 days — with a weekday initial under each, today's in
 * the accent. Every click goes through `cycleCell`, so a check habit toggles
 * and a count one counts up the same way wherever it is drawn.
 *
 * `cellClass` sizes the cells (`size-[…]`); it is applied to the labels too,
 * which is what keeps each initial centred under its cell without a per-cell
 * width in an inline style. `spread` spaces the columns across the full
 * width (the phone dashboard) instead of packing them from the left.
 */
export default function HabitStrip({
  seed,
  cells,
  color,
  today,
  cellClass,
  spread = false,
  className,
}: {
  seed: Seed;
  cells: HistoryCell[];
  /** The habit's colour, as `colorOf(seed)`. */
  color: ColorKey;
  today: string;
  cellClass: string;
  spread?: boolean;
  /** The wrapper — how the strip sits in its row. */
  className?: string;
}) {
  const { toggleDone, setDone } = useApp();
  const grid = cn('grid grid-flow-col auto-cols-max gap-[0.25rem]', spread && 'justify-between');
  return (
    // Individual cells stop propagation; clicking elsewhere in the strip area
    // expands or collapses the habit row as expected.
    <div className={cn('flex flex-col gap-1 max-w-full overflow-x-auto scrollbar-hide', className)}>
      <div className={grid} role="group" aria-label={`${seed.title}, last ${cells.length} days`}>
        {cells.map((cell) => (
          <HabitCell
            key={cell.dateStr}
            cell={cell}
            seed={seed}
            color={color}
            className={cn(cellClass, 'enabled:hover:scale-120')}
            onClick={(d) => cycleCell(seed, d, toggleDone, setDone)}
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
