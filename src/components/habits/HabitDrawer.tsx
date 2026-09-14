import { useState } from 'react';
import { Bell, Pencil } from 'lucide-react';
import { colorHex } from '../../colors';
import { useApp } from '../../context/AppContext';
import AddModal from '../AddModal';
import InlineEditor from '../InlineEditor';
import HabitCell from './HabitCell';
import { cycleCell, type HabitData, HISTORY_WEEKS, monthLabels } from './habitModel';

/**
 * The panel under an open habit row: the full 16-week heatmap with month
 * labels, the completion rate and reminder, and the page's only way into the
 * habit's editor. Left-inset so the grid lines up under the row's name.
 */
export default function HabitDrawer({ habit }: { habit: HabitData }) {
  const { toggleTodo, setTodoValue } = useApp();
  const [editing, setEditing] = useState(false);
  const { todo } = habit;
  const color = colorHex(todo.colorKey);
  const labels = monthLabels(habit.cells, HISTORY_WEEKS);

  const reminder = todo.reminder ? (todo.time ? `At ${todo.time}` : 'On due days') : 'Off';

  return (
    <div className="flex flex-col gap-4 pl-[3.375rem] pr-3 pt-4 pb-5 bg-surface-hover max-md:pl-3">
      <InlineEditor todo={todo} onAdvanced={() => setEditing(true)} />
      <div className="flex items-start gap-8 max-md:flex-col">
        <div className="flex flex-col gap-1.5 overflow-x-auto scrollbar-hide max-w-full">
          <div className="flex w-max" aria-hidden>
            {labels.map((label, i) => (
              <span
                key={habit.cells[i * 7].dateStr}
                className="w-[0.875rem] whitespace-nowrap overflow-visible text-[0.625rem] leading-none uppercase tracking-[0.5px] text-ink-muted"
              >
                {label}
              </span>
            ))}
          </div>
          <div
            className="grid grid-flow-col grid-rows-[repeat(7,0.6875rem)] gap-[0.1875rem] justify-start"
            role="group"
            aria-label={`${todo.name}, last ${HISTORY_WEEKS} weeks`}
            // dynamic: one column per week of history
            style={{ gridTemplateColumns: `repeat(${HISTORY_WEEKS}, 0.6875rem)` }}
          >
            {habit.cells.map((cell) => (
              <HabitCell
                key={cell.dateStr}
                cell={cell}
                todo={todo}
                color={color}
                className="size-[0.6875rem] enabled:hover:scale-125"
                onClick={(d) => cycleCell(todo, d, toggleTodo, setTodoValue)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 pt-[1.125rem] max-md:pt-0">
          <span className="micro-label text-[0.625rem]">
            Last {HISTORY_WEEKS} weeks · {habit.completion}% complete
          </span>
          <span className="flex items-center gap-[0.375rem] text-xs text-ink-secondary">
            <Bell size="0.8125rem" />
            Reminder · {reminder}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="button-small inline-flex items-center gap-1.5 self-start"
          >
            <Pencil size="0.8125rem" />
            Edit habit
          </button>
        </div>
      </div>

      {editing && <AddModal editTodo={todo} onClose={() => setEditing(false)} />}
    </div>
  );
}
