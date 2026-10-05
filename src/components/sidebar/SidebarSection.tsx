import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { COLOR_CLASSES, DEFAULT_COLOR } from '../../colors';
import type { ColorKey } from '../../types';
import { ColorPopover } from '../forms/shared';
import { Icon } from '../ui/icon';
import { Dot } from '../ui/tag';
import { IconPopover, RowMenu } from './RowMenu';

/** The tick box at the head of a row; `checked` fills it in. */
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

export interface SectionRow {
  id: string;
  name: string;
  /** Tags carry a colour and an icon; lists carry neither. */
  color?: ColorKey;
  icon?: string;
}

/**
 * One sidebar section of visibility ticks — Lists or Tags — with an "All"
 * row, an inline "New …" row, and a per-row menu (rename, move, delete, and
 * for tags colour and icon). The hidden set lives in `UiContext`; this
 * component only owns its transient edit modes.
 */
export function SidebarSection({
  title,
  noun,
  rows,
  fixedRows = [],
  count,
  hidden,
  onToggle,
  setHidden,
  onAdd,
  onRename,
  onMove,
  onDelete,
  onColor,
  onIcon,
  footer,
}: {
  title: string;
  /** "list" / "tag" — the New… row's label. */
  noun: string;
  /** The managed rows, already in the user's order. */
  rows: SectionRow[];
  /** Rows shown first that can be hidden but not managed (the unfiled list). */
  fixedRows?: SectionRow[];
  count: (id: string) => number;
  hidden: Set<string>;
  onToggle: (id: string) => void;
  setHidden: (ids: Set<string>) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
  onColor?: (id: string, color: ColorKey) => void;
  onIcon?: (id: string, icon: string) => void;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [colorId, setColorId] = useState<string | null>(null);
  const [iconId, setIconId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const allIds = [...fixedRows, ...rows].map((r) => r.id);
  const allChecked = allIds.every((id) => !hidden.has(id));
  const toggleAll = () => {
    const next = new Set(hidden);
    for (const id of allIds) {
      if (allChecked) next.add(id);
      else next.delete(id);
    }
    setHidden(next);
  };

  function commitRename(row: SectionRow, raw: string) {
    const name = raw.trim();
    if (name && name !== row.name) onRename(row.id, name);
    setRenamingId(null);
  }

  function commitAdd() {
    const name = newName.trim();
    if (!name) return;
    onAdd(name);
    setAdding(false);
  }

  const mark = (row: SectionRow) => {
    const checked = !hidden.has(row.id);
    const c = row.color ? COLOR_CLASSES[row.color] : null;
    return (
      <>
        {/* The tick takes the row's own colour rather than the accent, which is how a checked row reads as *that* tag. */}
        <span className={cn(CHECK, checked && (c ? `${c.bg} ${c.line} text-on-accent` : CHECKED))}>
          {checked && '✓'}
        </span>
        {row.icon ? <Icon name={row.icon} size="0.875rem" className={c?.text} /> : <Dot color={row.color} />}
      </>
    );
  };

  const nameOrInput = (row: SectionRow) =>
    renamingId === row.id ? (
      <input
        autoFocus
        className={INLINE_INPUT}
        defaultValue={row.name}
        aria-label={`Rename ${row.name}`}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => commitRename(row, e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commitRename(row, e.currentTarget.value);
          if (e.key === 'Escape') setRenamingId(null);
        }}
      />
    ) : (
      <span className={NAME}>{row.name}</span>
    );

  return (
    <>
      <button
        type="button"
        className="sidebar-title flex w-full cursor-pointer items-center gap-1 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon
          name="expand_more"
          size="0.75rem"
          className={cn('transition-transform duration-150', !open && '-rotate-90')}
        />
        {title}
      </button>

      {open && (
        <>
          <button type="button" className={ROW} aria-pressed={allChecked} onClick={toggleAll}>
            <span className={cn(CHECK, allChecked && CHECKED)}>{allChecked && '✓'}</span>
            <span className={NAME}>All</span>
          </button>

          {fixedRows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={ROW}
              aria-pressed={!hidden.has(row.id)}
              onClick={() => onToggle(row.id)}
            >
              {mark(row)}
              <span className={NAME}>{row.name}</span>
              <span className={COUNT}>{count(row.id)}</span>
            </button>
          ))}

          {rows.map((row, i) => {
            if (confirmId === row.id) {
              return (
                <div key={row.id} className={cn(ROW, 'text-sm')}>
                  <Dot color={row.color} />
                  <span className="min-w-0 flex-1 truncate">Delete?</span>
                  <button
                    type="button"
                    className="font-semibold text-danger hover:underline"
                    onClick={() => {
                      onDelete(row.id);
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

            const body = (
              <div
                role="button"
                tabIndex={0}
                className={ROW}
                aria-pressed={!hidden.has(row.id)}
                onClick={() => onToggle(row.id)}
                onKeyDown={(e) => onRowKey(e, () => onToggle(row.id))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuId(row.id);
                }}
              >
                {mark(row)}
                {nameOrInput(row)}
                <span className={COUNT}>{count(row.id)}</span>
                <RowMenu
                  name={row.name}
                  open={menuId === row.id}
                  onOpenChange={(o) => setMenuId(o ? row.id : null)}
                  canMoveUp={i > 0}
                  canMoveDown={i < rows.length - 1}
                  onRename={() => setRenamingId(row.id)}
                  onMove={(dir) => onMove(row.id, dir)}
                  onDelete={() => setConfirmId(row.id)}
                  onColor={onColor && (() => setColorId(row.id))}
                  onIcon={onIcon && (() => setIconId(row.id))}
                />
              </div>
            );
            if (!onColor || !onIcon) return <div key={row.id}>{body}</div>;
            // The icon popover anchors on a plain div (no `asChild`), so the
            // colour popover inside it can still slot straight onto the row.
            return (
              <IconPopover
                key={row.id}
                open={iconId === row.id}
                onOpenChange={(o) => setIconId(o ? row.id : null)}
                value={row.icon ?? ''}
                onChange={(icon) => onIcon(row.id, icon)}
              >
                <ColorPopover
                  open={colorId === row.id}
                  onOpenChange={(o) => setColorId(o ? row.id : null)}
                  value={row.color ?? DEFAULT_COLOR}
                  onChange={(key) => onColor(row.id, key ?? DEFAULT_COLOR)}
                >
                  {body}
                </ColorPopover>
              </IconPopover>
            );
          })}

          {adding ? (
            <div className={cn(ROW, 'cursor-default')}>
              <Icon name="add" size="0.875rem" />
              <input
                autoFocus
                className={INLINE_INPUT}
                placeholder={`New ${noun}`}
                aria-label={`New ${noun} name`}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitAdd();
                  }
                  if (e.key === 'Escape') setAdding(false);
                }}
                // An empty row left behind is noise; a typed name waits for Enter.
                onBlur={() => {
                  if (!newName.trim()) setAdding(false);
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className={ROW}
              onClick={() => {
                setNewName('');
                setAdding(true);
              }}
            >
              <Icon name="add" size="0.875rem" />
              <span className={NAME}>New {noun}</span>
            </button>
          )}

          {footer}
        </>
      )}
    </>
  );
}

/** A plain tick row for the section footer (the To-Do page's "Completed" toggle). */
export function ToggleRow({
  label,
  checked,
  count,
  onToggle,
}: {
  label: string;
  checked: boolean;
  count: number;
  onToggle: () => void;
}) {
  return (
    <button type="button" className={ROW} aria-pressed={checked} onClick={onToggle}>
      <span className={cn(CHECK, checked && CHECKED)}>{checked && '✓'}</span>
      <span className={NAME}>{label}</span>
      <span className={COUNT}>{count}</span>
    </button>
  );
}
