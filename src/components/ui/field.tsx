import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The uppercase 10px label that sits above every input in this design. It is
 * its own export because it also heads sections that contain no input at all
 * (the sidebar's "MENU"/"CATEGORIES", a card's title row).
 */
export function MicroLabel({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      data-slot="micro-label"
      className={cn(
        'block text-[10px] font-bold uppercase tracking-[0.5px] text-ink-muted',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A 2px border rather than the 1px used on cards and rows: an input is the one
 * element on these screens you're meant to aim at, and the extra pixel is what
 * separates it from a static bordered row at a glance.
 */
const FIELD_BASE =
  'w-full border-2 border-line bg-surface px-[10px] py-[8px] text-[13px] text-ink ' +
  'placeholder:text-ink-muted transition-colors duration-150 outline-none ' +
  'focus:border-accent disabled:cursor-not-allowed';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders a `MicroLabel` above the field, wired to it by id. */
  label?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, id, ...props }, ref) => {
    const generated = React.useId();
    const fieldId = id ?? generated;
    const input = (
      <input
        ref={ref}
        id={fieldId}
        data-slot="input"
        className={cn(FIELD_BASE, className)}
        {...props}
      />
    );
    if (!label) return input;
    return (
      <div className="flex flex-col gap-[6px]">
        <MicroLabel htmlFor={fieldId}>{label}</MicroLabel>
        {input}
      </div>
    );
  },
);
Input.displayName = 'Input';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
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
      <div className="flex flex-col gap-[6px]">
        <MicroLabel htmlFor={fieldId}>{label}</MicroLabel>
        {field}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
