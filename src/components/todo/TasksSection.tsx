import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import { groupTasks, isDone, byImportanceThenDue, GENERAL } from '../../todoLogic';
import TaskRow from './TaskRow';
import { SectionHeading } from '../ui/section-heading';
import type { Todo } from '../../types';

/**
 * One-time to-dos, grouped by category with uncategorised first and completed
 * ones collected at the bottom. "Completed" is a section, not a category:
 * finishing a to-do shouldn't move it out of the group it belongs to, so it
 * keeps its category and star and simply stops competing for attention.
 */
export default function TasksSection({ onEdit }: { onEdit: (t: Todo) => void }) {
  const { todos, categoriesFor, categoryById, hiddenCategoryIds } = useApp();
  /** The one row whose inline editor is open. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const today = fmt(new Date());

  const tasks = todos.filter((t) => !hiddenCategoryIds.has(t.category) && t.schedule.type === 'once');
  const rowProps = (todo: Todo) => ({
    task: todo,
    today,
    onEdit,
    actions: true,
    expanded: expandedId === todo.id,
    onToggleExpand: () => setExpandedId((cur) => (cur === todo.id ? null : todo.id)),
    className: 'px-2 py-1.5',
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
          <div className="space-y-0.5">
            {completed.map((todo) => (
              <TaskRow key={todo.id} {...rowProps(todo)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
