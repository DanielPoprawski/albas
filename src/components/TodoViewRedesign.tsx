import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { fmt } from '../dates';
import { seedKey } from '../itemKeys';
import { byDashboardOrder, bySort, GENERAL, isDone, isTask } from '../seedLogic';
import type { Seed } from '../types';
import { AddModal } from './AddModal';
import { SelectionBar } from './bulk/SelectionBar';
import { useListSelection } from './bulk/useListSelection';
import { QuickAddField } from './QuickAddField';
import { SearchPalette } from './search/SearchPalette';
import { toSearchItems } from './search/searchItems';
import { TaskRow } from './todo/TaskRow';
import { AccordionHeader } from './ui/accordion-header';
import { useInlineEdit } from './useInlineEdit';

export function TodoViewRedesign() {
  const { seeds, lists, listById, tagById, colorOf, firstDayOfWeek, hiddenListIds, isVisible, showCompleted } =
    useApp();
  const today = fmt(new Date());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const { expandedId, toggleExpanded, setEditing, editModal } = useInlineEdit();
  /** The list id to pre-fill when adding from a list's header bar. */
  const [addingIn, setAddingIn] = useState<string | undefined>();

  const tasks = seeds.filter(isTask);
  const activeTasks = tasks.filter((t) => !isDone(t));
  const completedTasks = tasks.filter(isDone);

  const visibleActiveTasks = activeTasks.filter(isVisible);

  // General: the unfiled to-dos, topmost
  const generalTasks = hiddenListIds.has('')
    ? []
    : visibleActiveTasks.filter((t) => t.list === '').sort(byDashboardOrder);
  const generalCollapsed = collapsedIds.has('');

  // One section per list with to-dos in it, in the user's order
  const listSections = [...lists]
    .sort(bySort)
    .filter((l) => !hiddenListIds.has(l.id))
    .map((l) => ({
      id: l.id,
      name: l.name,
      tasks: visibleActiveTasks.filter((t) => t.list === l.id).sort(byDashboardOrder),
      collapsed: collapsedIds.has(l.id),
    }))
    .filter((s) => s.tasks.length > 0);

  // Completed section (always last, gray header, optional)
  const completedVisible = showCompleted ? completedTasks.filter(isVisible).sort(byDashboardOrder) : [];

  // Selection runs over the rows in the order they are drawn, so a Shift
  // range reads top to bottom.
  const drawn = [...generalTasks, ...listSections.flatMap((s) => s.tasks), ...completedVisible];
  const orderedKeys = [...new Set(drawn.map(seedKey))];
  const generalKeys = tasks.filter((t) => t.list === '').map(seedKey);
  const selection = useListSelection(orderedKeys, generalKeys);
  const selectedItems =
    selection.selected.size === 0
      ? []
      : toSearchItems(
          tasks.filter((t) => selection.selected.has(seedKey(t))),
          listById,
          tagById,
          colorOf,
          firstDayOfWeek,
          today,
        );

  const rowProps = (task: Seed) => ({
    task,
    today,
    onEdit: setEditing,
    expanded: expandedId === task.id,
    onToggleExpand: () => toggleExpanded(task.id),
    selected: selection.isSelected(seedKey(task)),
    onRowClick: (e: React.MouseEvent) => selection.onRowClick(e, seedKey(task)),
    onContextMenu: selection.onContextMenu,
  });

  const handleToggleSection = (listId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
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

        <QuickAddField kind="task" className="mx-4 mt-4 mb-4 shadow-pop" />
        {selection.selected.size > 0 && <SelectionBar items={selectedItems} scope="tasks" selection={selection} />}

        {/* Task List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* General Section: the unfiled to-dos, topmost */}
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
                <div className="list-rows border-t-0">
                  {generalTasks.map((task) => (
                    <TaskRow key={task.id} {...rowProps(task)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* List Sections */}
          {listSections.map((section) => (
            <div key={section.id} className="mb-6">
              <AccordionHeader
                name={section.name}
                count={section.tasks.length}
                open={!section.collapsed}
                onToggle={() => handleToggleSection(section.id)}
                onAdd={() => setAddingIn(section.id)}
              />
              {!section.collapsed && (
                <div className="list-rows border-t-0">
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
              <div className="mb-2.5 flex w-full items-center gap-2 border border-dashed border-ink-muted/20 bg-ink-muted/8 px-2 py-1 text-xs font-bold uppercase tracking-[0.04em] text-ink-muted">
                <span className="w-2 h-2 flex-shrink-0 bg-ink-muted" />
                <span className="flex-1">Completed</span>
                <span className="font-semibold normal-case">{completedVisible.length}</span>
              </div>
              {/* Completed Tasks */}
              <div className="list-rows opacity-55">
                {completedVisible.map((task) => (
                  <TaskRow key={task.id} {...rowProps(task)} />
                ))}
              </div>
            </div>
          )}

          {generalTasks.length === 0 && listSections.length === 0 && (
            <div className="text-center py-6 text-micro text-ink-muted">
              Nothing here yet — type in the "New task" field above to add your first to-do.
            </div>
          )}
        </div>
      </div>

      {editModal}
      {addingIn !== undefined && (
        <AddModal defaultDoable defaultList={addingIn} onClose={() => setAddingIn(undefined)} />
      )}
    </>
  );
}
