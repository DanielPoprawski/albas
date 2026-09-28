import { useApp } from '../context/AppContext';
import InlineEditor from './InlineEditor';
import QuickAddField from './QuickAddField';
import ResizeHandle, { useResizableWidth } from './ResizeHandle';
import { useInlineEdit } from './useInlineEdit';
import { fmt, weekOf } from '../dates';
import { byDashboardOrder, byHabitOrder, bySort, dashboardTasks, groupByList, isHabit } from '../seedLogic';
import type { Seed } from '../types';
import { COLOR_CLASSES } from '../colors';
import { cn } from '@/lib/utils';
import { Card } from './ui/card';
import { Icon } from './ui/icon';
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
  const { seeds, lists, firstDayOfWeek, listById, colorOf, iconOf, isVisible } = useApp();
  const { expandedId, toggleExpanded, setEditing, editModal } = useInlineEdit();
  // The handle sits on the panel's *left* edge, so dragging left widens it.
  const resize = useResizableWidth('right', -1);

  // Get today's date
  const today = fmt(new Date());

  // Minus what the sidebar has hidden; habits in the user's order.
  const visible = seeds.filter(isVisible);
  const habits = visible.filter(isHabit).sort(byHabitOrder);

  // Get this week's dates (7 days)
  const weekDateStrs = weekOf(new Date(), firstDayOfWeek);

  // The task panel: undated, due-today, overdue and starred to-dos (see
  // `dashboardTasks`). Unfiled ones form the top "Tasks" list — that's where
  // a quick-add lands, so it must never be buried — and each list gets its
  // own group below, all in dashboard order.
  const shown = dashboardTasks(visible, today);
  const order = [...lists].sort(bySort).map((l) => l.id);
  const groups = groupByList(shown, order).map((g) => ({ ...g, seeds: g.seeds.sort(byDashboardOrder) }));
  const topTasks = groups.find((g) => g.list === '')?.seeds ?? [];
  const listGroups = groups.filter((g) => g.list !== '');

  const taskRowProps = (task: Seed) => ({
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
          <SectionHeading className="text-sm font-bold tracking-wider text-accent-deep mb-2">Habits</SectionHeading>

          <div className="space-y-xs">
            {habits.map((habit) => {
              const color = colorOf(habit);
              const icon = iconOf(habit);
              return (
                <Card key={habit.id} className="p-2.5">
                  <button
                    type="button"
                    aria-expanded={expandedId === habit.id}
                    onClick={() => toggleExpanded(habit.id)}
                    className={cn(
                      'micro-label flex items-center gap-1 w-full text-left truncate mb-[0.375rem] hover:underline',
                      COLOR_CLASSES[color].text,
                    )}
                  >
                    {icon && <Icon name={icon} size="0.75rem" />}
                    {habit.title}
                  </button>

                  {expandedId === habit.id && (
                    <InlineEditor seed={habit} autoFocusTitle onAdvanced={() => setEditing(habit)} className="mb-2" />
                  )}

                  <HabitStrip
                    seed={habit}
                    cells={cellsFor(habit, weekDateStrs, firstDayOfWeek, today)}
                    color={color}
                    today={today}
                    cellClass="size-[1.125rem]"
                  />
                </Card>
              );
            })}

            <QuickAddField kind="habit" className="mt-xs" />
          </div>
        </div>

        {/* Tasks: the unfiled list first, then one group per list */}
        <div>
          <SectionHeading className="text-sm font-bold tracking-wider text-accent-deep mb-2">Tasks</SectionHeading>

          <div className="space-y-md">
            <div className="list-rows">
              {topTasks.map((task) => (
                <TaskRow key={task.id} {...taskRowProps(task)} />
              ))}
            </div>
            {listGroups.map(({ list, seeds: rows }) => (
              <div key={list}>
                <SectionHeading className="text-xs mb-1">{listById(list)?.name ?? list}</SectionHeading>
                <div className="list-rows">
                  {rows.map((task) => (
                    <TaskRow key={task.id} {...taskRowProps(task)} />
                  ))}
                </div>
              </div>
            ))}

            {/* Always shown, per the dashboard redesign — not just when empty. */}
            <QuickAddField kind="task" />
          </div>
        </div>
      </aside>
      {editModal}
    </>
  );
}
