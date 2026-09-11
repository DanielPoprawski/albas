import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The uppercase 0.625rem label that sits above every input in this design. It is
 * its own export because it also heads sections that contain no input at all
 * (the sidebar's "MENU"/"CATEGORIES", a card's title row).
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

/**
 * The app's one input recipe (`field-input`, App.css) plus a disabled state —
 * previously its own 2px-bordered variant; consolidated onto the same 1px
 * skin every other text input in the app uses.
 */
const FIELD_BASE = 'field-input disabled:cursor-not-allowed';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders a `MicroLabel` above the field, wired to it by id. */
  label?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, label, id, ...props }, ref) => {
  const generated = React.useId();
  const fieldId = id ?? generated;
  const input = <input ref={ref} id={fieldId} data-slot="input" className={cn(FIELD_BASE, className)} {...props} />;
  if (!label) return input;
  return (
    <div className="flex flex-col gap-[0.375rem]">
      <MicroLabel htmlFor={fieldId}>{label}</MicroLabel>
      {input}
    </div>
  );
});
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, id, rows = 3, ...props }, ref) => {
    const generated = React.useId();
    const fieldId = id ?? generated;
    const field = (
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        data-slot="textarea"
        className={cn(FIELD_BASE, 'resize-none', className)}
        {...props}
      />
    );
    if (!label) return field;
    return (
      <div className="flex flex-col gap-[0.375rem]">
        <MicroLabel htmlFor={fieldId}>{label}</MicroLabel>
        {field}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
