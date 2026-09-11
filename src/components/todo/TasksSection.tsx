import { Check, Star } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fmt, shortDate } from '../../dates';
import { shortTime } from '../../eventLogic';
import { doneDate, groupTasks, isDone, isOverdue, byImportanceThenDue, UNCATEGORIZED } from '../../todoLogic';
import { colorHex } from '../../colors';
import RowActions from './RowActions';
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

/** One-time to-do: checkbox, star, name, due moment. */
function TaskRow({ todo, onEdit, readOnly = false }: { todo: Todo; onEdit: (t: Todo) => void; readOnly?: boolean }) {
  const { toggleTodo, updateTodo } = useApp();
  const hex = colorHex(todo.colorKey);
  const todayStr = fmt(new Date());
  const done = isDone(todo);

  // clear where it was logged; log on the due day (or today for anytime to-dos)
  const toggleDate = done ? doneDate(todo)! : (todo.dueDate ?? todayStr);

  return (
    <div
      onClick={readOnly ? undefined : () => toggleTodo(todo.id, toggleDate)}
      className={`group flex items-center gap-sm p-xs rounded-lg transition-all ${
        readOnly ? '' : 'hover:bg-subtle cursor-pointer'
      }`}
    >
      <div
        className="h-5 w-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all"
        // dynamic: the to-do's own colour
        style={{ borderColor: hex, backgroundColor: done ? hex : 'transparent' }}
      >
        {done && <Check size="0.875rem" strokeWidth={3.5} className="text-on-accent" />}
      </div>

      {/* Starring is one click from the list — it's the field most likely to
          change after a to-do already exists. A shared row keeps the star only
          as a marker (when the owner starred it). */}
      {readOnly ? (
        todo.important && <Star size="1rem" className="flex-shrink-0 text-cat-amber" fill="currentColor" />
      ) : (
        <button
          title={todo.important ? 'Not important' : 'Mark important'}
          aria-pressed={todo.important}
          onClick={(e) => {
            e.stopPropagation();
            updateTodo(todo.id, { important: !todo.important });
          }}
          className={`flex-shrink-0 transition-colors ${
            todo.important ? 'text-cat-amber' : 'text-ink-muted opacity-0 group-hover:opacity-100 hover:text-ink'
          }`}
        >
          <Star size="1rem" fill={todo.important ? 'currentColor' : 'none'} />
        </button>
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
  const { todos: own, categoriesFor, categoryById } = useApp();

  const tasks = (override ?? own).filter((t) => t.schedule.type === 'once');
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
        <div key={category || UNCATEGORIZED} className="mb-md">
          <SectionHeading className="mb-xs">{categoryById(category)?.name ?? UNCATEGORIZED}</SectionHeading>
          <div className="space-y-0.5">
            {rows.map((todo) => (
              <TaskRow key={todo.id} todo={todo} onEdit={onEdit} readOnly={readOnly} />
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
              <TaskRow key={todo.id} todo={todo} onEdit={onEdit} readOnly={readOnly} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
