import { useState } from 'react';
import { Check, Circle, Minus, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fmt, rotateWeek, weekOf } from '../../dates';
import { isDoneOn, isDueOn, isRepeating, repeatLabel, statusLabel, valueOn } from '../../todoLogic';
import { colorHex } from '../../colors';
import InlineEditor from '../InlineEditor';
import { RowActions } from './TodoTaskRow';
import { SectionHeading } from '../ui/section-heading';
import type { Todo } from '../../types';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Repeating to-do: name + status, then the week strip. The name opens the inline editor. */
function RepeatingRow({
  todo,
  onEdit,
  readOnly = false,
  expanded = false,
  onToggleExpand,
}: {
  todo: Todo;
  onEdit: (t: Todo) => void;
  readOnly?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const { toggleTodo, setTodoValue, firstDayOfWeek } = useApp();
  const hex = colorHex(todo.colorKey);
  const todayStr = fmt(new Date());
  const weekDates = weekOf(new Date(), firstDayOfWeek);
  const dayLabels = rotateWeek(DAY_LABELS, firstDayOfWeek);

  function handleCellClick(date: string) {
    if (todo.kind === 'yesno') {
      toggleTodo(todo.id, date);
    } else {
      // Measurable: each click adds 1; a click at/past target resets to 0
      const v = valueOn(todo, date);
      setTodoValue(todo.id, date, v >= todo.target ? 0 : v + 1);
    }
  }

  return (
    <div className="group">
      <div className="flex items-center gap-xs mb-xs">
        {readOnly ? (
          <span
            className="micro-label truncate"
            // dynamic: the habit's own colour
            style={{ color: hex }}
            title={repeatLabel(todo.schedule, firstDayOfWeek)}
          >
            {todo.name}
          </span>
        ) : (
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
        )}
        <span className="text-xs text-ink-muted ml-auto flex-shrink-0">
          {statusLabel(todo, todayStr, firstDayOfWeek)}
        </span>
        {!readOnly && <RowActions todo={todo} onEdit={onEdit} />}
      </div>
      {expanded && !readOnly && (
        <InlineEditor todo={todo} autoFocusTitle onAdvanced={() => onEdit(todo)} className="mb-xs" />
      )}
      <div className="flex justify-between">
        {weekDates.map((date, i) => {
          const due = isDueOn(todo, date, firstDayOfWeek);
          const done = isDoneOn(todo, date);
          const value = valueOn(todo, date);
          const isToday = date === todayStr;
          const isFuture = date > todayStr;

          let content: React.ReactNode;
          if (done) {
            // dynamic: the habit's own colour
            content = <Check size="1rem" strokeWidth={3} style={{ color: hex }} />;
          } else if (todo.kind === 'measurable' && value > 0) {
            // dynamic: the habit's own colour
            content = (
              <span className="text-xs font-bold" style={{ color: hex }}>
                {value}
              </span>
            );
          } else if (!due || isFuture) {
            content = due ? (
              <Circle size="0.75rem" className="text-line-strong" />
            ) : (
              <Minus size="0.75rem" className="text-line-strong" />
            );
          } else {
            content = <X size="0.875rem" strokeWidth={2.5} className="text-line-strong" />;
          }

          return (
            <button
              key={date}
              type="button"
              aria-pressed={done}
              aria-label={`${todo.name} on ${date}`}
              title={`${todo.name} – ${dayLabels[i]}${due ? '' : ' (not scheduled)'}`}
              disabled={isFuture || readOnly}
              onClick={readOnly ? undefined : () => handleCellClick(date)}
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${
                isToday ? 'ring-1 ring-ink/30' : ''
              } ${isFuture || readOnly ? 'cursor-default' : 'hover:bg-subtle-strong'}`}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Repeating to-dos (habits and chores) with their week strips.
 * to-dos below it stay within reach of a thumb.
 *
 * With `todos`/`readOnly` set it renders someone else's shared habits instead:
 * same strips (the glyphs are the point), nothing clickable, no heading — the
 * caller labels the block with the owner's name.
 */
export default function HabitsSection({
  onEdit,
  todos: override,
  readOnly = false,
}: {
  onEdit: (t: Todo) => void;
  todos?: Todo[];
  readOnly?: boolean;
}) {
  const { todos: own, hiddenCategoryIds } = useApp();
  /** The one row whose inline editor is open. */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Hidden categories apply to our own habits only; a shared list's ids belong to its owner.
  const habits = (override ?? own.filter((t) => !hiddenCategoryIds.has(t.category))).filter(isRepeating);
  if (habits.length === 0) return null;

  return (
    <div className="mb-md">
      {!override && <SectionHeading className="mb-md font-bold">Habits</SectionHeading>}
      <div className="space-y-md">
        {habits.map((todo) => (
          <RepeatingRow
            key={todo.id}
            todo={todo}
            onEdit={onEdit}
            readOnly={readOnly}
            expanded={expandedId === todo.id}
            onToggleExpand={() => setExpandedId((cur) => (cur === todo.id ? null : todo.id))}
          />
        ))}
      </div>
    </div>
  );
}
