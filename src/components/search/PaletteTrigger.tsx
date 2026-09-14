import { forwardRef, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export const KBD =
  'inline-flex items-center border border-accent-2 bg-page px-[0.3125rem] py-px text-[0.625rem] font-semibold leading-none text-accent-2';

/**
 * The closed state: a long, quiet bar in the page header. It never holds
 * focus itself for typing — a click, Enter or Space opens the palette, whose
 * input takes over — but it echoes the live query and its match count so a
 * closed palette isn't a forgotten filter.
 */
const PaletteTrigger = forwardRef<
  HTMLDivElement,
  { query: string; count: number; onOpen: () => void; className?: string }
>(function PaletteTrigger({ query, count, onOpen, className }, ref) {
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  }
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label="Search events, tasks and habits"
      onClick={onOpen}
      onKeyDown={onKey}
      className={cn(
        'flex h-8 items-center gap-2 border border-line bg-surface px-[0.625rem] cursor-text transition-[border-color,box-shadow] duration-150',
        'hover:border-accent-line focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--t-accent-tint)]',
        className,
      )}
    >
      <Search size="0.875rem" className="shrink-0 text-accent-2" aria-hidden />
      <span className={cn('flex-1 min-w-0 truncate text-[0.8125rem]', query ? 'text-ink' : 'text-ink-muted')}>
        {query || 'Search events, tasks and habits'}
      </span>
      {query && (
        <span className="shrink-0 bg-selection px-1.5 py-px text-[0.6875rem] font-semibold leading-none text-selection-ink">
          {count}
        </span>
      )}
      <kbd className={KBD}>/</kbd>
    </div>
  );
});

export default PaletteTrigger;
