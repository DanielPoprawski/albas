import * as React from 'react';

import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';

/**
 * Three variants, and that is the whole vocabulary: solid purple for the one
 * action a screen is about, an outlined purple for the alternative beside it,
 * and a text-weight ghost for everything that isn't either. Anything a design
 * draws that isn't one of these is a link or an icon button, not a fourth
 * variant.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white border border-accent hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'bg-surface text-accent border border-accent hover:bg-accent-tint',
  ghost: 'bg-transparent text-ink-secondary border border-transparent hover:bg-subtle hover:text-ink',
};

/** The design's button padding is 8px 12px; `sm` is the 6px×10px icon-row size. */
const SIZES: Record<ButtonSize, string> = {
  sm: 'px-[10px] py-[6px]',
  md: 'px-[12px] py-[8px]',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="button"
      className={cn(
        'inline-flex items-center justify-center gap-[6px] text-[12px] font-semibold leading-none',
        'cursor-pointer transition-colors duration-150 select-none',
        'disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

/**
 * A square button holding one icon — the calendar's ‹ › steppers. Sized 28px
 * to match the design's `.calendar-header button`, which is the only place a
 * bare icon sits on its own border.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'ghost', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="icon-button"
      className={cn(
        'inline-flex size-[28px] shrink-0 items-center justify-center',
        'cursor-pointer transition-colors duration-150 disabled:pointer-events-none',
        variant === 'primary'
          ? 'border border-accent bg-accent text-white hover:bg-accent-hover'
          : 'border border-line bg-surface text-ink-secondary hover:border-accent hover:text-accent',
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';
