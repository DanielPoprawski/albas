import { useApp } from '../context/AppContext';
import InlineEditor from './InlineEditor';
import QuickAddField from './QuickAddField';
import { useInlineEdit } from './useInlineEdit';
import { fmt, weekOf } from '../dates';
import { byDashboardOrder, byHabitOrder, bySort, dashboardHabits, dashboardTasks, groupByList } from '../seedLogic';
import type { Seed } from '../types';
import { COLOR_CLASSES } from '../colors';
import { cn } from '@/lib/utils';
import { Icon } from './ui/icon';
import { SectionHeading } from './ui/section-heading';
import HabitStrip, { StripLabels } from './habits/HabitStrip';
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

  // Get today's date
  const today = fmt(new Date());

  // This week's dates (7 days)
  const weekDateStrs = weekOf(new Date(), firstDayOfWeek);

  // Minus what the sidebar has hidden; habits with something to tick this
  // week or the next few days, in the user's order.
  const visible = seeds.filter(isVisible);
  const habits = dashboardHabits(visible, weekDateStrs[0], today, firstDayOfWeek).sort(byHabitOrder);

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
      <aside className="flex-none h-full w-80 bg-page flex flex-col px-4 py-4 overflow-y-auto scrollbar-hide">
        {/* Habits: one borderless line each — name, then the week's cells
            under a single row of weekday initials. */}
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <SectionHeading className="text-sm font-bold tracking-wider text-accent-deep">Habits</SectionHeading>
            <StripLabels dates={weekDateStrs} today={today} cellClass="size-3.5" />
          </div>

          {habits.map((habit) => {
            const color = colorOf(habit);
            const icon = iconOf(habit);
            return (
              <div key={habit.id}>
                <div className="flex items-center gap-2 py-0.5">
                  <button
                    type="button"
                    aria-expanded={expandedId === habit.id}
                    onClick={() => toggleExpanded(habit.id)}
                    className={cn(
                      'micro-label flex min-w-0 flex-1 items-center gap-1 text-left hover:underline',
                      COLOR_CLASSES[color].text,
                    )}
                  >
                    {icon && <Icon name={icon} size="0.75rem" />}
                    <span className="truncate">{habit.title}</span>
                  </button>
                  <HabitStrip
                    seed={habit}
                    cells={cellsFor(habit, weekDateStrs, firstDayOfWeek, today)}
                    color={color}
                    today={today}
                    cellClass="size-3.5"
                    labels={false}
                    className="shrink-0"
                  />
                </div>

                {expandedId === habit.id && (
                  <InlineEditor seed={habit} autoFocusTitle onAdvanced={() => setEditing(habit)} className="my-2" />
                )}
              </div>
            );
          })}

          <QuickAddField kind="habit" className="mt-xs" />
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
