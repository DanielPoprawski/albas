import * as React from 'react';

import { accentOf, CATEGORY_ACCENTS, type CategoryAccentName } from '@/colors';
import { cn } from '@/lib/utils';

/** A category accent by name, or any stored hex. */
export type AccentInput = CategoryAccentName | (string & {});

function resolve(accent: AccentInput) {
  return accent in CATEGORY_ACCENTS
    ? CATEGORY_ACCENTS[accent as CategoryAccentName]
    : accentOf(accent);
}

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Category name (`amber`, `green`, …) or a hex. Defaults to purple. */
  accent?: AccentInput;
  /** Solid fill in the accent with white text, for a section header bar. */
  solid?: boolean;
}

/**
 * The uppercase micro chip: a status, a category, a sign-in method's type.
 * Colours come from the accent trio rather than utility classes so a
 * user-picked hex renders the same way a built-in category does.
 */
export function Tag({ className, accent = 'purple', solid, style, ...props }: TagProps) {
  const a = resolve(accent);
  return (
    <span
      data-slot="tag"
      className={cn(
        'inline-flex items-center gap-[4px] px-[8px] py-[3px]',
        'text-[10px] font-bold uppercase tracking-[0.5px] leading-none',
        className,
      )}
      style={{
        background: solid ? a.hex : a.tint,
        color: solid ? '#ffffff' : a.ink,
        ...style,
      }}
      {...props}
    />
  );
}

export { Tag as Pill };

export interface DotProps extends React.HTMLAttributes<HTMLSpanElement> {
  accent?: AccentInput;
  /** Square edge in px — 7 on a task row, 10 in the sidebar, 8 on a header. */
  size?: number;
}

/**
 * The small square swatch that marks a category. Square, like everything
 * else — a circle here is the single most common way this design gets broken.
 */
export function Dot({ className, accent = 'purple', size = 8, style, ...props }: DotProps) {
  const a = resolve(accent);
  return (
    <span
      data-slot="dot"
      aria-hidden
      className={cn('inline-block shrink-0', className)}
      style={{ width: size, height: size, background: a.hex, ...style }}
      {...props}
    />
  );
}
