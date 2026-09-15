import { useState, type KeyboardEvent } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { byCategoryOrder, moveCategory, newCategory, nextColor, toggleScope } from '../../categoryLogic';
import { colorHex, DEFAULT_COLOR } from '../../colors';
import { useApp } from '../../context/AppContext';
import { GENERAL, isDone } from '../../todoLogic';
import type { Category } from '../../types';
import { CategoryMenu, ColorPopover } from './CategoryMenu';

/** The tick box at the head of a category row; `checked` fills it in. */
const CHECK = 'flex size-3.5 shrink-0 items-center justify-center border border-line-strong text-xs text-accent';
const CHECKED = 'border-accent bg-accent text-on-accent';
const NAME = 'min-w-0 flex-1 truncate text-ink';
const COUNT = 'text-xs text-ink-muted';
const ROW = 'sidebar-item group w-full gap-2 text-left';
/** The rename / new-name input: a `field-input` slimmed to the row's height. */
const INLINE_INPUT = 'field-input min-w-0 flex-1 px-1 py-0 text-sm leading-5';

/** Enter/Space on a `role="button"` div, but only when the div itself is what has focus. */
function onRowKey(e: KeyboardEvent<HTMLDivElement>, action: () => void) {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    action();
  }
}

/**
 * The sidebar's Categories section, on every route: a tick per category (and
 * one for General) that hides or shows it in whichever list is on screen,
 * via the shared hidden set in `UiContext`. The To-Do route adds a Completed
 * row, since only it has a Completed section. Each category row also carries
 * its management (rename, color, order, scopes, delete) behind a hover "…"
 * or a right-click, so Settings is not the only place a category is edited.
 */
