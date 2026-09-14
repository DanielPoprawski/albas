import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StarButton } from '../ui/star';
import { useApp } from '../../context/AppContext';
import { completionDay, dueLabel, GENERAL, isDone } from '../../todoLogic';
import { colorHex } from '../../colors';
import type { Todo } from '../../types';
import InlineEditor from '../InlineEditor';
import type { RowClickResult } from '../bulk/useListSelection';

interface TaskRowProps {
  task: Todo;
  /** `fmt(new Date())`, computed once by the list rather than once per row. */
  today: string;
  /** The "Advanced…" path: the full modal. */
  onEdit: (task: Todo) => void;
  /** Whether the inline editor is open under this row (one at a time, owned by the list). */
  expanded?: boolean;
  onToggleExpand?: () => void;
  /**
   * Category dot and name in the meta line. For a list that mixes categories
   * (the To-Do page's "All"); a list already grouped by category leaves it off.
   */
  showCategory?: boolean;
  /** The Edit · Delete pair at the row's end — the phone dashboard, which has no context menu. */
  actions?: boolean;
  selected?: boolean;
  /** Ctrl/Shift selection; a `'plain'` result means the click should expand instead. */
  onRowClick?: (e: React.MouseEvent) => RowClickResult;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Row padding overrides for denser panels. */
  className?: string;
}

/**
 * One-time to-do, the same row on every surface: star, checkbox, name, then a
 * meta line (category, due moment). The checkbox is the only thing that
 * toggles done — on the day `completionDay` says — and the row itself opens
 * the inline editor beneath it.
 */
export default function TaskRow({
  task,
  today,
  onEdit,
  expanded = false,
  onToggleExpand,
  showCategory = false,
  actions = false,
  selected = false,
  onRowClick,
  onContextMenu,
  className,
}: TaskRowProps) {
  const { toggleTodo, updateTodo, categoryById } = useApp();
  const done = isDone(task);
  const hex = colorHex(task.colorKey);
  const due = dueLabel(task, today);
  const category = showCategory ? (categoryById(task.category)?.name ?? GENERAL) : null;

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
        className,
      )}
    >
      <StarButton important={task.important} onToggle={() => updateTodo(task.id, { important: !task.important })} />

      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.name}" not done` : `Mark "${task.name}" done`}
        onClick={(e) => {
          e.stopPropagation();
          toggleTodo(task.id, completionDay(task, today));
        }}
        className="w-[1.125rem] h-[1.125rem] flex-shrink-0 border border-line-strong flex items-center justify-center cursor-pointer transition-all"
        // dynamic: the to-do's own colour
        style={{
          backgroundColor: done ? hex : 'transparent',
          borderColor: done ? hex : 'var(--t-border-strong)',
        }}
      >
        {done && <Check size="0.6875rem" strokeWidth={3} className="text-on-accent" />}
      </button>

      <div className="flex-1 min-w-0">
        <p
          className={cn('text-ui font-body truncate transition-all', done ? 'text-ink-muted line-through' : 'text-ink')}
        >
          {task.name}
        </p>
        {(category || due) && (
          <div className="flex items-center gap-1.5 mt-0.5 text-meta text-ink-muted">
            {category && (
              <>
                <span
                  className="w-[0.4375rem] h-[0.4375rem] flex-shrink-0"
                  // dynamic: the category's colour (neutral for General)
                  style={{ backgroundColor: hex }}
                />
                <span>{category}</span>
              </>
            )}
            {category && due && <span>·</span>}
            {due && (
              <span
                className={cn('tabular-nums', due.late && !done && 'font-bold text-danger')}
                title={due.late && !done ? 'Overdue' : undefined}
              >
                {due.text}
              </span>
            )}
          </div>
        )}
      </div>

      {actions && <RowActions todo={task} onEdit={onEdit} />}

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
        type="button"
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
        type="button"
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
