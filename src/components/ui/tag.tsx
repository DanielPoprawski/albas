import * as React from 'react';

import { COLOR_CLASSES } from '@/colors';
import { cn } from '@/lib/utils';
import type { ColorKey } from '@/types';

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** No colour = the neutral grey an unfiled item wears. */
  color?: ColorKey;
  /** Solid fill in the colour with white text, for a section header bar. */
  solid?: boolean;
}

/**
 * The uppercase micro chip: a status, a list, a sign-in method's type.
 * Painted from the colour's `--t-c-*` classes so it follows the theme.
 */
export function Tag({ className, color, solid, ...props }: TagProps) {
  const c = color ? COLOR_CLASSES[color] : null;
  return (
    <span
      data-slot="tag"
      className={cn(
        'inline-flex items-center gap-[0.25rem] px-[0.5rem] py-[0.1875rem]',
        'text-xs font-bold uppercase tracking-wider leading-none',
        c && (solid ? `${c.bg} text-on-accent` : `${c.tint} ${c.ink}`),
        !c && (solid ? 'bg-ink-secondary text-on-accent' : 'bg-subtle text-ink-secondary'),
        className,
      )}
      {...props}
    />
  );
}

export interface DotProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: ColorKey;
  /**
   * Square edge at the default text size — 7 on a task row, 10 in the
   * sidebar, 8 on a header. Emitted in rem so Settings › Text size scales it.
   */
  size?: number;
}

/**
 * The small square swatch that marks a colour. Square, like everything
 * else — a circle here is the single most common way this design gets broken.
 */
export function Dot({ className, color, size = 8, style, ...props }: DotProps) {
  const edge = `${size / 16}rem`;
  return (
    <span
      data-slot="dot"
      aria-hidden
      className={cn('inline-block shrink-0', color ? COLOR_CLASSES[color].bg : 'bg-ink-secondary', className)}
      // dynamic: size comes from the caller
      style={{ width: edge, height: edge, ...style }}
      {...props}
    />
  );
}
