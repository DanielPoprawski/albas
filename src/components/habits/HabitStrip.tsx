import { cn } from '@/lib/utils';
import { useApp } from '../../context/AppContext';
import type { ColorKey, Seed } from '../../types';
import { HabitCell } from './HabitCell';
import { cycleCell, type HistoryCell, weekdayInitial } from './habitModel';

const GRID = 'grid grid-flow-col auto-cols-max gap-[0.25rem]';

/**
 * A weekday initial per day, today's in the accent — under each strip, or
 * once above the dashboard's stack of label-less strips. `cellClass` must be
 * the strip's, which is what keeps each initial centred over its cell.
 */
export function StripLabels({
  dates,
  today,
  cellClass,
  className,
}: {
  dates: string[];
  today: string;
  cellClass: string;
  className?: string;
}) {
  return (
    <div className={cn(GRID, className)} aria-hidden>
      {dates.map((d) => (
        <span
          key={d}
          className={cn(
            cellClass,
            'flex items-center justify-center text-[0.5625rem] leading-none uppercase',
            d === today ? 'text-accent font-bold' : 'text-ink-muted',
          )}
        >
          {weekdayInitial(d)}
        </span>
      ))}
    </div>
  );
}

/**
 * A run of day cells for one habit — the dashboards' current week, the
 * Habits page's last 28 days — with a weekday initial under each unless
 * `labels` is off. Every click goes through `cycleCell`, so a check habit
 * toggles and a count one counts up the same way wherever it is drawn.
 *
 * `cellClass` sizes the cells (`size-[…]`). `spread` spaces the columns
 * across the full width (the phone dashboard) instead of packing them from
 * the left.
 */
export function HabitStrip({
  seed,
  cells,
  color,
  today,
  cellClass,
  spread = false,
  labels = true,
  className,
}: {
  seed: Seed;
  cells: HistoryCell[];
  /** The habit's colour, as `colorOf(seed)`. */
  color: ColorKey;
  today: string;
  cellClass: string;
  spread?: boolean;
  labels?: boolean;
  /** The wrapper — how the strip sits in its row. */
  className?: string;
}) {
  const { toggleDone, setDone } = useApp();
  return (
    // Individual cells stop propagation; clicking elsewhere in the strip area
    // expands or collapses the habit row as expected.
    <div className={cn('flex flex-col gap-1 max-w-full overflow-x-auto scrollbar-hide', className)}>
      <div
        className={cn(GRID, spread && 'justify-between')}
        role="group"
        aria-label={`${seed.title}, last ${cells.length} days`}
      >
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
      {labels && (
        <StripLabels
          dates={cells.map((c) => c.dateStr)}
          today={today}
          cellClass={cellClass}
          className={cn(spread && 'justify-between')}
        />
      )}
    </div>
  );
}
