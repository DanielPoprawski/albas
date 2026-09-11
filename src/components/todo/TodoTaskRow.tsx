import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import { isDone, UNCATEGORIZED } from '../../todoLogic';
import { colorHex } from '../../colors';
import type { Todo } from '../../types';

interface TodoTaskRowProps {
  task: Todo;
  onEdit: (task: Todo) => void;
  done?: boolean;
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

export default function TodoTaskRow({ task, onEdit, done: forceDone }: TodoTaskRowProps) {
  const { toggleTodo, updateTodo, categoryById } = useApp();
  const done = forceDone || isDone(task);
  const hex = colorHex(task.colorKey);
  const todayStr = fmt(new Date());
  const dueLabel = getDueDateLabel(task);
  const category = categoryById(task.category);
  const categoryName = category?.name ?? UNCATEGORIZED;
  const categoryColor = category ? colorHex(category.colorKey) : 'var(--t-cat-purple)';

  const handleToggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    const toggleDate = done ? undefined : (task.dueDate ?? todayStr);
    if (toggleDate) {
      toggleTodo(task.id, toggleDate);
    }
  };

  const handleToggleImportant = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTodo(task.id, { important: !task.important });
  };

  return (
    <div
      onClick={() => onEdit(task)}
      className={`group row-hover flex items-center gap-2.5 px-3 py-2.5 cursor-pointer ${done ? 'opacity-55' : ''}`}
    >
      {/* Star (Importance) */}
      <button
        onClick={handleToggleImportant}
        className={cn('flex-shrink-0 text-lg transition-colors', task.important ? 'text-cat-amber' : 'text-line')}
        title={task.important ? 'Unmark important' : 'Mark important'}
      >
        {task.important ? '★' : '☆'}
      </button>

      {/* Checkbox */}
      <div
        onClick={handleToggleDone}
        className="w-[1.125rem] h-[1.125rem] flex-shrink-0 border border-line-strong flex items-center justify-center cursor-pointer transition-all"
        // dynamic: the to-do's own colour
        style={{
          backgroundColor: done ? hex : 'transparent',
          borderColor: done ? hex : 'var(--t-border-strong)',
        }}
      >
        {done && <Check size="0.6875rem" strokeWidth={3} className="text-on-accent" />}
      </div>

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
            // dynamic: the category's own colour
            style={{ backgroundColor: categoryColor }}
          />
          <span className="text-meta text-ink-muted">
            {categoryName}
            {dueLabel && ` · ${dueLabel}`}
          </span>
        </div>
      </div>
    </div>
  );
}
