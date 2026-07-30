import { Check, Circle, Minus, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fmt, rotateWeek, weekOf } from '../../dates';
import { isDoneOn, isDueOn, isRepeating, repeatLabel, statusLabel, valueOn } from '../../todoLogic';
import { colorHex } from '../../colors';
import RowActions from './RowActions';
import type { Todo } from '../../types';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Repeating to-do: name + status, then the week strip. */
function RepeatingRow({ todo, onEdit }: { todo: Todo; onEdit: (t: Todo) => void }) {
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
        <span
          className="text-[10px] font-bold uppercase tracking-wider truncate"
          style={{ color: hex }}
          title={repeatLabel(todo.schedule, firstDayOfWeek)}
        >
          {todo.name}
        </span>
        <span className="text-[9px] text-txt-muted ml-auto flex-shrink-0">
          {statusLabel(todo, todayStr, firstDayOfWeek)}
        </span>
        <RowActions todo={todo} onEdit={onEdit} />
      </div>
      <div className="flex justify-between">
        {weekDates.map((date, i) => {
          const due = isDueOn(todo, date, firstDayOfWeek);
          const done = isDoneOn(todo, date);
          const value = valueOn(todo, date);
          const isToday = date === todayStr;
          const isFuture = date > todayStr;

          let content: React.ReactNode;
          if (done) {
            content = <Check size={16} strokeWidth={3} style={{ color: hex }} />;
          } else if (todo.kind === 'measurable' && value > 0) {
            content = <span className="text-[10px] font-bold" style={{ color: hex }}>{value}</span>;
          } else if (!due || isFuture) {
            content = due
              ? <Circle size={12} style={{ color: 'var(--t-fill-stronger)' }} />
              : <Minus size={12} style={{ color: 'var(--t-fill-stronger)' }} />;
          } else {
            content = <X size={14} strokeWidth={2.5} style={{ color: 'var(--t-fill-stronger)' }} />;
          }

          return (
            <button
              key={date}
              title={`${todo.name} – ${dayLabels[i]}${due ? '' : ' (not scheduled)'}`}
              disabled={isFuture}
              onClick={() => handleCellClick(date)}
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${isToday ? 'ring-1 ring-txt/30' : ''
                } ${isFuture ? 'cursor-default' : 'hover:bg-fill-strong'}`}
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
 */
export default function HabitsSection({ onEdit }: {
  onEdit: (t: Todo) => void;
}) {
  const { todos } = useApp();

  const habits = todos.filter(isRepeating);
  if (habits.length === 0) return null;

  return (
    <div className="mb-md">
      <h3 className="text-label-md text-txt-muted mb-md uppercase tracking-widest font-bold">Habits</h3>
      <div className="space-y-md">
        {habits.map(todo => (
          <RepeatingRow key={todo.id} todo={todo} onEdit={onEdit} />
        ))}
      </div>
    </div>
  );
}
