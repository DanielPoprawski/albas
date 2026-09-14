import * as React from 'react';

import { accentNameOf, accentOf, CATEGORY_ACCENTS, CATEGORY_CLASSES, type CategoryAccentName } from '@/colors';
import { cn } from '@/lib/utils';

/** A category accent by name, or any stored hex. */
export type AccentInput = CategoryAccentName | (string & {});

/** A named accent, or the name a stored hex belongs to, or null for a custom colour. */
function nameOf(accent: AccentInput): CategoryAccentName | null {
  return accent in CATEGORY_ACCENTS ? (accent as CategoryAccentName) : accentNameOf(accent);
}

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Category name (`amber`, `green`, …) or a hex. No accent = the neutral grey General wears. */
  accent?: AccentInput;
  /** Solid fill in the accent with white text, for a section header bar. */
  solid?: boolean;
}

/**
 * The uppercase micro chip: a status, a category, a sign-in method's type.
 * A named accent paints from its `--t-cat-*` classes so it follows the theme;
 * only a user-picked hex falls back to an inline translucent wash of itself.
 */
export function Tag({ className, accent, solid, style, ...props }: TagProps) {
  const name = accent ? nameOf(accent) : null;
  const c = name ? CATEGORY_CLASSES[name] : null;
  const a = accent && !name ? accentOf(accent) : null;
  return (
    <span
      data-slot="tag"
      className={cn(
        'inline-flex items-center gap-[0.25rem] px-[0.5rem] py-[0.1875rem]',
        'text-xs font-bold uppercase tracking-[0.5px] leading-none',
        c && (solid ? `${c.solid} text-on-accent` : `${c.tint} ${c.ink}`),
        !accent && (solid ? 'bg-ink-secondary text-on-accent' : 'bg-subtle text-ink-secondary'),
        className,
      )}
      // dynamic: the accent's own colour when it is not a named token
      style={a ? { background: solid ? a.hex : a.tint, color: solid ? 'var(--t-on-accent)' : a.ink, ...style } : style}
      {...props}
    />
  );
}

export interface DotProps extends React.HTMLAttributes<HTMLSpanElement> {
  accent?: AccentInput;
  /** Square edge in px — 7 on a task row, 10 in the sidebar, 8 on a header. */
  size?: number;
}

/**
 * The small square swatch that marks a category. Square, like everything
 * else — a circle here is the single most common way this design gets broken.
 */
export function Dot({ className, accent, size = 8, style, ...props }: DotProps) {
  const name = accent ? nameOf(accent) : null;
  return (
    <span
      data-slot="dot"
      aria-hidden
      className={cn(
        'inline-block shrink-0',
        name && CATEGORY_CLASSES[name].solid,
        !accent && 'bg-ink-secondary',
        className,
      )}
      // dynamic: size and accent come from the caller
      style={{ width: size, height: size, ...(accent && !name ? { background: accentOf(accent).hex } : {}), ...style }}
      {...props}
    />
  );
}
