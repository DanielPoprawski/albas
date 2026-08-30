import { useState } from 'react';
import { useApp } from '../context/AppContext';
import AddModal from './AddModal';
import { fmt, weekOf } from '../dates';
import { isDoneOn } from '../todoLogic';
import type { Todo } from '../types';
import { accentOf, colorHex } from '../colors';

/**
 * The calendar's companion column — habits and tasks beside the month.
 *
 * `AppShell` mounts it for the calendar view only. It displays habits with
 * weekly checkboxes and today's tasks.
 */
export default function RightPanel() {
  const { todos, firstDayOfWeek, toggleTodo, updateTodo } = useApp();
  const [adding, setAdding] = useState<'task' | 'habit' | null>(null);

  // Get today's date
  const today = fmt(new Date());

  // Separate habits and tasks
  const habits = todos.filter(t => t.schedule && t.schedule.type !== 'once');
  const tasks = todos.filter(t => !t.schedule || t.schedule.type === 'once');

  // Get this week's dates (7 days)
  const weekDateStrs = weekOf(new Date(), firstDayOfWeek);

  // Get today's tasks
  const todayTasks = tasks.filter(t => t.dueDate === today);

  // Helper to check if a habit was done on a specific date
  const wasHabitDone = (habit: Todo, dateStr: string): boolean => {
    return isDoneOn(habit, dateStr);
  };

  // A habit draws in the colour the user picked for it — `accentOf(colorHex(…))`,
  // the same pair `HabitsView` uses. This used to cycle a fixed palette by list
  // index, which meant `colorKey` was ignored outright and a habit was one
  // colour here and a different one on the Habits screen.

  return (
    <aside className="flex-none w-[320px] h-full border-l border-line bg-surface flex flex-col px-[var(--space-16)] py-[var(--space-16)] overflow-y-auto scrollbar-hide">
      {/* Habits Section */}
      <div className="mb-[var(--space-16)]">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.5px] text-[var(--t-cat-purple-ink)] mb-[var(--space-8)]">
          Habits
        </h3>

        <div className="space-y-xs">
          {habits.map(habit => {
            const color = accentOf(colorHex(habit.colorKey));

            return (
              <div
                key={habit.id}
                className="border border-line bg-surface p-[var(--space-10)]"
              >
                <div
                  className="text-[11px] font-semibold uppercase tracking-[0.5px] mb-[6px]"
                  style={{ color: color.hex }}
                >
                  {habit.name}
                </div>

                <div className="flex gap-[4px]">
                  {weekDateStrs.map((dateStr) => (
                    <div
                      key={dateStr}
                      role="checkbox"
                      aria-checked={wasHabitDone(habit, dateStr)}
                      aria-label={`${habit.name} on ${dateStr}`}
                      onClick={() => toggleTodo(habit.id, dateStr)}
                      className="w-[18px] h-[18px] border border-line bg-surface flex items-center justify-center text-[9px] font-semibold cursor-pointer transition-all"
                      style={{
                        backgroundColor: wasHabitDone(habit, dateStr) ? color.hex : 'var(--t-surface)',
                        borderColor: wasHabitDone(habit, dateStr) ? color.hex : 'var(--t-border-strong)',
                        color: wasHabitDone(habit, dateStr) ? 'white' : 'var(--t-ink-muted)',
                      }}
                    >
                      {wasHabitDone(habit, dateStr) ? '✓' : ''}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div
            onClick={() => setAdding('habit')}
            className="pt-xs text-ink-muted text-[11px] cursor-pointer hover:text-[var(--t-cat-purple-ink)]"
          >
            + Add new habit…
          </div>
        </div>
      </div>

      {/* Today's Tasks Section */}
      <div>
        <h3 className="text-[12px] font-bold uppercase tracking-[0.5px] text-[var(--t-cat-purple-ink)] mb-[var(--space-8)]">
          Today's Tasks
        </h3>

        <div className="space-y-xs">
          {todayTasks
            .sort((a, b) => {
              // Starred tasks first
              const aImportant = a.important ? -1 : 1;
              const bImportant = b.important ? -1 : 1;
              return aImportant - bImportant;
            })
            .map(task => {
              // `completions` is a Record<date, value>, never an array — done-ness
              // comes from the shared helper so it matches every other surface.
              const isDone = isDoneOn(task, today);
              return (
                <div
                  key={task.id}
                  className="border border-line bg-surface p-xs flex gap-[var(--space-8)] cursor-pointer hover:border-accent hover:bg-subtle transition-all items-start"
                >
                  <div
                    role="button"
                    aria-label={task.important ? 'Unstar task' : 'Star task'}
                    onClick={() => updateTodo(task.id, { important: !task.important })}
                    className="text-[24px] cursor-pointer flex-shrink-0 mt-[-6px]"
                  >
                    {task.important ? '★' : '☆'}
                  </div>

                  <div
                    role="checkbox"
                    aria-checked={isDone}
                    aria-label={task.name}
                    onClick={() => toggleTodo(task.id, today)}
                    className="w-5 h-5 border border-line flex items-center justify-center flex-shrink-0 mt-[6px] cursor-pointer"
                    style={{
                      backgroundColor: isDone ? 'var(--t-accent)' : 'var(--t-surface)',
                      borderColor: isDone ? 'var(--t-accent)' : 'var(--t-border)',
                      color: isDone ? 'white' : 'transparent',
                      fontSize: '11px',
                    }}
                  >
                    {isDone ? '✓' : ''}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[12px] font-medium text-ink"
                      style={{
                        textDecoration: isDone ? 'line-through' : 'none',
                        opacity: isDone ? 0.6 : 1,
                      }}
                    >
                      {task.name}
                    </div>
                    <div className="text-[10px] text-ink-muted mt-[2px]">
                      {task.dueDate === today ? 'Today' : task.dueDate ? 'Due ' + task.dueDate : 'No due date'}
                    </div>
                  </div>
                </div>
              );
            })}

          {todayTasks.length === 0 && (
            <div
              onClick={() => setAdding('task')}
              className="border border-dashed border-line bg-subtle p-xs text-center text-ink-muted text-[12px] cursor-pointer hover:text-accent hover:border-accent transition-colors"
            >
              + Add new task…
            </div>
          )}
        </div>
      </div>

      {adding && <AddModal defaultType={adding} onClose={() => setAdding(null)} />}
    </aside>
  );
}
