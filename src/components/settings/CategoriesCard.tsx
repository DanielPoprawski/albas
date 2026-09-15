import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { colorHex, DEFAULT_COLOR } from '../../colors';
import { Checkbox } from '../ui/checkbox';
import { Button, IconButton } from '../ui/button';
import { cn } from '@/lib/utils';
import { ColorPicker, inputClass } from '../forms/shared';
import { byCategoryOrder, moveCategory, newCategory, toggleScope } from '../../categoryLogic';
import { SCOPE_OPTIONS } from '../sidebar/CategoryMenu';
import { Card } from './shared';

/**
 * User-managed, synced groupings for events/tasks/habits (Phase K). Rows are
 * kept in the user's manual `sort` order; reordering swaps two rows' `sort`
 * values rather than renumbering the whole list. Delete asks inline
 * ("Delete? Yes/No") instead of `window.confirm` — the rest of the app never
 * uses the native dialog, and `deleteCategory` already clears the id off
 * every referencing to-do/event so nothing is silently orphaned.
 */
export function CategoriesCard() {
  const { categories, addCategory, updateCategory, deleteCategory } = useApp();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(DEFAULT_COLOR);
  const [newColorOpen, setNewColorOpen] = useState(false);

  const sorted = [...categories].sort(byCategoryOrder);

  function move(id: string, dir: -1 | 1) {
    const swap = moveCategory(sorted, id, dir);
    if (!swap) return;
    for (const { id: target, ...patch } of swap) updateCategory(target, patch);
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    addCategory(newCategory(name, newColor, categories));
    setNewName('');
    setNewColorOpen(false);
  }

  return (
    <Card title="Categories" span>
      <p className="setting-desc mb-4">
        Shared groupings for events, tasks and habits — pick which surfaces each one appears on.
      </p>
      <div className="space-y-sm">
        {sorted.map((cat, i) => (
          <div key={cat.id}>
            <div className="flex items-center gap-sm flex-wrap">
              <button
                type="button"
                onClick={() => setEditingColorId(editingColorId === cat.id ? null : cat.id)}
                aria-label="Change color"
                title={colorHex(cat.colorKey)}
                className="w-[1.375rem] h-[1.375rem] flex-shrink-0 border border-line transition-transform hover:scale-110"
                // dynamic: the category's own colour
                style={{ background: colorHex(cat.colorKey) }}
              />
              <input
                className={`${inputClass} flex-[1_1_10rem] min-w-32`}
                value={cat.name}
                onChange={(e) => updateCategory(cat.id, { name: e.target.value })}
              />
              <div className="flex items-center gap-sm flex-wrap">
                {SCOPE_OPTIONS.map(({ value, label }) => (
                  <label
                    key={value}
                    className="flex items-center gap-[0.3125rem] text-xs text-ink-secondary cursor-pointer"
                  >
                    <Checkbox
                      checked={cat.scopes.includes(value)}
                      onCheckedChange={() => updateCategory(cat.id, { scopes: toggleScope(cat, value) })}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-[0.125rem] flex-shrink-0">
                <IconButton onClick={() => move(cat.id, -1)} disabled={i === 0} aria-label="Move up">
                  <ChevronUp size="0.875rem" />
                </IconButton>
                <IconButton onClick={() => move(cat.id, 1)} disabled={i === sorted.length - 1} aria-label="Move down">
                  <ChevronDown size="0.875rem" />
                </IconButton>
              </div>
              {confirmId === cat.id ? (
                <span className="flex items-center gap-xs text-sm flex-shrink-0">
                  Delete?
                  <button
                    type="button"
                    onClick={() => {
                      deleteCategory(cat.id);
                      setConfirmId(null);
                    }}
                    className="font-semibold text-danger hover:underline"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="text-ink-muted hover:text-ink hover:underline"
                  >
                    No
                  </button>
                </span>
              ) : (
                <IconButton onClick={() => setConfirmId(cat.id)} aria-label={`Delete ${cat.name}`}>
                  <Trash2 size="0.875rem" />
                </IconButton>
              )}
            </div>
            {editingColorId === cat.id && (
              <div className="mt-xs mb-xs pl-[1.875rem]">
                <ColorPicker value={cat.colorKey} onChange={(hex) => updateCategory(cat.id, { colorKey: hex })} />
              </div>
            )}
          </div>
        ))}

        {sorted.length === 0 && <p className="text-sm text-ink-muted">No categories yet — add one below.</p>}

        {/* Add row */}
        <div className={cn('pt-xs', sorted.length > 0 && 'border-t border-line')}>
          <div className="flex items-center gap-sm flex-wrap">
            <button
              type="button"
              onClick={() => setNewColorOpen((v) => !v)}
              aria-label="Pick color for new category"
              title={newColor}
              className="w-[1.375rem] h-[1.375rem] flex-shrink-0 border border-line transition-transform hover:scale-110"
              // dynamic: the colour picked for the new category
              style={{ background: newColor }}
            />
            <input
              className={`${inputClass} flex-[1_1_10rem] min-w-32`}
              placeholder="New category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
            <Button size="sm" onClick={handleAdd} disabled={!newName.trim()} className="gap-xs flex-shrink-0">
              <Plus size="0.8125rem" />
              Add category
            </Button>
          </div>
          {newColorOpen && (
            <div className="mt-xs pl-[1.875rem]">
              <ColorPicker value={newColor} onChange={setNewColor} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
