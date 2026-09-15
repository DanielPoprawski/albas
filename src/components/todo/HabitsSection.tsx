import { useApp } from '../../context/AppContext';
import { fmt, weekOf } from '../../dates';
import { isRepeating, repeatLabel, statusLabel } from '../../todoLogic';
import { colorHex } from '../../colors';
import InlineEditor from '../InlineEditor';
import HabitStrip from '../habits/HabitStrip';
import { cellsFor } from '../habits/habitModel';
import { RowActions } from './TaskRow';
import { SectionHeading } from '../ui/section-heading';
import { useInlineEdit } from '../useInlineEdit';
import type { Todo } from '../../types';

/** Repeating to-do: name + status, then the week strip. The name opens the inline editor. */
function RepeatingRow({
  todo,
  onEdit,
  expanded,
  onToggleExpand,
}: {
  todo: Todo;
  onEdit: (t: Todo) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const { firstDayOfWeek } = useApp();
  const hex = colorHex(todo.colorKey);
  const today = fmt(new Date());
  const cells = cellsFor(todo, weekOf(new Date(), firstDayOfWeek), firstDayOfWeek, today);

  return (
    <div className="group">
      <div className="flex items-center gap-xs mb-xs">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggleExpand}
          className="micro-label truncate text-left min-w-0 hover:underline"
          // dynamic: the habit's own colour
          style={{ color: hex }}
          title={repeatLabel(todo.schedule, firstDayOfWeek)}
        >
          {todo.name}
        </button>
        <span className="text-xs text-ink-muted ml-auto flex-shrink-0">{statusLabel(todo, today, firstDayOfWeek)}</span>
        <RowActions todo={todo} onEdit={onEdit} />
      </div>
      {expanded && <InlineEditor todo={todo} autoFocusTitle onAdvanced={() => onEdit(todo)} className="mb-xs" />}
      <HabitStrip todo={todo} cells={cells} color={hex} today={today} cellClass="size-6" spread />
    </div>
  );
}

/** Repeating to-dos (habits and chores) with their week strips. */
export default function HabitsSection({ onEdit }: { onEdit: (t: Todo) => void }) {
  const { todos, hiddenCategoryIds } = useApp();
  const { expandedId, toggleExpanded } = useInlineEdit();

  const habits = todos.filter((t) => !hiddenCategoryIds.has(t.category) && isRepeating(t));
  if (habits.length === 0) return null;

  return (
    <div className="mb-md">
      <SectionHeading className="mb-md font-bold">Habits</SectionHeading>
      <div className="space-y-md">
        {habits.map((todo) => (
          <RepeatingRow
            key={todo.id}
            todo={todo}
            onEdit={onEdit}
            expanded={expandedId === todo.id}
            onToggleExpand={() => toggleExpanded(todo.id)}
          />
        ))}
      </div>
    </div>
  );
}
