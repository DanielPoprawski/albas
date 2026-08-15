import { Check, Star } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fmt, shortDate } from '../../dates';
import { shortTime } from '../../eventLogic';
import { doneDate, groupTasks, isDone, isOverdue, byImportanceThenDue } from '../../todoLogic';
import { colorHex } from '../../colors';
import RowActions from './RowActions';
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
      className={`text-[10px] flex-shrink-0 tabular-nums ${
        overdue ? 'font-bold text-danger' : 'text-txt-muted'
      }`}
      title={overdue ? 'Overdue' : undefined}
    >
      {label}
    </span>
  );
}

/** One-time to-do: checkbox, star, name, due moment. */
function TaskRow({ todo, onEdit, readOnly = false }: {
  todo: Todo;
  onEdit: (t: Todo) => void;
  readOnly?: boolean;
}) {
  const { toggleTodo, updateTodo } = useApp();
  const hex = colorHex(todo.colorKey);
  const todayStr = fmt(new Date());
  const done = isDone(todo);

  // clear where it was logged; log on the due day (or today for anytime to-dos)
  const toggleDate = done ? doneDate(todo)! : todo.dueDate ?? todayStr;

  return (
    <div
      onClick={readOnly ? undefined : () => toggleTodo(todo.id, toggleDate)}
      className={`group flex items-center gap-sm p-xs rounded-lg transition-all ${
        readOnly ? '' : 'hover:bg-fill cursor-pointer'
      }`}
    >
      <div
        className="h-5 w-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all"
        style={{ borderColor: hex, backgroundColor: done ? hex : 'transparent' }}
      >
        {done && (
          <Check size={14} strokeWidth={3.5} className="text-white" />
        )}
      </div>

      {/* Starring is one click from the list — it's the field most likely to
          change after a to-do already exists. A shared row keeps the star only
          as a marker (when the owner starred it). */}
      {readOnly ? (
        todo.important && <Star size={16} className="flex-shrink-0 text-amber-400" fill="currentColor" />
      ) : (
        <button
          title={todo.important ? 'Not important' : 'Mark important'}
          aria-pressed={todo.important}
          onClick={e => { e.stopPropagation(); updateTodo(todo.id, { important: !todo.important }); }}
          className={`flex-shrink-0 transition-colors ${
            todo.important
              ? 'text-amber-400'
              : 'text-txt-faint opacity-0 group-hover:opacity-100 hover:text-txt'
          }`}
        >
          <Star size={16} fill={todo.important ? 'currentColor' : 'none'} />
        </button>
      )}

      <span
        className={`text-body-sm min-w-0 flex-1 truncate transition-all ${
          done ? 'text-txt-muted line-through opacity-60' : 'text-txt'
        }`}
      >
        {todo.name}
      </span>

      <DueLabel todo={todo} />
      {!readOnly && <RowActions todo={todo} onEdit={onEdit} />}
    </div>
  );
}

const HEADING = 'text-label-md text-txt-muted uppercase tracking-wider';

/**
 * One-time to-dos, grouped by category with uncategorised first and completed
 * ones collected at the bottom. "Completed" is a section, not a category:
 * finishing a to-do shouldn't move it out of the group it belongs to, so it
 * keeps its category and star and simply stops competing for attention.
 */
export default function TasksSection({ onEdit, todos: override, readOnly = false }: {
  onEdit: (t: Todo) => void;
  todos?: Todo[];
  readOnly?: boolean;
}) {
  const { todos: own } = useApp();

  const tasks = (override ?? own).filter(t => t.schedule.type === 'once');
  const groups = groupTasks(tasks.filter(t => !isDone(t)));
  const completed = tasks.filter(isDone).sort(byImportanceThenDue);

  if (tasks.length === 0) return null;

  return (
    <div>
      {groups.map(({ category, todos: rows }) => (
        <div key={category} className="mb-md">
          <h3 className={`${HEADING} mb-xs`}>{category}</h3>
          <div className="space-y-0.5">
            {rows.map(todo => (
              <TaskRow key={todo.id} todo={todo} onEdit={onEdit} readOnly={readOnly} />
            ))}
          </div>
        </div>
      ))}

      {completed.length > 0 && (
        <div className="mb-md">
          <h3 className={`${HEADING} mb-xs flex items-center gap-xs`}>
            Completed
            <span className="text-txt-faint font-normal">{completed.length}</span>
          </h3>
          <div className="space-y-0.5 opacity-70">
            {completed.map(todo => (
              <TaskRow key={todo.id} todo={todo} onEdit={onEdit} readOnly={readOnly} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
