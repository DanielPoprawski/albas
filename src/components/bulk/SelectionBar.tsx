import { cn } from '@/lib/utils';
import { useApp } from '../../context/AppContext';
import { GENERAL } from '../../todoLogic';
import { Select } from '../forms/shared';
import type { SearchItem } from '../search/types';
import { BulkNotice, DeleteConfirm } from './BulkControls';
import { plural, useBulkActions } from './useBulkActions';
import type { ListSelection } from './useListSelection';

const LINK = 'text-xs font-medium text-ink-secondary hover:text-ink hover:underline';
const ACTION = 'button-small';

/**
 * The strip under a list view's header while rows are selected: the count,
 * the three selection shortcuts, and the bulk edits from `useBulkActions` —
 * the same callbacks the search palette's panel runs.
 */
export default function SelectionBar({
  items,
  scope,
  selection,
  className,
}: {
  items: SearchItem[];
  scope: 'tasks' | 'habits';
  selection: ListSelection;
  className?: string;
}) {
  const { categoriesFor } = useApp();
  const actions = useBulkActions(items);
  const n = items.length;

  const categoryOptions = [
    { value: '', label: GENERAL },
    ...categoriesFor(scope).map((c) => ({ value: c.id, label: c.name })),
  ];
  // The category every selected to-do shares, or General when they differ.
  const first = items[0];
  const firstCategory = first && first.kind !== 'event' ? first.todo.category : '';
  const common = items.every((i) => i.kind !== 'event' && i.todo.category === firstCategory) ? firstCategory : '';

  return (
    <div className={cn('panel mx-4 mb-4 flex flex-col', className)} role="region" aria-label="Selection">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <span className="text-xs font-bold text-ink">{plural(n, 'item')} selected</span>
        <button type="button" onClick={selection.selectAll} className={LINK}>
          Select all
        </button>
        <button type="button" onClick={selection.deselectAll} className={LINK}>
          Deselect all
        </button>
        <button type="button" onClick={selection.selectGeneral} className={LINK}>
          Select General
        </button>

        <span className="h-4 w-px bg-line" aria-hidden />

        <button type="button" onClick={actions.complete} className={ACTION}>
          Complete
        </button>
        <button type="button" onClick={actions.uncomplete} className={ACTION}>
          Uncomplete
        </button>
        <button type="button" onClick={() => actions.setImportant(true)} className={ACTION}>
          Star
        </button>
        <button type="button" onClick={() => actions.setImportant(false)} className={ACTION}>
          Unstar
        </button>
        <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
          Category
          <Select options={categoryOptions} value={common} onChange={actions.applyCategory} className="w-auto" />
        </label>
        {scope === 'tasks' && (
          <>
            <button
              type="button"
              onClick={() => actions.applyShift(-1)}
              className={ACTION}
              aria-label="Shift one day earlier"
            >
              −1d
            </button>
            <button
              type="button"
              onClick={() => actions.applyShift(1)}
              className={ACTION}
              aria-label="Shift one day later"
            >
              +1d
            </button>
          </>
        )}

        <DeleteConfirm
          n={n}
          onDelete={() => {
            actions.applyDelete();
            selection.clear();
          }}
          className="ml-auto"
        />
      </div>
      <BulkNotice notice={actions.notice} />
    </div>
  );
}
