import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';

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

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // Two edits from stock:
          //  - bg-popover (= --t-surface), not bg-background: modals here sit
          //    on the elevated surface, not the page colour.
          //  - `sm:max-w-lg` removed. This app defines --spacing-lg: 2.5rem, so
          //    that class resolves to a 2.5rem-wide dialog, and a call site can't
          //    override it — tailwind-merge doesn't dedupe across responsive
          //    variants, so an unprefixed max-w- loses above the sm breakpoint.
          //    Width belongs to the call site now.
          'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 border bg-popover p-6 shadow-modal outline-none data-[state=open]:animate-[pop_200ms_ease-out_both] data-[state=closed]:animate-[pop_150ms_ease-in_reverse_both] motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 opacity-70 transition-opacity hover:opacity-100 outline-none disabled:pointer-events-none data-[state=open]:bg-subtle data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <X size="1.125rem" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/*
 * Stock DialogFooter can render a shadcn <Button variant="outline">Close</Button>.
 * That option is dropped: this app has its own button vocabulary in
 * forms/shared.tsx (SubmitButton, EditActions), and importing shadcn's Button
 * would mean two competing sets of button styles for one app.
 */

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogTitle };
