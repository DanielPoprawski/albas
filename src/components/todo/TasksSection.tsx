import { useState } from 'react';
import { Check, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StarButton } from '../ui/star';
import { useApp } from '../../context/AppContext';
import { fmt, shortDate } from '../../dates';
import { shortTime } from '../../eventLogic';
import { doneDate, groupTasks, isDone, isOverdue, byImportanceThenDue, GENERAL } from '../../todoLogic';
import { colorHex } from '../../colors';
import InlineEditor from '../InlineEditor';
import { RowActions } from './TodoTaskRow';
import { SectionHeading } from '../ui/section-heading';
import type { Todo } from '../../types';

/**
 * When a to-do is due, in the smallest form that still reads: a bare time for
 * today, a date otherwise, and both when it's a dated to-do with a time.
 * Overdue is the only state that gets colour — red earns its meaning by being
 * the one thing on the row that is ever red.
 */
function DueLabel({ todo }: { todo: Todo }) {
  const todayStr = fmt(new Date());
  if (!todo.dueDate && !todo.time) return null;

  const overdue = isOverdue(todo);
  const isToday = todo.dueDate === todayStr;
  const date = todo.dueDate ? (isToday ? 'today' : shortDate(todo.dueDate)) : '';
  const time = todo.time ? shortTime(todo.time) : '';
  const label = isToday && time ? time : [date, time].filter(Boolean).join(' ');

  return (
    <span
      className={`text-xs flex-shrink-0 tabular-nums ${overdue ? 'font-bold text-danger' : 'text-ink-muted'}`}
      title={overdue ? 'Overdue' : undefined}
    >
      {label}
    </span>
  );
}

/**
 * One-time to-do: checkbox, star, name, due moment. The checkbox is the only
 * thing that toggles done; the row itself opens the inline editor beneath it
 * (`RowActions`' "Edit" is the door to the full modal).
 */
function TaskRow({
  todo,
  onEdit,
  readOnly = false,
  expanded = false,
  onToggleExpand,
}: {
  todo: Todo;
  onEdit: (t: Todo) => void;
  readOnly?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const { toggleTodo, updateTodo } = useApp();
  const hex = colorHex(todo.colorKey);
  const todayStr = fmt(new Date());
  const done = isDone(todo);

  // clear where it was logged; log on the due day (or today for anytime to-dos)
  const toggleDate = done ? doneDate(todo)! : (todo.dueDate ?? todayStr);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleExpand?.();
    }
  };

  return (
    <div
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      aria-expanded={readOnly ? undefined : expanded}
      onClick={readOnly ? undefined : onToggleExpand}
      onKeyDown={handleKeyDown}
      className={cn(
        'group flex flex-wrap items-center gap-sm p-xs rounded-lg transition-all',
        !readOnly && 'hover:bg-subtle cursor-pointer',
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${todo.name}" not done` : `Mark "${todo.name}" done`}
        disabled={readOnly}
        onClick={(e) => {
          e.stopPropagation();
          toggleTodo(todo.id, toggleDate);
        }}
        className="h-5 w-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all"
        // dynamic: the to-do's own colour
        style={{ borderColor: hex, backgroundColor: done ? hex : 'transparent' }}
      >
        {done && <Check size="0.875rem" strokeWidth={3.5} className="text-on-accent" />}
      </button>

      {/* Starring is one click from the list — it's the field most likely to
          change after a to-do already exists. A shared row keeps the star only
          as a marker (when the owner starred it). */}
      {readOnly ? (
        todo.important && <Star size="1rem" className="flex-shrink-0 fill-star text-star-line" />
      ) : (
        <StarButton
          important={todo.important}
          onToggle={() => updateTodo(todo.id, { important: !todo.important })}
          className={todo.important ? '' : 'opacity-0 group-hover:opacity-100'}
        />
      )}

      <span
        className={`text-body-sm min-w-0 flex-1 truncate transition-all ${
          done ? 'text-ink-muted line-through opacity-60' : 'text-ink'
        }`}
      >
        {todo.name}
      </span>

      <DueLabel todo={todo} />
      {!readOnly && <RowActions todo={todo} onEdit={onEdit} />}

      {expanded && !readOnly && (
        <InlineEditor todo={todo} autoFocusTitle onAdvanced={() => onEdit(todo)} className="basis-full pt-1" />
      )}
    </div>
  );
}

/**
 * One-time to-dos, grouped by category with uncategorised first and completed
 * ones collected at the bottom. "Completed" is a section, not a category:
 * finishing a to-do shouldn't move it out of the group it belongs to, so it
 * keeps its category and star and simply stops competing for attention.
 */
export default function TasksSection({
  onEdit,
  todos: override,
  readOnly = false,
}: {
  onEdit: (t: Todo) => void;
  todos?: Todo[];
  readOnly?: boolean;
}) {
  const { todos: own, categoriesFor, categoryById, hiddenCategoryIds } = useApp();
  /** The one row whose inline editor is open. */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The sidebar's hidden categories apply to our own list only; a shared
  // list's category ids belong to its owner.
  const tasks = (override ?? own.filter((t) => !hiddenCategoryIds.has(t.category))).filter(
    (t) => t.schedule.type === 'once',
  );
  const rowProps = (todo: Todo) => ({
    todo,
    onEdit,
    readOnly,
    expanded: expandedId === todo.id,
    onToggleExpand: () => setExpandedId((cur) => (cur === todo.id ? null : todo.id)),
  });
  const order = categoriesFor('tasks').map((c) => c.id);
  const groups = groupTasks(
    tasks.filter((t) => !isDone(t)),
    order,
  );
  const completed = tasks.filter(isDone).sort(byImportanceThenDue);

  if (tasks.length === 0) return null;

  return (
    <div>
      {groups.map(({ category, todos: rows }) => (
        <div key={category || GENERAL} className="mb-md">
          <SectionHeading className="mb-xs">{categoryById(category)?.name ?? GENERAL}</SectionHeading>
          <div className="space-y-0.5">
            {rows.map((todo) => (
              <TaskRow key={todo.id} {...rowProps(todo)} />
            ))}
          </div>
        </div>
      ))}

      {completed.length > 0 && (
        <div className="mb-md">
          <SectionHeading className="mb-xs" count={completed.length}>
            Completed
          </SectionHeading>
          <div className="space-y-0.5 opacity-70">
            {completed.map((todo) => (
              <TaskRow key={todo.id} {...rowProps(todo)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
