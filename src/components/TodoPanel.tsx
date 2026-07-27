import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { fmt, rotateWeek, shortDate, weekOf } from '../dates';
import { doneDate, isDone, isDoneOn, isDueOn, isRepeating, repeatLabel, statusLabel, valueOn } from '../todoLogic';
import AddModal from './AddModal';
import { colorHex } from '../colors';
import type { Todo } from '../types';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Hover-reveal edit/delete pair shared by both row styles. */
function RowActions({ todo, onEdit }: { todo: Todo; onEdit: (t: Todo) => void }) {
  const { deleteTodo } = useApp();
  return (
    <span className="hidden group-hover:flex gap-xs flex-shrink-0">
      <button
        title="Edit"
        onClick={e => { e.stopPropagation(); onEdit(todo); }}
        className="text-txt-muted hover:text-txt transition-colors"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>edit</span>
      </button>
      <button
        title="Delete"
        onClick={e => { e.stopPropagation(); deleteTodo(todo.id); }}
        className="text-txt-muted hover:text-tertiary-container transition-colors"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
      </button>
    </span>
  );
}

/** Repeating to-do: name + status, then the Mon–Sun week strip. */
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
          title={repeatLabel(todo.schedule)}
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
            content = (
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '16px', color: hex, fontVariationSettings: "'FILL' 1, 'wght' 700" }}
              >
                check
              </span>
            );
          } else if (todo.kind === 'measurable' && value > 0) {
            content = <span className="text-[10px] font-bold" style={{ color: hex }}>{value}</span>;
          } else if (!due || isFuture) {
            content = (
              <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'var(--t-fill-stronger)' }}>
                {due ? 'radio_button_unchecked' : 'remove'}
              </span>
            );
          } else {
            content = (
              <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--t-fill-stronger)' }}>
                close
              </span>
            );
          }

          return (
            <button
              key={date}
              title={`${todo.name} – ${dayLabels[i]}${due ? '' : ' (not scheduled)'}`}
              disabled={isFuture}
              onClick={() => handleCellClick(date)}
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${
                isToday ? 'ring-1 ring-txt/30' : ''
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

/** One-time to-do: checkbox row with an optional due date. */
function OnceRow({ todo, onEdit }: { todo: Todo; onEdit: (t: Todo) => void }) {
  const { toggleTodo } = useApp();
  const hex = colorHex(todo.colorKey);
  const todayStr = fmt(new Date());
  const done = isDone(todo);
  const overdue = !done && !!todo.dueDate && todo.dueDate < todayStr;

  // clear where it was logged; log on the due day (or today for anytime to-dos)
  const toggleDate = done ? doneDate(todo)! : todo.dueDate ?? todayStr;

  return (
    <div
      onClick={() => toggleTodo(todo.id, toggleDate)}
      className="group flex items-center gap-sm p-xs rounded-lg hover:bg-fill transition-all cursor-pointer"
    >
      <div
        className="h-5 w-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all"
        style={{ borderColor: hex, backgroundColor: done ? hex : 'transparent' }}
      >
        {done && (
          <span
            className="material-symbols-outlined text-white"
            style={{ fontSize: '14px', fontVariationSettings: "'FILL' 1, 'wght' 700" }}
          >
            check
          </span>
        )}
      </div>

      <span
        className={`text-body-sm min-w-0 flex-1 truncate transition-all ${
          done ? 'text-txt-muted line-through opacity-60' : 'text-txt'
        }`}
      >
        {todo.name}
      </span>

      <span
        className={`text-[10px] flex-shrink-0 ${overdue ? 'font-bold text-danger' : 'text-txt-muted'}`}
      >
        {todo.dueDate
          ? todo.dueDate === todayStr ? 'today' : shortDate(todo.dueDate)
          : 'anytime'}
      </span>

      <RowActions todo={todo} onEdit={onEdit} />
    </div>
  );
}

/** Sort helper: overdue first, then dated ascending, then anytime. */
function byDue(a: Todo, b: Todo): number {
  if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1;
  return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
}

/**
 * The single To-Do surface: repeating to-dos (habits & chores) with their
 * week strips, then one-time tasks. Used both as the main view and in the
 * right panel.
 */
export default function TodoPanel() {
  const { todos } = useApp();
  const [editing, setEditing] = useState<Todo | null>(null);

  const repeating = todos.filter(isRepeating);
  const once = todos.filter(t => !isRepeating(t));
  const pending = once.filter(t => !isDone(t)).sort(byDue);
  const finished = once.filter(isDone);

  const hasOnce = pending.length > 0 || finished.length > 0;

  return (
    <div className="mb-lg px-xs">
      {repeating.length > 0 && (
        <>
          <h3 className="text-label-md text-txt-muted mb-md uppercase tracking-wider">Habits</h3>
          <div className="space-y-md mb-md">
            {repeating.map(todo => (
              <RepeatingRow key={todo.id} todo={todo} onEdit={setEditing} />
            ))}
          </div>
        </>
      )}

      {repeating.length > 0 && hasOnce && <div className="h-px bg-fill-strong mb-md" />}

      {hasOnce && (
        <>
          <h3 className="text-label-md text-txt-muted mb-md uppercase tracking-wider">To-Do</h3>
          <div className="space-y-xs">
            {[...pending, ...finished].map(todo => (
              <OnceRow key={todo.id} todo={todo} onEdit={setEditing} />
            ))}
          </div>
        </>
      )}

      {todos.length === 0 && (
        <p className="text-[11px] text-txt-muted text-center py-md">
          Nothing here yet — hit + to add your first to-do.
        </p>
      )}

      {editing && <AddModal editTodo={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
