import { useApp } from '../../context/AppContext';
import type { Todo } from '../../types';

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
const ACTION = 'text-[10px] font-semibold uppercase tracking-wider transition-colors';

export default function RowActions({ todo, onEdit }: { todo: Todo; onEdit: (t: Todo) => void }) {
  const { deleteTodo } = useApp();
  return (
    <span className="flex items-center gap-xs flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
      <button
        onClick={e => { e.stopPropagation(); onEdit(todo); }}
        className={`${ACTION} text-txt-muted hover:text-txt`}
      >
        Edit
      </button>
      <span className="text-[10px] text-txt-faint select-none">·</span>
      <button
        onClick={e => { e.stopPropagation(); deleteTodo(todo.id); }}
        className={`${ACTION} text-txt-muted hover:text-danger`}
      >
        Delete
      </button>
    </span>
  );
}
