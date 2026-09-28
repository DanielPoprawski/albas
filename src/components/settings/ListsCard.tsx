import { useState } from 'react';
import { Icon } from '../ui/icon';
import { useApp } from '../../context/AppContext';
import { Button, IconButton } from '../ui/button';
import { cn } from '@/lib/utils';
import { inputClass } from '../forms/shared';
import { bySort, moveSorted, nextSort } from '../../seedLogic';
import { Card } from './shared';

/** The inline "Delete? Yes / No" every organiser row asks instead of `window.confirm`. */
export function DeleteRow({
  armed,
  onArm,
  onConfirm,
  label,
}: {
  armed: boolean;
  onArm: (armed: boolean) => void;
  onConfirm: () => void;
  label: string;
}) {
  if (!armed) {
    return (
      <IconButton onClick={() => onArm(true)} aria-label={`Delete ${label}`}>
        <Icon name="delete" size="0.875rem" />
      </IconButton>
    );
  }
  return (
    <span className="flex items-center gap-xs text-sm flex-shrink-0">
      Delete?
      <button
        type="button"
        onClick={() => {
          onConfirm();
          onArm(false);
        }}
        className="font-semibold text-danger hover:underline"
      >
        Yes
      </button>
      <button type="button" onClick={() => onArm(false)} className="text-ink-muted hover:text-ink hover:underline">
        No
      </button>
    </span>
  );
}

/** The up/down pair that swaps two rows' `sort` values (`moveSorted`), never renumbering the whole list. */
export function MoveButtons({
  index,
  length,
  onMove,
}: {
  index: number;
  length: number;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="flex items-center gap-[0.125rem] flex-shrink-0">
      <IconButton onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">
        <Icon name="expand_less" size="0.875rem" />
      </IconButton>
      <IconButton onClick={() => onMove(1)} disabled={index === length - 1} aria-label="Move down">
        <Icon name="expand_more" size="0.875rem" />
      </IconButton>
    </div>
  );
}

/**
 * Lists: the exclusive folders a seed can sit in. Name only — colour and
 * icon belong to tags. Rows keep the user's manual `sort` order;
 * `deleteList` already clears the id off every seed in it.
 */
export function ListsCard() {
  const { lists, addList, updateList, deleteList } = useApp();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const sorted = [...lists].sort(bySort);

  function move(id: string, dir: -1 | 1) {
    for (const { id: target, sort } of moveSorted(sorted, id, dir) ?? []) updateList(target, { sort });
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    addList({ name, sort: nextSort(lists) });
    setNewName('');
  }

  return (
    <Card title="Lists" span>
      <p className="setting-desc mb-4">Folders for your seeds — a seed sits in one list or none.</p>
      <div className="space-y-sm">
        {sorted.map((l, i) => (
          <div key={l.id} className="flex items-center gap-sm flex-wrap">
            <input
              className={`${inputClass} flex-[1_1_10rem] min-w-32`}
              value={l.name}
              aria-label="List name"
              onChange={(e) => updateList(l.id, { name: e.target.value })}
            />
            <MoveButtons index={i} length={sorted.length} onMove={(dir) => move(l.id, dir)} />
            <DeleteRow
              armed={confirmId === l.id}
              onArm={(armed) => setConfirmId(armed ? l.id : null)}
              onConfirm={() => deleteList(l.id)}
              label={l.name}
            />
          </div>
        ))}

        {sorted.length === 0 && <p className="text-sm text-ink-muted">No lists yet — add one below.</p>}

        <div className={cn('pt-xs flex items-center gap-sm flex-wrap', sorted.length > 0 && 'border-t border-line')}>
          <input
            className={`${inputClass} flex-[1_1_10rem] min-w-32`}
            placeholder="New list name"
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
            <Icon name="add" size="0.8125rem" />
            Add list
          </Button>
        </div>
      </div>
    </Card>
  );
}
