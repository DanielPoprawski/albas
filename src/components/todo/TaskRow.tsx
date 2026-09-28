import { Icon } from '../ui/icon';
import { cn } from '@/lib/utils';
import { StarButton } from '../ui/star';
import { useApp } from '../../context/AppContext';
import { completionDay, dueLabel, isDone } from '../../todoLogic';
import { colorHex } from '../../colors';
import type { Todo } from '../../types';
import InlineEditor from '../InlineEditor';
import type { RowClickResult } from '../bulk/useListSelection';
import { useIsCoarsePointer } from '../../useMedia';

interface TaskRowProps {
  task: Todo;
  /** `fmt(new Date())`, computed once by the list rather than once per row. */
  today: string;
  /** The "Advanced…" path: the full modal. */
  onEdit: (task: Todo) => void;
  /** Whether the inline editor is open under this row (one at a time, owned by the list). */
  expanded?: boolean;
  onToggleExpand?: () => void;
  selected?: boolean;
  /** Ctrl/Shift selection; a `'plain'` result means the click should expand instead. */
  onRowClick?: (e: React.MouseEvent) => RowClickResult;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Row padding overrides for denser panels. */
  className?: string;
}

/**
 * One-time to-do, the same row on every surface: star, checkbox, name, then a
 * meta line (due moment). The checkbox is the only thing that
 * toggles done — on the day `completionDay` says — and the row itself opens
 * the inline editor beneath it. On touch there is no inline editor: the row
 * opens the full modal, which is the only editor a phone gets.
 */
export default function TaskRow({
  task,
  today,
  onEdit,
  expanded = false,
  onToggleExpand,
  selected = false,
  onRowClick,
  onContextMenu,
  className,
}: TaskRowProps) {
  const { toggleTodo, updateTodo } = useApp();
  const coarse = useIsCoarsePointer();
  const done = isDone(task);
  const hex = colorHex(task.colorKey);
  const due = dueLabel(task, today);

  // A plain click (no Ctrl/Shift) opens the inline editor, or the modal on
  // touch; the modifiers belong to the list's selection and never expand.
  const handleClick = (e: React.MouseEvent) => {
    const result = onRowClick ? onRowClick(e) : 'plain';
    if (result === 'plain') {
      if (coarse) onEdit(task);
      else onToggleExpand?.();
    }
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
        'group flex flex-wrap items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors hover:bg-subtle',
        done && 'opacity-55',
        selected && 'bg-accent/10 ring-1 ring-inset ring-accent/30 border-l-2 border-accent',
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
        {done && <Icon name="check" size="0.6875rem" className="text-on-accent" />}
      </button>

      <div className="flex-1 min-w-0">
        <p
          className={cn('text-ui font-body truncate transition-all', done ? 'text-ink-muted line-through' : 'text-ink')}
        >
          {task.name}
        </p>
        {due && (
          <p
            className={cn('mt-0.5 text-meta text-ink-muted tabular-nums', due.late && !done && 'font-bold text-danger')}
            title={due.late && !done ? 'Overdue' : undefined}
          >
            {due.text}
          </p>
        )}
      </div>

      {/* The light editor, under the row; the modal stays the "Advanced" path. */}
      {expanded && !coarse && (
        <InlineEditor todo={task} autoFocusTitle onAdvanced={() => onEdit(task)} className="basis-full pt-1" />
      )}
    </div>
  );
}
