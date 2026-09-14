import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FIELD_ROW } from './catalog';

/** One optional field: caps label, control, and the "×" that removes it. */
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
    <div className={cn(FIELD_ROW, top && 'items-start')}>
      <span className={cn('micro-label w-[4.625rem] shrink-0', top && 'pt-[0.3125rem]')}>{label}</span>
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className={cn(
          'flex size-[1.375rem] shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-icon-idle transition-colors hover:text-ink',
          top && 'mt-1',
        )}
      >
        <X size="0.6875rem" strokeWidth={2.4} />
      </button>
    </div>
  );
}

/**
 * A collapsible group of optional fields: a full-width caps header with a
 * chevron, children only mounted while expanded.
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
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="border-t border-line">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="micro-label flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent py-2.5 text-left transition-colors hover:text-ink"
      >
        <Chevron size="0.75rem" strokeWidth={3} />
        {title}
      </button>
      {expanded && <div className="flex flex-col gap-[0.875rem] pb-3">{children}</div>}
    </div>
  );
}
