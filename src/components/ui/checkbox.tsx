import * as React from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A square 1.125rem box with a 1px gray hairline, filling solid accent when
 * checked — the same mark the task rows, the category list and the habit week
 * all draw. The border is `line-strong` rather than `line`: at 1.125rem an
 * unchecked box against a white card needs the extra contrast to read as a
 * control at all.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-[1.125rem] shrink-0 cursor-pointer border border-line-strong bg-surface',
        // No hand-drawn focus state here (unlike field-input's accent border):
        // the app-wide focus outline reset (App.css @layer base) leaves this
        // checkbox with no visible keyboard-focus indication.
        'text-on-accent transition-colors duration-150',
        'hover:border-accent',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <Check size="0.75rem" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
