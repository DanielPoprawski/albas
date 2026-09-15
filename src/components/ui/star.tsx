import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The importance toggle, one drawing for every surface. It follows the
 * checkbox beside it: a hollow `line-strong` outline at rest, the accent on
 * hover, and solid accent when on — so it reads as one of the app's marks
 * rather than a stock gold star. Stops propagation itself, since it always
 * sits inside a row that has its own click.
 */
export function StarButton({
  important,
  onToggle,
  size = '1.125rem',
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
        'flex size-5 shrink-0 items-center justify-center p-0 cursor-pointer transition-colors',
        important ? 'text-accent hover:text-accent-hover' : 'text-line-strong hover:text-accent',
        className,
      )}
    >
      <Star
        size={size}
        strokeWidth={1}
        className={cn('transition-transform duration-100 active:scale-90', important ? 'fill-current' : 'fill-none')}
      />
    </button>
  );
}
