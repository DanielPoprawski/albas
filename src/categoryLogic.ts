import type { Category } from './types';

/** A partial category update addressed by id, as `updateCategory` takes it. */
export type CategoryPatch = Partial<Category> & { id: string };

/**
 * The two `sort` swaps that move a category one step up (`-1`) or down (`1`)
 * in an already-sorted list, or null at either end. Swapping two rows' `sort`
 * values instead of renumbering keeps the sync payload to two rows.
 */
export function moveCategory(sorted: Category[], id: string, dir: -1 | 1): [CategoryPatch, CategoryPatch] | null {
  const idx = sorted.findIndex((c) => c.id === id);
  const other = sorted[idx + dir];
  if (idx === -1 || !other) return null;
  const a = sorted[idx];
  return [
    { id: a.id, sort: other.sort },
    { id: other.id, sort: a.sort },
  ];
}
