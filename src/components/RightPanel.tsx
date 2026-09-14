import { StarButton } from './ui/star';
import { useRef, useState } from 'react';
import { LAYOUT_LIMITS, clampRem } from '../appearance';
import { useApp } from '../context/AppContext';
import AddModal from './AddModal';
import InlineEditor from './InlineEditor';
import QuickAddField from './QuickAddField';
import ResizeHandle from './ResizeHandle';
import { fmt, shortDate, weekOf } from '../dates';
import { byDashboardOrder, dashboardTasks, groupTasks, isDoneOn, isRepeating } from '../todoLogic';
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
  const {
    todos,
    firstDayOfWeek,
    toggleTodo,
    updateTodo,
    getSetting,
    setSetting,
    categoriesFor,
    categoryById,
    hiddenCategoryIds,
  } = useApp();
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

  // Helper to check if a habit was done on a specific date
  const wasHabitDone = (habit: Todo, dateStr: string): boolean => {
    return isDoneOn(habit, dateStr);
  };

  const taskRowProps = (task: Todo) => ({
    task,
    today,
    onToggle: toggleTodo,
    onStar: updateTodo,
    expanded: expandedId === task.id,
    onToggleExpand: () => toggleExpanded(task.id),
    onAdvanced: () => setEditing(task),
  });

  // A habit draws in the colour the user picked for it — `accentOf(colorHex(…))`,
  // the same pair `HabitsView` uses. This used to cycle a fixed palette by list
  // index, which meant `colorKey` was ignored outright and a habit was one
  // colour here and a different one on the Habits screen.

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
              const color = accentOf(colorHex(habit.colorKey));

              return (
                <Card key={habit.id} className="p-2.5">
                  <button
                    type="button"
                    aria-expanded={expandedId === habit.id}
                    onClick={() => toggleExpanded(habit.id)}
                    className="block w-full text-left truncate text-xs font-semibold uppercase tracking-[0.5px] mb-[0.375rem] hover:underline"
                    // dynamic: the habit's own colour
                    style={{ color: color.hex }}
                  >
                    {habit.name}
                  </button>

                  {expandedId === habit.id && (
                    <InlineEditor todo={habit} autoFocusTitle onAdvanced={() => setEditing(habit)} className="mb-2" />
                  )}

                  <div className="flex gap-[0.25rem]">
                    {weekDateStrs.map((dateStr) => (
                      <button
                        key={dateStr}
                        type="button"
                        aria-pressed={wasHabitDone(habit, dateStr)}
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
                      </button>
                    ))}
                  </div>
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

/** When a to-do is wanted, relative to today: overdue reads in the danger colour. */
function dueLine(task: Todo, today: string): { text: string; late: boolean } {
  if (!task.dueDate) return { text: 'No due date', late: false };
  if (task.dueDate === today) return { text: 'Today', late: false };
  if (task.dueDate < today) return { text: `Overdue · ${shortDate(task.dueDate)}`, late: true };
  return { text: `Due ${shortDate(task.dueDate)}`, late: false };
}

function TaskRow({
  task,
  today,
  onToggle,
  onStar,
  expanded,
  onToggleExpand,
  onAdvanced,
}: {
  task: Todo;
  today: string;
  onToggle: (id: string, date: string) => void;
  onStar: (id: string, patch: Partial<Omit<Todo, 'id' | 'completions'>>) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onAdvanced: () => void;
}) {
  // `completions` is a Record<date, value>, never an array — done-ness comes
  // from the shared helper so it matches every other surface.
  const isDone = isDoneOn(task, today);
  const due = dueLine(task, today);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggleExpand}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleExpand();
        }
      }}
      className="row-hover p-xs flex flex-wrap gap-2 cursor-pointer items-start"
    >
      <StarButton important={task.important} onToggle={() => onStar(task.id, { important: !task.important })} />

      <button
        type="button"
        role="checkbox"
        aria-checked={isDone}
        aria-label={isDone ? `Mark "${task.name}" not done` : `Mark "${task.name}" done`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task.id, today);
        }}
        className={cn(
          'w-5 h-5 border flex items-center justify-center flex-shrink-0 mt-[0.375rem] cursor-pointer text-xs',
          isDone ? 'bg-accent border-accent text-on-accent' : 'bg-surface border-line text-transparent',
        )}
      >
        {isDone ? '✓' : ''}
      </button>

      <div className="flex-1 min-w-0">
        <div className={cn('text-sm font-medium text-ink', isDone && 'line-through opacity-60')}>{task.name}</div>
        <div className={cn('text-xs mt-[2px]', due.late && !isDone ? 'text-danger' : 'text-ink-muted')}>{due.text}</div>
      </div>

      {expanded && <InlineEditor todo={task} autoFocusTitle onAdvanced={onAdvanced} className="basis-full pt-1" />}
    </div>
  );
}
