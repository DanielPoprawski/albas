import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { plural } from './useBulkActions';

/**
 * The two-step delete every bulk surface shows: a danger button that turns
 * into "Delete N items? Yes / No". It arms itself and disarms whenever the
 * selection size changes, so a stale "Yes" can never delete a different set.
 */
export function DeleteConfirm({
  n,
  onDelete,
  className,
}: {
  n: number;
  onDelete: () => void;
  /** The armed prompt's wrapper; the button itself takes `button-small button-danger`. */
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [n]);

  if (armed) {
    return (
      <span className={cn('flex items-center gap-3 text-xs', className)}>
        <span className="text-ink">Delete {plural(n, 'item')}?</span>
        <button
          type="button"
          onClick={() => {
            setArmed(false);
            onDelete();
          }}
          className="font-bold text-danger hover:underline"
        >
          Yes
        </button>
        <button type="button" onClick={() => setArmed(false)} className="text-ink-secondary hover:underline">
          No
        </button>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => setArmed(true)} className={cn('button-small button-danger', className)}>
      Delete{n > 1 ? ` ${plural(n, 'item')}` : ''}
    </button>
  );
}

/** The one-line strip a bulk action posts ("Moved 3 items to Work"), or nothing. */
export function BulkNotice({ notice, className }: { notice: string | null; className?: string }) {
  if (!notice) return null;
  return (
    <div
      className={cn(
        'border-t border-accent-line bg-selection px-3 py-1.5 text-xs font-semibold text-selection-ink',
        className,
      )}
    >
      {notice}
    </div>
  );
}
