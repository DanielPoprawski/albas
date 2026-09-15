import { CATEGORY_PALETTE, colorHex, DEFAULT_COLOR } from './colors';
import type { Category, CategoryScope, NewCategory } from './types';

/** Every surface a category can appear on — what a new one is offered for until narrowed in Settings. */
export const ALL_SCOPES: CategoryScope[] = ['calendar', 'tasks', 'habits'];

/** A partial category update addressed by id, as `updateCategory` takes it. */
export type CategoryPatch = Partial<Category> & { id: string };

/** The user's manual order (Settings' up/down), name as the tiebreak so equal sorts stay stable. */
export function byCategoryOrder(a: Category, b: Category): number {
  return a.sort - b.sort || a.name.localeCompare(b.name);
}

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

/** `scopes` with `scope` flipped on or off. */
export function toggleScope(cat: Category, scope: CategoryScope): CategoryScope[] {
  return cat.scopes.includes(scope) ? cat.scopes.filter((s) => s !== scope) : [...cat.scopes, scope];
}

/** The first palette hue no category wears yet, so new ones start distinct. */
export function nextColor(categories: Category[]): string {
  const used = new Set(categories.map((c) => colorHex(c.colorKey).toLowerCase()));
  return CATEGORY_PALETTE.find((hex) => !used.has(hex)) ?? DEFAULT_COLOR;
}

/**
 * A category to append after every existing one. `sort` is one past the
 * highest in use — not the list length, which collides with existing values
 * once anything has been reordered or a scoped subset was counted.
 */
export function newCategory(
  name: string,
  colorKey: string,
  existing: Category[],
  scopes: CategoryScope[] = ALL_SCOPES,
): NewCategory {
  const sort = existing.reduce((max, c) => Math.max(max, c.sort + 1), 0);
  return { name: name.trim(), colorKey, scopes, sort };
}
