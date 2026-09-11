import { useRef } from 'react';
import { LAYOUT_LIMITS, clampRem, useApp } from '../context/AppContext';
import QuickAddField from './QuickAddField';
import ResizeHandle from './ResizeHandle';
import { fmt, weekOf } from '../dates';
import { groupTasks, isDoneOn, UNCATEGORIZED } from '../todoLogic';
import type { Todo } from '../types';
import { accentOf, colorHex } from '../colors';
import { Card } from './ui/card';
import { SectionHeading } from './ui/section-heading';
import { cn } from '@/lib/utils';

/**
 * The calendar's companion column — habits and tasks beside the month.
 *
 * `AppShell` mounts it for the calendar view only. It displays habits with
 * weekly checkboxes and today's tasks.
 */
export default function RightPanel() {
  const { todos, firstDayOfWeek, toggleTodo, updateTodo, getSetting, setSetting, categoriesFor, categoryById } =
    useApp();

  // Drag state for the panel's own resize handle. Held in a ref, not React
  // state — a pixel-by-pixel setState would re-render this whole panel on
  // every pointermove. The var is written straight onto <html> during the
  // drag; `setSetting` (which persists and re-derives `applyLayout`) only
  // runs once, on pointer up.
  const dragRem = useRef<number | null>(null);

  function commitRightWidth() {
    if (dragRem.current === null) return;
    setSetting('__layout_right_w', String(dragRem.current));
    dragRem.current = null;
  }

  function handleRightDelta(deltaPx: number) {
    if (dragRem.current === null) {
      const stored = parseFloat(getSetting('__layout_right_w') ?? '');
      dragRem.current = Number.isFinite(stored) ? stored : LAYOUT_LIMITS.right.def;
      // Fires once the drag ends, wherever the pointer is released — the
      // handle itself only reports deltas, not a drag-end.
      window.addEventListener('pointerup', commitRightWidth, { once: true });
    }
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    // The handle sits on the panel's *left* edge, so dragging left (a
    // negative clientX delta) widens the panel — hence the subtraction.
    dragRem.current = clampRem(dragRem.current - deltaPx / remPx, LAYOUT_LIMITS.right.min, LAYOUT_LIMITS.right.max);
    document.documentElement.style.setProperty('--layout-right-w', `${dragRem.current}rem`);
  }

  function handleRightReset() {
    dragRem.current = null;
    document.documentElement.style.removeProperty('--layout-right-w');
    setSetting('__layout_right_w', '');
  }

  // Get today's date
  const today = fmt(new Date());

  // Separate habits and tasks
  const habits = todos.filter((t) => t.schedule && t.schedule.type !== 'once');
  const tasks = todos.filter((t) => !t.schedule || t.schedule.type === 'once');

  // Get this week's dates (7 days)
  const weekDateStrs = weekOf(new Date(), firstDayOfWeek);

  // Get today's tasks, grouped by category (uncategorised first, then the
  // user's Settings order) so the dashboard reads the same way the To-Do
  // view does.
  const todayTasks = tasks.filter((t) => t.dueDate === today);
  const taskOrder = categoriesFor('tasks').map((c) => c.id);
  const todayGroups = groupTasks(todayTasks, taskOrder);

  // Helper to check if a habit was done on a specific date
  const wasHabitDone = (habit: Todo, dateStr: string): boolean => {
    return isDoneOn(habit, dateStr);
  };

  // A habit draws in the colour the user picked for it — `accentOf(colorHex(…))`,
  // the same pair `HabitsView` uses. This used to cycle a fixed palette by list
  // index, which meant `colorKey` was ignored outright and a habit was one
  // colour here and a different one on the Habits screen.

  return (
    <>
      {/* Sits on the panel's left edge, as a sibling flex item in
          `.shell-content` — not absolutely positioned over the panel — so its
          own 0.5rem is genuinely reserved (see MonthViewDesktop's RESERVED). */}
      <ResizeHandle side="left" onDelta={handleRightDelta} onReset={handleRightReset} ariaLabel="Resize right panel" />
      <aside className="flex-none h-full w-[var(--layout-right-w,20rem)] border-l border-line bg-surface flex flex-col px-4 py-4 overflow-y-auto scrollbar-hide">
        {/* Habits Section */}
        <div className="mb-4">
          <SectionHeading className="text-sm font-bold tracking-[0.5px] text-[var(--t-cat-purple-ink)] mb-2">
            Habits
          </SectionHeading>

          <div className="space-y-xs">
            {habits.map((habit) => {
              const color = accentOf(colorHex(habit.colorKey));

              return (
                <Card key={habit.id} className="p-2.5">
                  <div
                    className="text-xs font-semibold uppercase tracking-[0.5px] mb-[0.375rem]"
                    // dynamic: the habit's own colour
                    style={{ color: color.hex }}
                  >
                    {habit.name}
                  </div>

                  <div className="flex gap-[0.25rem]">
                    {weekDateStrs.map((dateStr) => (
                      <div
                        key={dateStr}
                        role="checkbox"
                        aria-checked={wasHabitDone(habit, dateStr)}
                        aria-label={`${habit.name} on ${dateStr}`}
                        onClick={() => toggleTodo(habit.id, dateStr)}
                        className={cn(
                          'w-[1.125rem] h-[1.125rem] border flex items-center justify-center text-xs font-semibold cursor-pointer transition-all',
                          wasHabitDone(habit, dateStr)
                            ? 'text-on-accent'
                            : 'bg-surface border-line-strong text-ink-muted',
                        )}
                        // dynamic: a done square is painted in the habit's own colour
                        style={
                          wasHabitDone(habit, dateStr)
                            ? { backgroundColor: color.hex, borderColor: color.hex }
                            : undefined
                        }
                      >
                        {wasHabitDone(habit, dateStr) ? '✓' : ''}
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}

            <QuickAddField type="habit" className="mt-xs" />
          </div>
        </div>

        {/* Today's Tasks Section, grouped by category */}
        <div>
          <SectionHeading className="text-sm font-bold tracking-[0.5px] text-[var(--t-cat-purple-ink)] mb-2">
            Today's Tasks
          </SectionHeading>

          <div className="space-y-md">
            {todayGroups.map(({ category, todos: rows }) => {
              const cat = categoryById(category);
              return (
                <div key={category || UNCATEGORIZED} className="space-y-xs">
                  <SectionHeading
                    className="text-xs mb-1"
                    // dynamic: the category's own colour
                    style={cat ? { color: accentOf(colorHex(cat.colorKey)).hex } : undefined}
                  >
                    {cat?.name ?? UNCATEGORIZED}
                  </SectionHeading>
                  {rows
                    .slice()
                    .sort((a, b) => (a.important === b.important ? 0 : a.important ? -1 : 1))
                    .map((task) => {
                      // `completions` is a Record<date, value>, never an array —
                      // done-ness comes from the shared helper so it matches
                      // every other surface.
                      const isDone = isDoneOn(task, today);
                      return (
                        <div key={task.id} className="row-hover p-xs flex gap-2 cursor-pointer items-start">
                          <div
                            role="button"
                            aria-label={task.important ? 'Unstar task' : 'Star task'}
                            onClick={() => updateTodo(task.id, { important: !task.important })}
                            className="text-2xl cursor-pointer flex-shrink-0 mt-[-0.375rem]"
                          >
                            {task.important ? '★' : '☆'}
                          </div>

                          <div
                            role="checkbox"
                            aria-checked={isDone}
                            aria-label={task.name}
                            onClick={() => toggleTodo(task.id, today)}
                            className={cn(
                              'w-5 h-5 border flex items-center justify-center flex-shrink-0 mt-[0.375rem] cursor-pointer text-xs',
                              isDone
                                ? 'bg-accent border-accent text-on-accent'
                                : 'bg-surface border-line text-transparent',
                            )}
                          >
                            {isDone ? '✓' : ''}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className={cn('text-sm font-medium text-ink', isDone && 'line-through opacity-60')}>
                              {task.name}
                            </div>
                            <div className="text-xs text-ink-muted mt-[2px]">
                              {task.dueDate === today ? 'Today' : task.dueDate ? 'Due ' + task.dueDate : 'No due date'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}

            {/* Always shown, per the dashboard redesign — not just when empty. */}
            <QuickAddField type="task" />
          </div>
        </div>
      </aside>
    </>
  );
}
