import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A white panel on the page's light gray. The shadow is deliberately almost
 * nothing (`shadow-card`, 1px at 6%) — separation in this design comes from
 * the hairline border, and a heavier shadow reads as a card even
 * with square corners.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card" className={cn('panel shadow-card', className)} {...props} />;
}
