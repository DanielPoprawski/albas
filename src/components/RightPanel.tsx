import { useApp } from '../context/AppContext';
import InlineEditor from './InlineEditor';
import QuickAddField from './QuickAddField';
import ResizeHandle, { useResizableWidth } from './ResizeHandle';
import { useInlineEdit } from './useInlineEdit';
import { fmt, weekOf } from '../dates';
import { byDashboardOrder, dashboardTasks, groupTasks, isRepeating } from '../todoLogic';
import type { Todo } from '../types';
import { accentOf, colorHex } from '../colors';
import { Card } from './ui/card';
import { SectionHeading } from './ui/section-heading';
import HabitStrip from './habits/HabitStrip';
import { cellsFor } from './habits/habitModel';
import TaskRow from './todo/TaskRow';

/**
 * The calendar's companion column — habits and tasks beside the month.
 *
 * `AppShell` mounts it for the calendar view only. It displays habits with
 * weekly checkboxes and today's tasks.
 */
export default function RightPanel() {
  const { todos, firstDayOfWeek, categoriesFor, categoryById, hiddenCategoryIds } = useApp();
  const { expandedId, toggleExpanded, setEditing, editModal } = useInlineEdit();
  // The handle sits on the panel's *left* edge, so dragging left widens it.
  const resize = useResizableWidth('right', -1);

  // Get today's date
  const today = fmt(new Date());

  // Habits and tasks, minus the categories the sidebar has hidden
  const visible = todos.filter((t) => !hiddenCategoryIds.has(t.category));
  const habits = visible.filter(isRepeating);

  // Get this week's dates (7 days)
  const weekDateStrs = weekOf(new Date(), firstDayOfWeek);

  // The task panel: undated, due-today, overdue and starred to-dos (see
  // `dashboardTasks`). Uncategorised ones form the top "Tasks" list — that's
  // where a quick-add lands, so it must never be buried — and each category
  // gets its own list below, all in dashboard order.
  const shown = dashboardTasks(visible, today);
  const taskOrder = categoriesFor('tasks').map((c) => c.id);
  const groups = groupTasks(shown, taskOrder).map((g) => ({ ...g, todos: g.todos.sort(byDashboardOrder) }));
  const topTasks = groups.find((g) => g.category === '')?.todos ?? [];
  const categoryGroups = groups.filter((g) => g.category !== '');

  const taskRowProps = (task: Todo) => ({
    task,
    today,
    onEdit: setEditing,
    expanded: expandedId === task.id,
    onToggleExpand: () => toggleExpanded(task.id),
    className: 'px-2 py-1.5',
  });

  return (
    <>
      {/* Sits on the panel's left edge, as a sibling flex item in
          `.shell-content` — not absolutely positioned over the panel — so its
          own 0.5rem is genuinely reserved (see MonthViewDesktop's RESERVED). */}
      <ResizeHandle side="left" {...resize} ariaLabel="Resize right panel" />
      <aside className="flex-none h-full w-[var(--layout-right-w,20rem)] border-l border-line bg-surface flex flex-col px-4 py-4 overflow-y-auto scrollbar-hide">
        {/* Habits Section */}
        <div className="mb-4">
          <SectionHeading className="text-sm font-bold tracking-[0.5px] text-[var(--t-cat-purple-ink)] mb-2">
            Habits
          </SectionHeading>

          <div className="space-y-xs">
            {habits.map((habit) => {
              const hex = colorHex(habit.colorKey);
              return (
                <Card key={habit.id} className="p-2.5">
                  <button
                    type="button"
                    aria-expanded={expandedId === habit.id}
                    onClick={() => toggleExpanded(habit.id)}
                    className="block w-full text-left truncate text-xs font-semibold uppercase tracking-[0.5px] mb-[0.375rem] hover:underline"
                    // dynamic: the habit's own colour
                    style={{ color: hex }}
                  >
                    {habit.name}
                  </button>

                  {expandedId === habit.id && (
                    <InlineEditor todo={habit} autoFocusTitle onAdvanced={() => setEditing(habit)} className="mb-2" />
                  )}

                  <HabitStrip
                    todo={habit}
                    cells={cellsFor(habit, weekDateStrs, firstDayOfWeek, today)}
                    color={hex}
                    today={today}
                    cellClass="size-[1.125rem]"
                  />
                </Card>
              );
            })}

            <QuickAddField type="habit" className="mt-xs" />
          </div>
        </div>

        {/* Tasks: the uncategorised list first, then one list per category */}
        <div>
          <SectionHeading className="text-sm font-bold tracking-[0.5px] text-[var(--t-cat-purple-ink)] mb-2">
            Tasks
          </SectionHeading>

          <div className="space-y-md">
            <div className="space-y-xs">
              {topTasks.map((task) => (
                <TaskRow key={task.id} {...taskRowProps(task)} />
              ))}
            </div>
            {categoryGroups.map(({ category, todos: rows }) => {
              const cat = categoryById(category);
              return (
                <div key={category} className="space-y-xs">
                  <SectionHeading
                    className="text-xs mb-1"
                    // dynamic: the category's own colour
                    style={cat ? { color: accentOf(colorHex(cat.colorKey)).hex } : undefined}
                  >
                    {cat?.name ?? category}
                  </SectionHeading>
                  {rows.map((task) => (
                    <TaskRow key={task.id} {...taskRowProps(task)} />
                  ))}
                </div>
              );
            })}

            {/* Always shown, per the dashboard redesign — not just when empty. */}
            <QuickAddField type="task" />
          </div>
        </div>
      </aside>
      {editModal}
    </>
  );
}
