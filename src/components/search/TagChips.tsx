import { cn } from '@/lib/utils';
import { COLOR_CLASSES } from '../../colors';
import type { Tag } from '../../types';
import { Icon } from '../ui/icon';

/**
 * Every tag as a toggle chip — the palette's tag filter and the edit panel's
 * bulk tagging. `some` (a mixed selection carries it) draws as a tint.
 */
export function TagChips({
  tags,
  stateOf,
  onToggle,
  className,
}: {
  tags: Tag[];
  stateOf: (id: string) => 'on' | 'some' | 'off';
  onToggle: (id: string) => void;
  className?: string;
}) {
  if (tags.length === 0) {
    return <p className={cn('text-micro text-ink-muted', className)}>No tags yet — add them in Settings › Tags.</p>;
  }
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {tags.map((t) => {
        const state = stateOf(t.id);
        const c = COLOR_CLASSES[t.color];
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={state === 'on'}
            onClick={() => onToggle(t.id)}
            className={cn(
              'flex items-center gap-1 border px-1.5 py-0.5 text-micro font-medium transition-colors max-md:min-h-8 max-md:px-2',
              state === 'on' && `${c.bg} border-transparent text-on-accent`,
              state === 'some' && `${c.tint} ${c.line} ${c.ink}`,
              state === 'off' && 'border-line text-ink-secondary hover:border-accent hover:text-accent',
            )}
          >
            {t.icon && <Icon name={t.icon} size="0.75rem" />}
            {t.name}
          </button>
        );
      })}
    </div>
  );
}
