import type { ReactNode } from 'react';
import { X } from 'lucide-react';
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

/** A square colour swatch; the selected one carries an ink outline. */
export function Swatch({
  hex,
  selected,
  onClick,
  className,
}: {
  hex: string;
  selected: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={hex}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'shrink-0 border-0 cursor-pointer outline-2 outline-offset-2 transition-[outline-color]',
        selected ? 'outline-ink' : 'outline-transparent',
        className,
      )}
      // dynamic: the swatch is the colour it offers
      style={{ background: hex }}
    />
  );
}
