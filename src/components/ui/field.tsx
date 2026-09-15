import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The uppercase 0.75rem label (`micro-label`, App.css) that sits above every
 * input in this design. It is its own export because it also heads sections
 * that contain no input at all (a card's title row, a settings row).
 */
export function MicroLabel({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label data-slot="micro-label" className={cn('micro-label block', className)} {...props} />;
}

/**
 * The one-line status under a form or action (`form-message`, App.css):
 * danger for errors, success for confirmations, muted for "busy" progress.
 */
export function FormMessage({
  kind = 'error',
  className,
  ...props
}: { kind?: 'error' | 'success' | 'busy' } & React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="form-message"
      className={cn(
        'form-message',
        kind === 'error' ? 'text-danger' : kind === 'success' ? 'text-success' : 'text-ink-muted',
        className,
      )}
      {...props}
    />
  );
}
