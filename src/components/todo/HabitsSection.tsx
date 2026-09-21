import { useApp } from '../../context/AppContext';
import { fmt, weekOf } from '../../dates';
import { byHabitOrder, isRepeating, repeatLabel, statusLabel } from '../../todoLogic';
import { colorHex } from '../../colors';
import InlineEditor from '../InlineEditor';
import HabitStrip from '../habits/HabitStrip';
import { cellsFor, groupHabits } from '../habits/habitModel';
import { SectionHeading } from '../ui/section-heading';
import { useInlineEdit } from '../useInlineEdit';
import type { Todo } from '../../types';
import { useIsCoarsePointer } from '../../useMedia';

/**
 * Repeating to-do: name + status, then the week strip. The name opens the inline editor (desktop) or the
 * modal (touch).
 */
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
  const coarse = useIsCoarsePointer();
  const hex = colorHex(todo.colorKey);
  const today = fmt(new Date());
  const cells = cellsFor(todo, weekOf(new Date(), firstDayOfWeek), firstDayOfWeek, today);

  return (
    <div className="group">
      <div className="flex items-center gap-xs mb-xs">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => (coarse ? onEdit(todo) : onToggleExpand())}
          className="micro-label truncate text-left min-w-0 hover:underline"
          // dynamic: the habit's own colour
          style={{ color: hex }}
          title={repeatLabel(todo.schedule, firstDayOfWeek)}
        >
          {todo.name}
        </button>
        <span className="text-xs text-ink-muted ml-auto flex-shrink-0">{statusLabel(todo, today, firstDayOfWeek)}</span>
      </div>
      {expanded && !coarse && (
        <InlineEditor todo={todo} autoFocusTitle onAdvanced={() => onEdit(todo)} className="mb-xs" />
      )}
      <HabitStrip todo={todo} cells={cells} color={hex} today={today} cellClass="size-6" spread />
    </div>
  );
}

/** Repeating to-dos (habits and chores) with their week strips. */
export default function HabitsSection({ onEdit }: { onEdit: (t: Todo) => void }) {
  const { todos, habitsLayout } = useApp();
  const { expandedId, toggleExpanded } = useInlineEdit();

  const habits = todos.filter(isRepeating).sort(byHabitOrder);
  if (habits.length === 0) return null;

  // The Settings layout applies here too; the phone just can't drag.
  return (
    <div className="mb-md">
      <SectionHeading className="mb-md font-bold">Habits</SectionHeading>
      {groupHabits(habits, habitsLayout).map(({ key, label, todos: rows }) => (
        <div key={key} className="space-y-md mb-md">
          {label !== '' && <SectionHeading className="text-xs">{label}</SectionHeading>}
          {rows.map((todo) => (
            <RepeatingRow
              key={todo.id}
              todo={todo}
              onEdit={onEdit}
              expanded={expandedId === todo.id}
              onToggleExpand={() => toggleExpanded(todo.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
