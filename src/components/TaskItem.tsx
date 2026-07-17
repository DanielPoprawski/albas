import { useApp } from '../context/AppContext';
import { shortDate } from '../dates';
import type { Task } from '../types';

interface Props {
  task: Task;
  onEdit: (task: Task) => void;
  showDate?: boolean;
}

export default function TaskItem({ task, onEdit, showDate = true }: Props) {
  const { toggleTask, deleteTask } = useApp();

  return (
    <div
      onClick={() => toggleTask(task.id)}
      className="group flex items-start gap-sm p-sm rounded-lg hover:bg-white/5 transition-all cursor-pointer"
    >
      <div
        className={`mt-0.5 h-5 w-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all ${
          task.completed ? 'bg-primary border-primary' : 'border-primary-fixed-dim'
        }`}
      >
        {task.completed && (
          <span
            className="material-symbols-outlined text-on-primary"
            style={{ fontSize: '14px', fontVariationSettings: "'FILL' 1, 'wght' 700" }}
          >
            check
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`text-body-sm transition-all ${
            task.completed ? 'text-outline-variant line-through opacity-60' : 'text-inverse-on-surface'
          }`}
        >
          {task.title}
        </p>
        <p className="text-[10px] text-outline-variant">
          {task.category}
          {showDate && task.date && <span className="text-primary-fixed-dim/60"> · {shortDate(task.date)}</span>}
        </p>
      </div>

      <div className="flex gap-xs opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          title="Edit task"
          onClick={e => { e.stopPropagation(); onEdit(task); }}
          className="text-outline-variant hover:text-inverse-on-surface transition-colors"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
        </button>
        <button
          title="Delete task"
          onClick={e => { e.stopPropagation(); deleteTask(task.id); }}
          className="text-outline-variant hover:text-tertiary-container transition-colors"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
        </button>
      </div>
    </div>
  );
}
