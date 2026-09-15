import { useState } from 'react';
import { colorHex } from '../colors';
import { useApp } from '../context/AppContext';
import { fmt } from '../dates';
import { todoKey } from '../itemKeys';
import { byDashboardOrder, GENERAL, isDone } from '../todoLogic';
import TaskRow from './todo/TaskRow';
import AddModal from './AddModal';
import { useInlineEdit } from './useInlineEdit';
import { AccordionHeader } from './ui/accordion-header';
import QuickAddField from './QuickAddField';
import SearchPalette from './search/SearchPalette';
import SelectionBar from './bulk/SelectionBar';
import { useListSelection } from './bulk/useListSelection';
import { toSearchItems } from './search/searchItems';
import type { Todo } from '../types';

export default function TodoViewRedesign() {
  const { todos, categoriesFor, categoryById, firstDayOfWeek, hiddenCategoryIds: hiddenIds, showCompleted } = useApp();
  const categories = categoriesFor('tasks');
  const today = fmt(new Date());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const { expandedId, toggleExpanded, setEditing, editModal } = useInlineEdit();
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

  // General: the default category, topmost
  const generalTasks = hiddenIds.has('')
    ? []
    : visibleActiveTasks.filter((t) => t.category === '').sort(byDashboardOrder);
  const generalCollapsed = collapsedIds.has('');

  // Category sections for active categories with tasks
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

  // Completed section (always last, gray header, optional)
  const completedVisible = showCompleted ? completedTasks.filter(isVisible).sort(byDashboardOrder) : [];

  // Selection runs over the rows in the order they are drawn, so a Shift
  // range reads top to bottom.
  const drawn = [...generalTasks, ...categorySections.flatMap((s) => s.tasks), ...completedVisible];
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
    onEdit: setEditing,
    expanded: expandedId === task.id,
    onToggleExpand: () => toggleExpanded(task.id),
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
        <div className="border-b border-line px-4 py-3 grid grid-cols-[auto_minmax(12.5rem,1fr)_auto] items-center gap-4 flex-shrink-0">
          <h1 className="text-h1 font-heading font-bold text-ink">To-Do</h1>
          <SearchPalette scope="todos" className="flex max-md:hidden w-full max-w-[35rem] justify-self-center" />
          <span aria-hidden />
        </div>

        <QuickAddField type="task" className="mx-4 mt-4 mb-4 shadow-pop" />
        {selection.selected.size > 0 && <SelectionBar items={selectedItems} scope="tasks" selection={selection} />}

        {/* Task List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* General Section: the topmost default category */}
          {generalTasks.length > 0 && (
            <div className="mb-6">
              <AccordionHeader
                name={GENERAL}
                count={generalTasks.length}
                open={!generalCollapsed}
                onToggle={() => handleToggleSection('')}
                onAdd={() => setAddingIn('')}
              />
              {!generalCollapsed && (
                <div className="border border-line border-t-0 divide-y divide-dotted divide-line">
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
              <AccordionHeader
                name={section.name}
                color={section.color}
                count={section.tasks.length}
                open={!section.collapsed}
                onToggle={() => handleToggleSection(section.id)}
                onAdd={() => setAddingIn(section.id)}
              />
              {!section.collapsed && (
                <div className="border border-line border-t-0 divide-y divide-dotted divide-line">
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
              <div className="mb-2.5 flex w-full items-center gap-2 border border-ink-muted/20 bg-ink-muted/8 px-2 py-1 text-xs font-bold uppercase tracking-[0.04em] text-ink-muted">
                <span className="w-2 h-2 flex-shrink-0 bg-ink-muted" />
                <span className="flex-1">Completed</span>
                <span className="font-semibold normal-case">{completedVisible.length}</span>
              </div>
              {/* Completed Tasks */}
              <div className="space-y-[0.375rem] opacity-55">
                {completedVisible.map((task) => (
                  <TaskRow key={task.id} {...rowProps(task)} />
                ))}
              </div>
            </div>
          )}

          {generalTasks.length === 0 && categorySections.length === 0 && (
            <div className="text-center py-6 text-micro text-ink-muted">
              Nothing here yet — type in the "New task" field above to add your first to-do.
            </div>
          )}
        </div>
      </div>

      {editModal}
      {addingIn !== undefined && (
        <AddModal defaultType="task" defaultCategory={addingIn} onClose={() => setAddingIn(undefined)} />
      )}
    </>
  );
}
