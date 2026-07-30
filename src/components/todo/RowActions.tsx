import { useApp } from '../../context/AppContext';
import type { Todo } from '../../types';

/** Hover-reveal edit/delete pair shared by the habit and task rows. */
export default function RowActions({ todo, onEdit }: { todo: Todo; onEdit: (t: Todo) => void }) {
  const { deleteTodo } = useApp();
  return (
    <span className="hidden group-hover:flex gap-xs flex-shrink-0">
      <button
        title="Edit"
        onClick={e => { e.stopPropagation(); onEdit(todo); }}
        className="text-txt-muted hover:text-txt transition-colors"
      >
        <span className="material-symbols-outlined block" style={{ fontSize: '14px' }}>edit</span>
      </button>
      <button
        title="Delete"
        onClick={e => { e.stopPropagation(); deleteTodo(todo.id); }}
        className="text-txt-muted hover:text-danger transition-colors"
      >
        <span className="material-symbols-outlined block" style={{ fontSize: '14px' }}>delete</span>
      </button>
    </span>
  );
}
