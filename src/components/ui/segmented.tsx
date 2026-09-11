import * as React from 'react';

import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Stretch across the container, each option an equal share. */
  fill?: boolean;
  'aria-label'?: string;
}

/**
 * A row of square options sharing one border, active in solid purple.
 *
 * The options collapse their shared edge with `-ml-px` rather than the group
 * drawing dividers, so the active option's purple border sits on top of its
 * neighbour's gray one instead of beside it — with no radius there is nothing
 * else hiding a doubled 2px seam.
 *
 * Arrow keys move between options: it is a radio group, so a Tab should land
 * on the group once, not once per choice.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  fill,
  ...props
}: SegmentedProps<T>) {
  const move = (delta: number) => {
    const i = options.findIndex((o) => o.value === value);
    if (i < 0) return;
    const next = options[(i + delta + options.length) % options.length];
    onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      data-slot="segmented"
      className={cn(fill ? 'flex w-full' : 'inline-flex', className)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
      {...props}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative -ml-px cursor-pointer border px-[0.75rem] py-[0.5rem] first:ml-0',
              fill && 'flex-1 min-w-0 px-1',
              'text-sm font-semibold leading-none transition-colors duration-150',
              active
                ? 'z-10 border-accent bg-accent text-on-accent'
                : 'border-line bg-surface text-ink-secondary hover:bg-subtle hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
