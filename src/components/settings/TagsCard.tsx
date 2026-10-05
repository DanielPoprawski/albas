import { useState } from 'react';
import { Icon } from '../ui/icon';
import { useApp } from '../../context/AppContext';
import { COLOR_CLASSES, DEFAULT_COLOR } from '../../colors';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { ColorPicker, inputClass } from '../forms/shared';
import { bySort, moveSorted, nextSort } from '../../seedLogic';
import { TAG_ICONS } from '../../tagIcons';
import type { ColorKey } from '../../types';
import { IconPicker } from '../sidebar/RowMenu';
import { DeleteRow, MoveButtons } from './ListsCard';
import { Card } from './shared';

/** The tag's swatch-with-icon button that opens its colour and icon pickers. */
function TagMark({
  color,
  icon,
  open,
  onClick,
}: {
  color: ColorKey;
  icon: string;
  open: boolean;
  onClick: () => void;
}) {
  const c = COLOR_CLASSES[color];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label="Change colour and icon"
      className={cn(
        'flex size-[1.375rem] flex-shrink-0 items-center justify-center border transition-transform hover:scale-110',
        c.tint,
        c.line,
        c.ink,
      )}
    >
      <Icon name={icon} size="0.875rem" />
    </button>
  );
}

/**
 * Tags: the labels a seed can carry several of, each with a colour and an
 * icon. The last tag on a seed paints it unless the seed has a colour of its
 * own. `deleteTag` already drops the id from every seed carrying it.
 */
export function TagsCard() {
  const { tags, addTag, updateTag, deleteTag } = useApp();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<ColorKey>(DEFAULT_COLOR);
  const [newIcon, setNewIcon] = useState(TAG_ICONS[0]);
  const [newOpen, setNewOpen] = useState(false);

  const sorted = [...tags].sort(bySort);

  function move(id: string, dir: -1 | 1) {
    for (const { id: target, sort } of moveSorted(sorted, id, dir) ?? []) updateTag(target, { sort });
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    addTag({ name, color: newColor, icon: newIcon, sort: nextSort(tags), keywords: '' });
    setNewName('');
    setNewOpen(false);
  }

  const pickers = (color: ColorKey, icon: string, onColor: (c: ColorKey) => void, onIcon: (i: string) => void) => (
    <div className="mt-xs mb-xs flex flex-col gap-sm pl-[1.875rem]">
      <ColorPicker value={color} onChange={(key) => onColor(key ?? DEFAULT_COLOR)} />
      <IconPicker value={icon} onChange={onIcon} />
    </div>
  );

  return (
    <Card title="Tags" span>
      <p className="setting-desc mb-4">
        Labels with a colour and an icon. A seed can carry several; the last one colours it unless the seed has a colour
        of its own. A keyword found as a whole word in a title adds the tag.
      </p>
      <div className="space-y-sm">
        {sorted.map((t, i) => (
          <div key={t.id}>
            <div className="flex items-center gap-sm flex-wrap">
              <TagMark
                color={t.color}
                icon={t.icon}
                open={editingId === t.id}
                onClick={() => setEditingId(editingId === t.id ? null : t.id)}
              />
              <input
                className={`${inputClass} flex-[1_1_10rem] min-w-32`}
                value={t.name}
                aria-label="Tag name"
                onChange={(e) => updateTag(t.id, { name: e.target.value })}
              />
              <input
                className={`${inputClass} flex-[2_1_12rem] min-w-32`}
                value={t.keywords}
                placeholder="Keywords, comma-separated"
                aria-label="Tag keywords"
                onChange={(e) => updateTag(t.id, { keywords: e.target.value })}
              />
              <MoveButtons index={i} length={sorted.length} onMove={(dir) => move(t.id, dir)} />
              <DeleteRow
                armed={confirmId === t.id}
                onArm={(armed) => setConfirmId(armed ? t.id : null)}
                onConfirm={() => deleteTag(t.id)}
                label={t.name}
              />
            </div>
            {editingId === t.id &&
              pickers(
                t.color,
                t.icon,
                (color) => updateTag(t.id, { color }),
                (icon) => updateTag(t.id, { icon }),
              )}
          </div>
        ))}

        {sorted.length === 0 && <p className="text-sm text-ink-muted">No tags yet — add one below.</p>}

        <div className={cn('pt-xs', sorted.length > 0 && 'border-t border-line')}>
          <div className="flex items-center gap-sm flex-wrap">
            <TagMark color={newColor} icon={newIcon} open={newOpen} onClick={() => setNewOpen((v) => !v)} />
            <input
              className={`${inputClass} flex-[1_1_10rem] min-w-32`}
              placeholder="New tag name"
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
              Add tag
            </Button>
          </div>
          {newOpen && pickers(newColor, newIcon, setNewColor, setNewIcon)}
        </div>
      </div>
    </Card>
  );
}
