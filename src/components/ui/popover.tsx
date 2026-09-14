import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * A small anchored panel — the calendar's month/year picker. Radix owns the
 * hard parts (outside click, Escape, focus return, collision-aware
 * placement); this only paints it in the app's own vocabulary: the `panel`
 * hairline surface with the `pop` shadow, sharp corners, no arrow.
 */
function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 panel shadow-pop p-3 outline-none data-[state=open]:animate-[pop_150ms_ease-out_both] data-[state=closed]:animate-[pop_120ms_ease-in_reverse_both] motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
