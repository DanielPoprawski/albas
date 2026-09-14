import { useRef, useState } from 'react';
import { LAYOUT_LIMITS, clampRem } from '../appearance';
import { useApp } from '../context/AppContext';
import AddModal from './AddModal';
import InlineEditor from './InlineEditor';
import QuickAddField from './QuickAddField';
import ResizeHandle from './ResizeHandle';
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
  const { todos, firstDayOfWeek, getSetting, setSetting, categoriesFor, categoryById, hiddenCategoryIds } = useApp();
  /** The one row (habit card or task) whose inline editor is open. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** The "Advanced…" path out of an inline editor. */
  const [editing, setEditing] = useState<Todo | null>(null);
  const toggleExpanded = (id: string) => setExpandedId((cur) => (cur === id ? null : id));

  // Drag state for the panel's own resize handle. Held in a ref, not React
  // state — a pixel-by-pixel setState would re-render this whole panel on
  // every pointermove. The var is written straight onto <html> during the
  // drag; `setSetting` (which persists and re-derives `applyLayout`) only
  // runs once, when the handle reports the drag ended.
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
      <ResizeHandle
        side="left"
        onDelta={handleRightDelta}
        onEnd={commitRightWidth}
        onReset={handleRightReset}
        ariaLabel="Resize right panel"
      />
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
      {editing && <AddModal editTodo={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
