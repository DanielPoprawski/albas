import { useApp } from '../context/AppContext';
import { fmt, weekOf } from '../dates';
import { isDoneOn } from '../todoLogic';
import type { Todo } from '../types';

/**
 * The calendar's companion column — habits and tasks beside the month.
 *
 * `AppShell` mounts it for the calendar view only. It displays habits with
 * weekly checkboxes and today's tasks.
 */
export default function RightPanel() {
  const { todos, firstDayOfWeek } = useApp();

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

  // Color cycle for habits
  const colors = [
    { name: '#a855f7', bg: '#f3e8ff', border: '#e9d5ff' },
    { name: '#ef4444', bg: '#fee2e2', border: '#fecaca' },
    { name: '#f59e0b', bg: '#fef3c7', border: '#fcd34d' },
    { name: '#06b6d4', bg: '#cffafe', border: '#a5f3fc' },
    { name: '#10b981', bg: '#dcfce7', border: '#bbf7d0' },
    { name: '#6366f1', bg: '#e0e7ff', border: '#c7d2fe' },
  ];

  return (
    <aside className="flex-none w-[320px] h-full border-l border-line bg-surface flex flex-col px-[var(--space-16)] py-[var(--space-16)] overflow-y-auto scrollbar-hide">
      {/* Habits Section */}
      <div className="mb-[var(--space-16)]">
        <h3 className="text-[10px] font-bold uppercase letter-spacing text-[#6b21a8] mb-[var(--space-8)]">
          Habits
        </h3>

        <div className="space-y-xs">
          {habits.map((habit, idx) => {
            const color = colors[idx % colors.length];

            return (
              <div
                key={habit.id}
                className="border border-line bg-surface p-[var(--space-10)]"
              >
                <div
                  className="text-[11px] font-semibold uppercase letter-spacing mb-xs"
                  style={{ color: color.name }}
                >
                  {habit.name}
                </div>

                <div className="flex gap-xs justify-between">
                  {weekDateStrs.map((dateStr) => (
                    <div
                      key={dateStr}
                      className="w-[18px] h-[18px] border border-line bg-surface flex items-center justify-center text-[9px] font-semibold cursor-pointer transition-all"
                      style={{
                        backgroundColor: wasHabitDone(habit, dateStr) ? color.name : 'white',
                        borderColor: wasHabitDone(habit, dateStr) ? color.name : '#d1d5db',
                        color: wasHabitDone(habit, dateStr) ? 'white' : '#9ca3af',
                      }}
                    >
                      {wasHabitDone(habit, dateStr) ? '✓' : ''}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="pt-xs text-ink-muted text-[11px] cursor-pointer hover:text-[#6b21a8]">
            + Add new habit…
          </div>
        </div>
      </div>

      {/* Today's Tasks Section */}
      <div>
        <h3 className="text-[10px] font-bold uppercase letter-spacing text-[#6b21a8] mb-[var(--space-8)]">
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
              const isDone = Array.isArray(task.completions) && task.completions.includes(today);
              return (
                <div
                  key={task.id}
                  className="border border-line bg-surface p-xs flex gap-[var(--space-8)] cursor-pointer hover:border-accent hover:bg-[#f9fafb] transition-all items-start"
                >
                  <div className="text-[24px] cursor-pointer flex-shrink-0 mt-[-6px]">
                    {task.important ? '★' : '☆'}
                  </div>

                  <div
                    className="w-5 h-5 border border-line flex items-center justify-center flex-shrink-0 mt-[6px]"
                    style={{
                      backgroundColor: isDone ? '#a855f7' : 'white',
                      borderColor: isDone ? '#a855f7' : '#e5e7eb',
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
            <div className="border border-dashed border-line bg-[#f9fafb] p-xs text-center text-ink-muted text-[12px] cursor-text hover:text-accent hover:border-accent transition-colors">
              + Add new task…
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
