import * as React from 'react';
import { Icon } from './icon';

import { cn } from '@/lib/utils';
import { IconButton } from './button';

export interface ModalChromeProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Rendered inside the sticky `modal-footer` band. */
  footer?: React.ReactNode;
  /** The card, for callers that animate its height (AddModal's spring). */
  cardRef?: React.Ref<HTMLDivElement>;
  /** The scrolling inner column the spring measures. */
  innerRef?: React.Ref<HTMLDivElement>;
}

/**
 * The Add/Edit modal's scrim, card, header row and footer band — a wide, centred two-pane card on the desktop, a
 * full-screen sheet below the phone breakpoint, where the header row doubles as the app bar. Children render
 * between header and footer inside the scrolling column and bring their own padding. The scrim stops above the desktop bottom bar, which stays sharp. A click on the
 * scrim itself closes; a click anywhere on the card does not. This is not the shadcn `Dialog` (which is a
 * Radix portal with focus trapping) on purpose: AddModal manages its own
 * focus and keyboard handling and needs the card in the render tree.
 */
export function ModalChrome({ title, onClose, children, footer, cardRef, innerRef }: ModalChromeProps) {
  return (
    // `modal-scrim` / `modal-card` are bare markers for DOM lookups, not CSS.
    <div
      className="modal-scrim fixed inset-x-0 top-0 bottom-8 z-50 flex items-start justify-center bg-scrim px-8 pt-[6vh] pb-8 backdrop-blur-[0.1875rem] max-md:items-stretch max-md:p-0 max-md:bottom-0"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={cardRef}
        className={cn(
          'modal-card flex w-[52rem] max-w-full flex-col overflow-hidden border border-line bg-surface shadow-modal',
          'max-md:h-[100dvh] max-md:w-full max-md:border-0',
          'animate-[modal-in_0.22s_cubic-bezier(0.2,0.8,0.3,1)_both] motion-reduce:animate-none',
        )}
        role="dialog"
        aria-modal="true"
      >
        <div ref={innerRef} className="flex max-h-[88dvh] flex-col overflow-y-auto max-md:max-h-none max-md:flex-1">
          <div className="flex items-center justify-between gap-3 px-5 pt-[1.125rem] max-md:border-b max-md:border-line max-md:pb-3">
            <div className="font-heading text-base font-semibold tracking-[-0.01em]">{title}</div>
            <IconButton
              aria-label="Close"
              onClick={onClose}
              className="border-0 size-[1.625rem] text-ink-muted hover:bg-subtle hover:text-ink max-md:size-10"
            >
              <Icon name="close" size="0.875rem" />
            </IconButton>
          </div>
          {children}
          {footer && (
            <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line-subtle bg-surface px-5 py-[0.8125rem] max-md:mt-auto max-md:py-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
