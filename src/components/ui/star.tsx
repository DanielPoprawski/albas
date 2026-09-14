import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The importance toggle, one drawing for every surface: a lucide star that
 * is a hollow border-grey outline when off and a gold fill with a darker
 * gold outline when on. Stops propagation itself, since it always sits
 * inside a row that has its own click.
 */
export function StarButton({
  important,
  onToggle,
  size = '1rem',
  className,
}: {
  important: boolean;
  onToggle: () => void;
  size?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={important}
      title={important ? 'Not important' : 'Mark important'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'flex shrink-0 items-center justify-center transition-colors',
        important ? 'text-star-line' : 'text-line-strong hover:text-ink-muted',
        className,
      )}
    >
      <Star size={size} strokeWidth={2} className={important ? 'fill-star' : 'fill-none'} />
    </button>
  );
}
