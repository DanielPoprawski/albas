import * as React from 'react';

import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';
export type IconButtonVariant = 'primary' | 'ghost' | 'accent2';

/**
 * Three variants, and that is the whole vocabulary: solid purple for the one
 * action a screen is about, an outlined purple for the alternative beside it,
 * and a text-weight ghost for everything that isn't either. Anything a design
 * draws that isn't one of these is a link or an icon button, not a fourth
 * variant.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent border border-accent hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'bg-surface text-accent border border-accent hover:bg-accent-tint',
  ghost: 'bg-transparent text-ink-secondary border border-transparent hover:bg-subtle hover:text-ink',
};

/** The design's button padding is 0.5rem 0.75rem; `sm` is the 0.375rem×0.625rem icon-row size. */
const SIZES: Record<ButtonSize, string> = {
  sm: 'px-[0.625rem] py-[0.375rem]',
  md: 'px-[0.75rem] py-[0.5rem]',
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
        'inline-flex items-center justify-center gap-[0.375rem] text-sm font-semibold leading-none',
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
 * A square button holding one icon — the calendar's ‹ › steppers. Sized 1.75rem
 * to match the design's `.calendar-header button`, which is the only place a
 * bare icon sits on its own border.
 */
/**
 * `ghost` is the design's one bordered icon square; `primary` is the same
 * square filled with the accent; `accent2` is the calendar's ‹ › steppers,
 * filled with the secondary accent and warming to the accent on hover.
 */
const ICON_VARIANTS: Record<IconButtonVariant, string> = {
  ghost: 'icon-btn',
  primary:
    'size-[1.75rem] items-center justify-center border border-accent bg-accent text-on-accent transition-colors duration-150 hover:bg-accent-hover',
  accent2:
    'size-[1.75rem] items-center justify-center border-0 bg-accent-2 text-on-accent-2 transition-colors duration-150 hover:bg-accent',
};

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = 'ghost', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="icon-button"
      className={cn(
        'inline-flex shrink-0 cursor-pointer disabled:pointer-events-none',
        ICON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';
