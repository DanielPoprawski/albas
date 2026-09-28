import type { ReactNode } from 'react';
import { Icon } from '../ui/icon';
import { cn } from '@/lib/utils';
import { FIELD_ROW } from './catalog';

/**
 * One optional field: caps label, control, and the "×" that removes it. On the phone the label and the ×
 * share the first line and the control wraps onto a full-width second one.
 */
export function FieldRow({
  label,
  onRemove,
  align = 'center',
  children,
}: {
  label: string;
  onRemove: () => void;
  /** `start` for a control taller than one line (chips, textarea). */
  align?: 'center' | 'start';
  children: ReactNode;
}) {
  const top = align === 'start';
  return (
    <div className={cn(FIELD_ROW, top && 'items-start', 'max-md:flex-wrap')}>
      <span className={cn('micro-label w-[4.625rem] shrink-0 max-md:order-1 max-md:flex-1', top && 'pt-[0.3125rem]')}>
        {label}
      </span>
      {/* `contents` keeps the desktop row flat; on the phone it becomes the full-width second line. */}
      <div
        className={cn(
          'contents max-md:order-3 max-md:flex max-md:basis-full max-md:gap-2.5',
          top ? 'max-md:items-start' : 'max-md:items-center',
        )}
      >
        {children}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className={cn(
          'flex size-[1.375rem] shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-icon-idle transition-colors hover:text-ink max-md:order-2 max-md:size-10',
          top && 'mt-1',
        )}
      >
        <Icon name="close" size="0.6875rem" />
      </button>
    </div>
  );
}

/**
 * A collapsible group of optional fields: a full-width caps header with a
 * chevron, children only mounted while expanded. On the desktop the header
 * goes away and the group is just its rows — hidden entirely while collapsed
 * so it takes no gap slot in the column.
 */
export function SectionGroup({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={cn('max-md:border-t max-md:border-line', !expanded && 'hidden max-md:block')}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="micro-label hidden w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent py-3.5 text-left transition-colors hover:text-ink max-md:flex"
      >
        <Icon name={expanded ? 'expand_more' : 'chevron_right'} size="0.75rem" />
        {title}
      </button>
      {expanded && <div className="flex flex-col gap-[0.875rem] max-md:pb-3">{children}</div>}
    </div>
  );
}