export default function SidebarCategories({ showCompletedRow }: { showCompletedRow: boolean }) {
  const {
    todos,
    categories,
    addCategory,
    updateCategory,
    deleteCategory,
    hiddenCategoryIds,
    toggleHiddenCategory,
    setHiddenCategoryIds,
    showCompleted,
    setShowCompleted,
  } = useApp();
  const sorted = categories.slice().sort(byCategoryOrder);

  const [open, setOpen] = useState(true);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [colorId, setColorId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [newColorOpen, setNewColorOpen] = useState(false);

  // Open to-dos per category, General included.
  const openCount = (catId: string): number => todos.filter((t) => !isDone(t) && t.category === catId).length;
  const completedCount = todos.filter((t) => t.schedule.type === 'once' && isDone(t)).length;

  const allChecked = hiddenCategoryIds.size === 0;
  const toggleAll = () => setHiddenCategoryIds(allChecked ? new Set(['', ...sorted.map((c) => c.id)]) : new Set());

  function move(id: string, dir: -1 | 1) {
    const swap = moveCategory(sorted, id, dir);
    if (!swap) return;
    for (const { id: target, ...patch } of swap) updateCategory(target, patch);
  }

  function commitRename(cat: Category, raw: string) {
    const name = raw.trim();
    if (name && name !== cat.name) updateCategory(cat.id, { name });
    setRenamingId(null);
  }

  function startAdding() {
    setNewName('');
    setNewColor(nextColor(sorted));
    setAdding(true);
  }

  function commitAdd() {
    const name = newName.trim();
    if (!name) return;
    addCategory(newCategory(name, newColor, categories));
    setAdding(false);
    setNewColorOpen(false);
  }

  const tick = (checked: boolean, color: string | null) => (
    <span
      className={cn(CHECK, checked && CHECKED, checked && !color && 'border-ink-secondary bg-ink-secondary')}
      // The tick takes the category's own colour rather than the accent,
      // which is how a checked row reads as *that* category.
      // dynamic: the category's own colour
      style={checked && color ? { background: color, borderColor: color } : undefined}
    >
      {checked && '✓'}
    </span>
  );

  const swatch = (color: string | null) => (
    <span
      className={cn('size-2 shrink-0', !color && 'bg-ink-secondary')}
      // dynamic: the category's own hex (General is the neutral token)
      style={color ? { background: color } : undefined}
    />
  );

  const generalChecked = !hiddenCategoryIds.has('');

  return (
    <>
      <button
        type="button"
        className="sidebar-title flex w-full cursor-pointer items-center gap-1 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown
          size="0.75rem"
          strokeWidth={3}
          aria-hidden="true"
          className={cn('transition-transform duration-150', !open && '-rotate-90')}
        />
        Categories
      </button>

      {open && (
        <>
          <button type="button" className={ROW} aria-pressed={allChecked} onClick={toggleAll}>
            <span className={cn(CHECK, allChecked && CHECKED)}>{allChecked && '✓'}</span>
            <span className={NAME}>All</span>
          </button>

          <button type="button" className={ROW} aria-pressed={generalChecked} onClick={() => toggleHiddenCategory('')}>
            {tick(generalChecked, null)}
            {swatch(null)}
            <span className={NAME}>{GENERAL}</span>
            <span className={COUNT}>{openCount('')}</span>
          </button>

          {sorted.map((cat, i) => {
            const checked = !hiddenCategoryIds.has(cat.id);
            const color = colorHex(cat.colorKey);

            if (confirmId === cat.id) {
              return (
                <div key={cat.id} className={cn(ROW, 'text-sm')}>
                  {swatch(color)}
                  <span className="min-w-0 flex-1 truncate">Delete?</span>
                  <button
                    type="button"
                    className="font-semibold text-danger hover:underline"
                    onClick={() => {
                      deleteCategory(cat.id);
                      setConfirmId(null);
                    }}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className="text-ink-muted hover:text-ink hover:underline"
                    onClick={() => setConfirmId(null)}
                  >
                    No
                  </button>
                </div>
              );
            }

            return (
              <ColorPopover
                key={cat.id}
                open={colorId === cat.id}
                onOpenChange={(o) => setColorId(o ? cat.id : null)}
                value={cat.colorKey}
                onChange={(hex) => updateCategory(cat.id, { colorKey: hex })}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className={ROW}
                  aria-pressed={checked}
                  onClick={() => toggleHiddenCategory(cat.id)}
                  onKeyDown={(e) => onRowKey(e, () => toggleHiddenCategory(cat.id))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuId(cat.id);
                  }}
                >
                  {tick(checked, color)}
                  {swatch(color)}
                  {renamingId === cat.id ? (
                    <input
                      autoFocus
                      className={INLINE_INPUT}
                      defaultValue={cat.name}
                      aria-label={`Rename ${cat.name}`}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => commitRename(cat, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') commitRename(cat, e.currentTarget.value);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <span className={NAME}>{cat.name}</span>
                  )}
                  <span className={COUNT}>{openCount(cat.id)}</span>
                  <CategoryMenu
                    category={cat}
                    open={menuId === cat.id}
                    onOpenChange={(o) => setMenuId(o ? cat.id : null)}
                    canMoveUp={i > 0}
                    canMoveDown={i < sorted.length - 1}
                    onRename={() => setRenamingId(cat.id)}
                    onColor={() => setColorId(cat.id)}
                    onMove={(dir) => move(cat.id, dir)}
                    onToggleScope={(scope) => updateCategory(cat.id, { scopes: toggleScope(cat, scope) })}
                    onDelete={() => setConfirmId(cat.id)}
                  />
                </div>
              </ColorPopover>
            );
          })}

          {adding ? (
            <div className={cn(ROW, 'cursor-default')}>
              <ColorPopover open={newColorOpen} onOpenChange={setNewColorOpen} value={newColor} onChange={setNewColor}>
                <button
                  type="button"
                  aria-label="Pick color for new category"
                  className="flex size-3.5 shrink-0 items-center justify-center"
                  onClick={() => setNewColorOpen((v) => !v)}
                >
                  {swatch(newColor)}
                </button>
              </ColorPopover>
              <input
                autoFocus
                className={INLINE_INPUT}
                placeholder="New category"
                aria-label="New category name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitAdd();
                  }
                  if (e.key === 'Escape') setAdding(false);
                }}
                onBlur={() => {
                  // An empty row left behind is noise; a typed name waits for Enter
                  // (or the swatch), since the picker steals focus.
                  if (!newName.trim() && !newColorOpen) setAdding(false);
                }}
              />
            </div>
          ) : (
            <button type="button" className={ROW} onClick={startAdding}>
              <Plus size="0.875rem" strokeWidth={3} aria-hidden="true" />
              <span className={NAME}>New category</span>
            </button>
          )}

          {showCompletedRow && (
            <button
              type="button"
              className={ROW}
              aria-pressed={showCompleted}
              onClick={() => setShowCompleted(!showCompleted)}
            >
              <span className={cn(CHECK, showCompleted && CHECKED)}>{showCompleted && '✓'}</span>
              <span className={NAME}>Completed</span>
              <span className={COUNT}>{completedCount}</span>
            </button>
          )}
        </>
      )}
    </>
  );
}
