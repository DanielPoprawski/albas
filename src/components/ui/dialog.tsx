import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

/*
 * forwardRef, unlike the generated version. shadcn now targets React 19, where
 * a function component takes `ref` as an ordinary prop; this project is on
 * React 18, so Radix's <Presence> ref lands on nothing and React warns. The
 * ref is what Presence uses to watch the exit animation, so it matters beyond
 * the console noise.
 */
const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        // bg-scrim, not the stock bg-black/50: this app's scrim is a theme
        // variable and carries a blur, and a literal black would not follow
        // the light theme.
        'fixed inset-0 z-50 bg-scrim backdrop-blur-[0.25rem] data-[state=open]:animate-[fade_150ms_ease-out_both] data-[state=closed]:animate-[fade_150ms_ease-in_reverse_both] motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
});

/**
 * A small confirm/pick dialog: a centred `surface` card with the modal
 * shadow, laid out as a plain block (each caller stacks its own children
 * with margins). Width belongs to the call site — `max-w-[min(22rem,…)]` —
 * because the `sm:max-w-lg` shadcn ships resolves to this app's 2.5rem
 * `--spacing-lg`. No close button: every dialog here offers its own
 * Cancel, and the scrim and Escape close it as well.
 */
function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-[50%] left-[50%] z-50 block w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] border border-line bg-surface p-md text-ink shadow-modal data-[state=open]:animate-[pop_200ms_ease-out_both] data-[state=closed]:animate-[pop_150ms_ease-in_reverse_both] motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base font-heading font-normal text-ink mb-md', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-ink-muted mb-md', className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogTitle };
