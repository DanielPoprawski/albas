import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The uppercase micro-heading above a grouped list — a to-do category, the
 * dashboard's "Habits" / "Today's Tasks". Matches the `text-label-md` recipe
 * already shared by `TasksSection`/`HabitsSection` (0.75rem, tracking-wider,
 * uppercase); sites that draw a
 * bolder or differently-coloured heading (e.g. the dashboard's purple
 * section titles) pass a `className` override — `tracking-*`/`font-*`/
 * `text-*` utilities compose predictably over the base recipe regardless of
 * class order.
 */
export function SectionHeading({
  count,
  className,
  style,
  children,
}: {
  /** A trailing count badge, e.g. "Completed 3". Omit for a plain heading. */
  count?: number;
  className?: string;
  /** A category's accent colour — overrides the default muted ink. */
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <h3
      className={cn('text-label-md text-ink-muted uppercase tracking-wider flex items-center gap-xs', className)}
      // dynamic: pass-through for a category's own colour
      style={style}
    >
      {children}
      {count != null && <span className="text-ink-muted font-normal">{count}</span>}
    </h3>
  );
}
