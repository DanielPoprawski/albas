import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { fmt } from '../dates';
import { todoKey } from '../itemKeys';
import { byDashboardOrder, GENERAL, isDone } from '../todoLogic';
import TaskRow from './todo/TaskRow';
import AddModal from './AddModal';
import QuickAddField from './QuickAddField';
import SearchPalette from './search/SearchPalette';
import SelectionBar from './bulk/SelectionBar';
import { useListSelection } from './bulk/useListSelection';
import { toSearchItems } from './search/searchItems';
import type { Todo } from '../types';
import { colorHex } from '../colors';

/** The section band above a group of tasks; colour comes from the call site. */
const SECTION_TITLE =
  'mb-2.5 flex w-full items-center gap-2 border-0 px-2 py-1 text-xs font-bold uppercase tracking-[0.04em]';
const SECTION_COUNT = 'text-xs font-semibold normal-case';
const SECTION_TOGGLE =
  'flex size-4 shrink-0 cursor-pointer items-center justify-center border border-current bg-transparent p-0 text-xs font-bold text-inherit';

export default function TodoViewRedesign() {
  const { todos, categoriesFor, categoryById, firstDayOfWeek, hiddenCategoryIds: hiddenIds, showCompleted } = useApp();
  const categories = categoriesFor('tasks');
  const today = fmt(new Date());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [editingTodo, setEditingTodo] = useState<Todo | undefined>();
  /** The one row whose inline editor is open. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** The category id to pre-fill when adding from a category's header bar. */
  const [addingIn, setAddingIn] = useState<string | undefined>();

  // Filter to only tasks (not habits/chores)
  const tasks = todos.filter((t) => t.schedule.type === 'once');

  // Separate active and completed tasks
  const activeTasks = tasks.filter((t) => !isDone(t));
  const completedTasks = tasks.filter(isDone);

  const isVisible = (t: Todo) => !hiddenIds.has(t.category);

  // Filter active tasks by checked categories
  const visibleActiveTasks = activeTasks.filter(isVisible);

  // Build sections
  const allSectionTasks = visibleActiveTasks.slice().sort(byDashboardOrder);

  const categorySections = categories
    .filter((c) => !hiddenIds.has(c.id))
    .map((cat) => {
      const catTasks = visibleActiveTasks.filter((t) => t.category === cat.id).sort(byDashboardOrder);
      return {
        id: cat.id,
        name: cat.name,
        color: colorHex(cat.colorKey),
        tasks: catTasks,
        collapsed: collapsedIds.has(cat.id),
      };
    })
    .filter((s) => s.tasks.length > 0);

  // General: the uncategorised tasks get a section of their own, since no
  // category header would ever list them.
  const generalTasks = hiddenIds.has('')
    ? []
    : visibleActiveTasks.filter((t) => t.category === '').sort(byDashboardOrder);
  const generalCollapsed = collapsedIds.has('');

  // Completed section (always last, gray header, optional)
  const completedVisible = showCompleted ? completedTasks.filter(isVisible).sort(byDashboardOrder) : [];

  // Selection runs over the rows in the order they are drawn, so a Shift
  // range reads top to bottom. A task drawn twice (All + its category) is
  // one key; the set dedupes it.
  const drawn = [...allSectionTasks, ...generalTasks, ...categorySections.flatMap((s) => s.tasks), ...completedVisible];
  const orderedKeys = [...new Set(drawn.map(todoKey))];
  const generalKeys = tasks.filter((t) => t.category === '').map(todoKey);
  const selection = useListSelection(orderedKeys, generalKeys);
  const selectedItems =
    selection.selected.size === 0
      ? []
      : toSearchItems(
          [],
          [],
          tasks.filter((t) => selection.selected.has(todoKey(t))),
          categoryById,
          firstDayOfWeek,
          today,
        );

  const rowProps = (task: Todo) => ({
    task,
    today,
    showCategory: true,
    onEdit: () => setEditingTodo(task),
    expanded: expandedId === task.id,
    onToggleExpand: () => setExpandedId((cur) => (cur === task.id ? null : task.id)),
    selected: selection.isSelected(todoKey(task)),
    onRowClick: (e: React.MouseEvent) => selection.onRowClick(e, todoKey(task)),
    onContextMenu: selection.onContextMenu,
  });

  const handleToggleSection = (catId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  return (
    <>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-surface">
        {/* Header */}
        <div className="border-b border-line px-4 py-3 grid grid-cols-[auto_minmax(12.5rem,1fr)_auto] items-center gap-4">
          <h1 className="text-h1 font-heading font-bold">To-Do</h1>
          <SearchPalette scope="todos" className="hidden md:flex w-full max-w-[35rem] justify-self-center" />
          <span aria-hidden />
        </div>

        <QuickAddField type="task" className="mx-4 mt-4 mb-4 shadow-pop" />
        {selection.selected.size > 0 && <SelectionBar items={selectedItems} scope="tasks" selection={selection} />}

        {/* Task List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {allSectionTasks.length > 0 && (
            <div className="mb-6">
              {/* All Section Header */}
              <div className={cn(SECTION_TITLE, 'bg-accent text-on-accent')}>
                All
                <span className={cn(SECTION_COUNT, 'text-on-accent/75')}>{allSectionTasks.length}</span>
              </div>
              {/* All Tasks */}
              <div className="space-y-[0.375rem]">
                {allSectionTasks.map((task) => (
                  <TaskRow key={task.id} {...rowProps(task)} />
                ))}
              </div>
            </div>
          )}

          {/* General Section: the uncategorised tasks */}
          {generalTasks.length > 0 && (
            <div className="mb-6">
              <div className={cn(SECTION_TITLE, 'border border-line bg-subtle text-ink')}>
                <button
                  type="button"
                  onClick={() => handleToggleSection('')}
                  className={SECTION_TOGGLE}
                  aria-expanded={!generalCollapsed}
                  aria-label={generalCollapsed ? `Expand ${GENERAL}` : `Collapse ${GENERAL}`}
                  title={generalCollapsed ? 'Expand' : 'Collapse'}
                >
                  {generalCollapsed ? (
                    <ChevronRight size="0.75rem" strokeWidth={3} />
                  ) : (
                    <ChevronDown size="0.75rem" strokeWidth={3} />
                  )}
                </button>
                <span className="flex-1 text-left">{GENERAL}</span>
                <span className={cn(SECTION_COUNT, 'text-ink-muted')}>{generalTasks.length}</span>
              </div>
              {!generalCollapsed && (
                <div className="space-y-[0.375rem]">
                  {generalTasks.map((task) => (
                    <TaskRow key={task.id} {...rowProps(task)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Category Sections */}
          {categorySections.map((section) => (
            <div key={section.id} className="mb-6">
              {/* Section Header: the bar itself adds a to-do into this List
                  (there is no floating + any more); the chevron at its left
                  edge is what collapses it. */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setAddingIn(section.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setAddingIn(section.id);
                  }
                }}
                className={cn(SECTION_TITLE, 'cursor-pointer text-on-accent transition-[filter] hover:brightness-95')}
                // dynamic: the category's own colour
                style={{ backgroundColor: section.color }}
                title={`Add a to-do to ${section.name}`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleSection(section.id);
                  }}
                  className={SECTION_TOGGLE}
                  aria-expanded={!section.collapsed}
                  aria-label={section.collapsed ? `Expand ${section.name}` : `Collapse ${section.name}`}
                  title={section.collapsed ? 'Expand' : 'Collapse'}
                >
                  {section.collapsed ? (
                    <ChevronRight size="0.75rem" strokeWidth={3} />
                  ) : (
                    <ChevronDown size="0.75rem" strokeWidth={3} />
                  )}
                </button>
                <span className="flex-1 text-left">{section.name}</span>
                <span className={cn(SECTION_COUNT, 'text-on-accent/75')}>{section.tasks.length}</span>
                <Plus size="0.875rem" strokeWidth={3} aria-hidden="true" className="opacity-75" />
              </div>
              {/* Section Tasks */}
              {!section.collapsed && (
                <div className="space-y-[0.375rem]">
                  {section.tasks.map((task) => (
                    <TaskRow key={task.id} {...rowProps(task)} />
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Completed Section */}
          {completedVisible.length > 0 && (
            <div className="mb-6">
              {/* Completed Header */}
              {/* The tint and hairline are the muted ink at 8% / 20% — v4's
                  colour-opacity modifiers, which do the color-mix the old
                  inline style spelled out by hand. */}
              <div className={cn(SECTION_TITLE, 'border border-ink-muted/20 bg-ink-muted/8 text-ink-muted')}>
                <span className="w-2 h-2 flex-shrink-0 bg-ink-muted" />
                <span className="flex-1">Completed</span>
                <span className={SECTION_COUNT}>{completedVisible.length}</span>
              </div>
              {/* Completed Tasks */}
              <div className="space-y-[0.375rem] opacity-55">
                {completedVisible.map((task) => (
                  <TaskRow key={task.id} {...rowProps(task)} />
                ))}
              </div>
            </div>
          )}

          {allSectionTasks.length === 0 && categorySections.length === 0 && (
            <div className="text-center py-6 text-micro text-ink-muted">
              Nothing here yet — type in the "New task" field above to add your first to-do.
            </div>
          )}
        </div>
      </div>

      {editingTodo && <AddModal editTodo={editingTodo} onClose={() => setEditingTodo(undefined)} />}
      {addingIn !== undefined && (
        <AddModal defaultType="task" defaultCategory={addingIn} onClose={() => setAddingIn(undefined)} />
      )}
    </>
  );
}
