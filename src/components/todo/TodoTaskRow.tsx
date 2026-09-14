import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StarButton } from '../ui/star';
import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import { isDone, GENERAL } from '../../todoLogic';
import { colorHex } from '../../colors';
import type { Todo } from '../../types';
import InlineEditor from '../InlineEditor';
import type { RowClickResult } from '../bulk/useListSelection';

interface TodoTaskRowProps {
  task: Todo;
  /** The "Advanced…" path: the full modal. */
  onEdit: (task: Todo) => void;
  done?: boolean;
  /** Whether the inline editor is open under this row (one at a time, owned by the list). */
  expanded?: boolean;
  onToggleExpand?: () => void;
  selected?: boolean;
  /** Ctrl/Shift selection; a `'plain'` result means the click should expand instead. */
  onRowClick?: (e: React.MouseEvent) => RowClickResult;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function getDueDateLabel(task: Todo): string {
  if (!task.dueDate) return '';

  const today = fmt(new Date());
  const tomorrow = fmt(new Date(Date.now() + 86400000));

  if (task.dueDate === today) return 'Today';
  if (task.dueDate === tomorrow) return 'Tomorrow';

  // Format as "Aug 30" or similar
  const date = new Date(task.dueDate + 'T00:00:00');
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = date.getDate();
  return `${month} ${day}`;
}

export default function TodoTaskRow({
  task,
  onEdit,
  done: forceDone,
  expanded = false,
  onToggleExpand,
  selected = false,
  onRowClick,
  onContextMenu,
}: TodoTaskRowProps) {
  const { toggleTodo, updateTodo, categoryById } = useApp();
  const done = forceDone || isDone(task);
  const hex = colorHex(task.colorKey);
  const todayStr = fmt(new Date());
  const dueLabel = getDueDateLabel(task);
  const category = categoryById(task.category);
  const categoryName = category?.name ?? GENERAL;

  const handleToggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    const toggleDate = done ? undefined : (task.dueDate ?? todayStr);
    if (toggleDate) {
      toggleTodo(task.id, toggleDate);
    }
  };

  const handleToggleImportant = () => updateTodo(task.id, { important: !task.important });

  // A plain click (no Ctrl/Shift) opens the inline editor; the modifiers
  // belong to the list's selection and never expand.
  const handleClick = (e: React.MouseEvent) => {
    const result = onRowClick ? onRowClick(e) : 'plain';
    if (result === 'plain') onToggleExpand?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleExpand?.();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      data-selected={selected || undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={onContextMenu}
      className={cn(
        'group row-hover flex flex-wrap items-center gap-2.5 px-3 py-2.5 cursor-pointer',
        done && 'opacity-55',
        selected && 'bg-accent-tint',
      )}
    >
      {/* Star (Importance) */}
      <StarButton important={task.important} onToggle={handleToggleImportant} />

      {/* Checkbox */}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.name}" not done` : `Mark "${task.name}" done`}
        onClick={handleToggleDone}
        className="w-[1.125rem] h-[1.125rem] flex-shrink-0 border border-line-strong flex items-center justify-center cursor-pointer transition-all"
        // dynamic: the to-do's own colour
        style={{
          backgroundColor: done ? hex : 'transparent',
          borderColor: done ? hex : 'var(--t-border-strong)',
        }}
      >
        {done && <Check size="0.6875rem" strokeWidth={3} className="text-on-accent" />}
      </button>

      {/* Title & Meta */}
      <div className="flex-1 min-w-0">
        <p
          className={`text-ui font-body truncate transition-all ${
            done ? 'text-ink-muted line-through opacity-60' : 'text-ink'
          }`}
        >
          {task.name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className="w-[0.4375rem] h-[0.4375rem] flex-shrink-0"
            // dynamic: the category's colour (neutral for General)
            style={{ backgroundColor: hex }}
          />
          <span className="text-meta text-ink-muted">
            {categoryName}
            {dueLabel && ` · ${dueLabel}`}
          </span>
        </div>
      </div>

      {/* The light editor, under the row; the modal stays the "Advanced" path. */}
      {expanded && (
        <InlineEditor todo={task} autoFocusTitle onAdvanced={() => onEdit(task)} className="basis-full pt-1" />
      )}
    </div>
  );
}

/**
 * Edit/delete pair shared by the habit and task rows.
 *
 * Words, not icons, and the block is *always laid out* — only its opacity
 * changes. Revealing it with `hidden`/`flex` re-flowed the whole row on hover,
 * which shifted the name and status text sideways every time the pointer
 * crossed a habit. Reserving the space costs a little width and nothing else.
 *
 * There is no hover on a touchscreen, so below the phone breakpoint the pair
 * stays visible — otherwise editing a to-do would be unreachable there.
 */
const ACTION = 'micro-label transition-colors';

export function RowActions({ todo, onEdit }: { todo: Todo; onEdit: (t: Todo) => void }) {
  const { deleteTodo } = useApp();
  return (
    <span className="flex items-center gap-xs flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit(todo);
        }}
        className={`${ACTION} text-ink-muted hover:text-ink`}
      >
        Edit
      </button>
      <span className="text-xs text-ink-muted select-none">·</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          deleteTodo(todo.id);
        }}
        className={`${ACTION} text-ink-muted hover:text-danger`}
      >
        Delete
      </button>
    </span>
  );
}
