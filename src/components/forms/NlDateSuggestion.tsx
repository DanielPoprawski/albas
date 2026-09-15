import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { describeWhen, type NlDateMatch, useNlDate } from '../../nlDate';

/**
 * A natural-language date found in a title, minus the one the user waved
 * away. Dismissal is keyed on the matched phrase and its position, so editing
 * the title into a *different* date phrase brings the suggestion back while
 * retyping the same one does not.
 */
export function useNlSuggestion(text: string): { suggestion: NlDateMatch | null; dismiss: () => void } {
  const parsed = useNlDate(text);
  const key = parsed ? `${parsed.matched.index}:${parsed.matched.text}` : null;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  return {
    suggestion: key !== null && key !== dismissedKey ? parsed : null,
    dismiss: () => setDismissedKey(key),
  };
}

/** "→ Fri 5 Sep — from “next friday”  Apply ×" under a title input. */
export function NlDateSuggestion({
  suggestion,
  onApply,
  onDismiss,
  className,
}: {
  suggestion: NlDateMatch;
  onApply: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <span className="text-sm text-ink-muted truncate">
        {'→ '}
        <span className="text-accent font-semibold">{describeWhen(suggestion)}</span>
        {' — from “'}
        {suggestion.matched.text}
        {'”'}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <button type="button" onClick={onApply} className="text-sm font-semibold text-accent hover:underline">
          Apply
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss date suggestion"
          className="flex items-center text-ink-muted hover:text-ink"
        >
          <X size="0.6875rem" strokeWidth={2.4} />
        </button>
      </span>
    </div>
  );
}
