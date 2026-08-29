import { Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import { isDone } from '../../todoLogic';
import { colorHex } from '../../colors';
import type { Todo } from '../../types';

const CATEGORY_DEFS = {
  work: { name: 'Work', color: '#a855f7' },
  personal: { name: 'Personal', color: '#ec4899' },
  shopping: { name: 'Shopping', color: '#10b981' },
  health: { name: 'Health', color: '#06b6d4' },
  finance: { name: 'Finance', color: '#f59e0b' },
} as const;

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

function getCategoryName(category: string): string {
  const normalized = category.toLowerCase();
  for (const [_key, def] of Object.entries(CATEGORY_DEFS)) {
    if (def.name.toLowerCase() === normalized) {
      return def.name;
    }
  }
  return category || 'Uncategorized';
}

function getCategoryColor(category: string): string {
  const normalized = category.toLowerCase();
  for (const [_key, def] of Object.entries(CATEGORY_DEFS)) {
    if (def.name.toLowerCase() === normalized) {
      return def.color;
    }
  }
  // Default color for uncategorized
  return '#a855f7';
}

export default function TodoTaskRow({ task, onEdit, done: forceDone }: TodoTaskRowProps) {
  const { toggleTodo, updateTodo } = useApp();
  const done = forceDone || isDone(task);
  const hex = colorHex(task.colorKey);
  const todayStr = fmt(new Date());
  const dueLabel = getDueDateLabel(task);
  const categoryName = getCategoryName(task.category);
  const categoryColor = getCategoryColor(task.category);

  const handleToggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    const toggleDate = done ? undefined : task.dueDate ?? todayStr;
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
      className={`group flex items-center gap-[var(--space-10)] px-[var(--space-12)] py-[var(--space-10)] bg-surface border border-border transition-all cursor-pointer hover:border-accent hover:bg-accent-tint ${
        done ? 'opacity-55' : ''
      }`}
    >
      {/* Star (Importance) */}
      <button
        onClick={handleToggleImportant}
        className="flex-shrink-0 text-[17px] transition-colors"
        style={{ color: task.important ? '#f59e0b' : '#e5e7eb' }}
        title={task.important ? 'Unmark important' : 'Mark important'}
      >
        {task.important ? '★' : '☆'}
      </button>

      {/* Checkbox */}
      <div
        onClick={handleToggleDone}
        className="w-[18px] h-[18px] flex-shrink-0 border border-border-strong flex items-center justify-center cursor-pointer transition-all"
        style={{
          backgroundColor: done ? hex : 'transparent',
          borderColor: done ? hex : 'var(--t-border-strong)',
        }}
      >
        {done && <Check size={11} strokeWidth={3} className="text-white" />}
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
        <div className="flex items-center gap-[var(--space-6)] mt-0.5">
          <span
            className="w-[7px] h-[7px] flex-shrink-0"
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
