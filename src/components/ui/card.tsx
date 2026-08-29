import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A white panel on the page's light gray. The shadow is deliberately almost
 * nothing (`shadow-card`, 1px at 6%) — separation in this design comes from
 * the hairline border, and a heavier shadow reads as a rounded card even
 * with square corners.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card"
      className={cn('border border-line bg-surface shadow-card', className)}
      {...props}
    />
  );
}

/**
 * The tinted header strip a collapsible card wears — purple ink on
 * `accent-tint`, uppercase micro type, the chevron pushed to the end by the
 * call site.
 */
export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'flex items-center gap-[6px] bg-accent-tint px-[12px] py-[10px]',
        'text-[10px] font-bold uppercase tracking-[0.5px] text-accent',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      data-slot="card-title"
      className={cn('font-heading text-[14px] font-semibold text-ink', className)}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="card-body" className={cn('p-[16px]', className)} {...props} />
  );
}
