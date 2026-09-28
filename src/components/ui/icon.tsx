import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Icon sizes, in rem so Settings › Text size scales them. A map of literal
 * classes rather than a template: Tailwind only emits what it can read.
 */
const SIZES = {
  '0.625rem': 'text-[0.625rem]',
  '0.6875rem': 'text-[0.6875rem]',
  '0.75rem': 'text-[0.75rem]',
  '0.8125rem': 'text-[0.8125rem]',
  '0.875rem': 'text-[0.875rem]',
  '1rem': 'text-[1rem]',
  '1.125rem': 'text-[1.125rem]',
  '1.25rem': 'text-[1.25rem]',
} as const;

export type IconSize = keyof typeof SIZES;

interface Props extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The symbol's ligature name — `check`, `expand_more`, … — which the font turns into the glyph. */
  name: string;
  size: IconSize;
  /** Solid variant (the FILL axis): a filled star, a ticked circle. */
  fill?: boolean;
}

/**
 * One glyph from the self-hosted Material Symbols Sharp font (declared in
 * App.css, file in public/). The text *is* the icon, so the `icon` utility
 * pins the font and undoes anything an ancestor set on text. An icon with an
 * `aria-label` is content; without one it is decoration beside its control's
 * own text and hidden from the accessibility tree.
 */
export function Icon({ name, size, fill, className, ...rest }: Props) {
  const labelled = !!rest['aria-label'];
  return (
    <span
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      className={cn('icon', SIZES[size], fill && 'icon-fill', className)}
      {...rest}
    >
      {name}
    </span>
  );
}
