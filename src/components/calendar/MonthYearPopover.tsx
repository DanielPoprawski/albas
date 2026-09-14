import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString('default', { month: 'short' }));

/**
 * The header's month label, and the two-tier picker it opens: a year stepper
 * above a 3×4 grid of months, so any month of any year is two clicks away —
 * the native `<select>` this replaces listed twelve months of one year and
 * had no way to change the year at all.
 *
 * The stepper only moves the year *shown in the grid*; the calendar changes
 * when a month is clicked. Opening resets the shown year to the viewed one.
 */
export default function MonthYearPopover({ month, onPick }: { month: Date; onPick: (month: Date) => void }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(month.getFullYear());
  const now = new Date();

  function handleOpenChange(next: boolean) {
    if (next) setYear(month.getFullYear());
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Choose month and year"
          className="flex items-center gap-1 px-xs py-[0.375rem] text-sm font-medium font-body text-ink hover:text-accent transition-colors"
        >
          {month.toLocaleString('default', { month: 'long', year: 'numeric' })}
          <ChevronDown size="0.875rem" className="text-ink-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[14rem]">
        <div className="flex items-center justify-between mb-2">
          <IconButton aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
            <ChevronLeft size="0.875rem" />
          </IconButton>
          <span className="font-heading text-sm font-bold text-ink tabular-nums">{year}</span>
          <IconButton aria-label="Next year" onClick={() => setYear((y) => y + 1)}>
            <ChevronRight size="0.875rem" />
          </IconButton>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((label, i) => {
            const viewed = year === month.getFullYear() && i === month.getMonth();
            const current = year === now.getFullYear() && i === now.getMonth();
            return (
              <button
                key={label}
                type="button"
                aria-pressed={viewed}
                onClick={() => {
                  onPick(new Date(year, i, 1));
                  setOpen(false);
                }}
                className={cn(
                  'py-1.5 text-xs font-medium border transition-colors',
                  viewed
                    ? 'bg-accent border-accent text-on-accent'
                    : current
                      ? 'border-accent text-accent hover:bg-accent-tint'
                      : 'border-transparent text-ink-secondary hover:bg-subtle hover:text-ink',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
