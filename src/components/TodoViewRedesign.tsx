import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { isDone } from '../todoLogic';
import { SidebarSlot } from './AppShell';
import TodoCategories from './todo/TodoCategories';
import TodoTaskRow from './todo/TodoTaskRow';
import AddModal from './AddModal';
import type { Todo } from '../types';
import { TODO_CATEGORIES } from '../colors';

/**
 * One source for the starter categories and their colours: `src/colors.ts`.
 * This file, `todo/TodoCategories.tsx` and `AddModal.tsx` each used to declare
 * their own copy, and the three disagreed — "Work" was purple in two of them
 * and blue in the third, so a task's category changed colour as you moved
 * between screens.
 */
const CATEGORY_DEFS: Record<string, { name: string; color: string }> = Object.fromEntries(
  TODO_CATEGORIES.map(c => [c.label.toLowerCase(), { name: c.label, color: c.hex }]),
);

type CategoryId = string;
const CATEGORY_IDS: CategoryId[] = TODO_CATEGORIES.map(c => c.label.toLowerCase());

/** Sorting function: important first, then by due date, then by time added */
function sortTasks(a: Todo, b: Todo): number {
  // Important first
  if (a.important !== b.important) {
    return a.important ? -1 : 1;
  }
  // Then by due date
  const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  if (aDue !== bDue) {
    return aDue - bDue;
  }
  // Then by time added (createdAt)
  const aCreated = new Date(a.createdAt).getTime();
  const bCreated = new Date(b.createdAt).getTime();
  return aCreated - bCreated;
}

export default function TodoViewRedesign() {
  const { todos } = useApp();
  const [checkedCategories, setCheckedCategories] = useState<Record<CategoryId, boolean>>({
    work: true,
    personal: true,
    shopping: true,
    health: true,
    finance: true,
  });
  const [showCompleted, setShowCompleted] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState<Record<CategoryId, boolean>>({
    work: false,
    personal: false,
    shopping: false,
    health: false,
    finance: false,
  });
  const [editingTodo, setEditingTodo] = useState<Todo | undefined>();
  // Separate from `editingTodo`: "add" has no todo to carry, so reusing that
  // state for it (setEditingTodo(undefined)) rendered nothing at all.
  const [adding, setAdding] = useState(false);

  // Filter to only tasks (not habits/chores)
  const tasks = todos.filter(t => t.schedule.type === 'once');

  // Separate active and completed tasks
  const activeTasks = tasks.filter(t => !isDone(t));
  const completedTasks = tasks.filter(isDone);

  // Get active category IDs
  const activeCategories = CATEGORY_IDS.filter(id => checkedCategories[id]);

  // Filter active tasks by checked categories
  const visibleActiveTasks = activeTasks.filter(t => {
    const catId = getCategoryId(t.category);
    return catId ? checkedCategories[catId] : true;
  });

  // Build sections
  const allSectionTasks = visibleActiveTasks.slice().sort(sortTasks);

  const categorySections = activeCategories
    .map(catId => {
      const def = CATEGORY_DEFS[catId];
      const catTasks = visibleActiveTasks
        .filter(t => getCategoryId(t.category) === catId)
        .sort(sortTasks);
      return {
        id: catId,
        name: def.name,
        color: def.color,
        tasks: catTasks,
        collapsed: !!collapsedSections[catId],
      };
    })
    .filter(s => s.tasks.length > 0);

  // Completed section (always last, gray header, optional)
  const completedVisible = completedTasks
    .filter(t => {
      const catId = getCategoryId(t.category);
      return catId ? checkedCategories[catId] : true;
    })
    .sort(sortTasks);

  const handleToggleCategory = (catId: CategoryId | 'all' | 'completed') => {
    if (catId === 'all') {
      const allOn = activeCategories.length === CATEGORY_IDS.length;
      const next = { ...checkedCategories };
      CATEGORY_IDS.forEach(id => {
        next[id] = !allOn;
      });
      setCheckedCategories(next);
    } else if (catId === 'completed') {
      setShowCompleted(!showCompleted);
    } else {
      setCheckedCategories(prev => ({ ...prev, [catId]: !prev[catId] }));
    }
  };

  const handleToggleSection = (catId: CategoryId) => {
    setCollapsedSections(prev => ({ ...prev, [catId]: !prev[catId] }));
  };

  return (
    <>
      <SidebarSlot>
        <TodoCategories
          activeCategories={activeCategories}
          checkedCategories={checkedCategories}
          showCompleted={showCompleted}
          completedCount={completedVisible.length}
          onToggleCategory={handleToggleCategory}
        />
      </SidebarSlot>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-surface">
        {/* Header */}
        <div className="border-b border-border px-[var(--space-16)] py-[var(--space-16)]">
          <h1 className="text-h1 font-heading font-bold">To-Do</h1>
        </div>

        {/* Add Task Card */}
        <div className="mx-[var(--space-16)] mt-[var(--space-16)] mb-[var(--space-16)] p-[var(--space-14)] bg-surface border border-border shadow-pop flex items-center gap-[var(--space-10)]">
          <div className="w-5 h-5 flex-shrink-0 border-2 border-border" />
          <input
            type="text"
            placeholder="Add a task"
            // Readonly: it opens the modal rather than accepting text. The
            // focus ring stays — a keyboard user has no other way to tell this
            // is the control they are on.
            className="flex-1 text-ui font-body bg-transparent border-none"
            readOnly
            onClick={() => setAdding(true)}
          />
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto px-[var(--space-16)] pb-[var(--space-16)]">
          {allSectionTasks.length > 0 && (
            <div className="mb-[var(--space-24)]">
              {/* All Section Header */}
              <div className="task-section-title bg-accent text-white">
                All
                <span className="task-section-count text-white/75">{allSectionTasks.length}</span>
              </div>
              {/* All Tasks */}
              <div className="space-y-[6px]">
                {allSectionTasks.map(task => (
                  <TodoTaskRow
                    key={task.id}
                    task={task}
                    onEdit={() => setEditingTodo(task)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Category Sections */}
          {categorySections.map(section => (
            <div key={section.id} className="mb-[var(--space-24)]">
              {/* Section Header */}
              <button
                onClick={() => handleToggleSection(section.id)}
                className="task-section-title text-white cursor-pointer"
                style={{ backgroundColor: section.color }}
                aria-expanded={!section.collapsed}
              >
                <span className="task-section-toggle" aria-hidden="true">
                  {section.collapsed ? '+' : '−'}
                </span>
                <span className="flex-1 text-left">{section.name}</span>
                <span className="task-section-count text-white/75">
                  {section.tasks.length}
                </span>
              </button>
              {/* Section Tasks */}
              {!section.collapsed && (
                <div className="space-y-[6px]">
                  {section.tasks.map(task => (
                    <TodoTaskRow
                      key={task.id}
                      task={task}
                      onEdit={() => setEditingTodo(task)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Completed Section */}
          {showCompleted && completedVisible.length > 0 && (
            <div className="mb-[var(--space-24)]">
              {/* Completed Header */}
              {/* The tint and hairline are derived from the muted ink with
                  color-mix; Tailwind v3's `bg-opacity-*` was dropped in v4 and
                  was silently painting this band a solid grey. */}
              <div
                className="task-section-title text-ink-muted border"
                style={{
                  background: 'color-mix(in srgb, var(--t-ink-muted) 8%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--t-ink-muted) 20%, transparent)',
                }}
              >
                <span
                  className="w-2 h-2 flex-shrink-0"
                  style={{ backgroundColor: 'var(--t-ink-muted)' }}
                />
                <span className="flex-1">Completed</span>
                <span className="task-section-count">{completedVisible.length}</span>
              </div>
              {/* Completed Tasks */}
              <div className="space-y-[6px] opacity-55">
                {completedVisible.map(task => (
                  <TodoTaskRow
                    key={task.id}
                    task={task}
                    done
                    onEdit={() => setEditingTodo(task)}
                  />
                ))}
              </div>
            </div>
          )}

          {allSectionTasks.length === 0 && categorySections.length === 0 && (
            <div className="text-center py-[var(--space-24)] text-micro text-ink-muted">
              Nothing here yet — hit + to add your first to-do.
            </div>
          )}
        </div>
      </div>

      {editingTodo && <AddModal editTodo={editingTodo} onClose={() => setEditingTodo(undefined)} />}
      {adding && <AddModal defaultType="task" onClose={() => setAdding(false)} />}

      {/* FAB Button */}
      <button
        onClick={() => setAdding(true)}
        className="add-fab"
        title="Add a to-do"
      >
        +
      </button>
    </>
  );
}

/** Get the category ID for a task, or undefined if uncategorized */
function getCategoryId(category: string): CategoryId | undefined {
  if (!category) return undefined;
  const normalized = category.toLowerCase();
  return CATEGORY_IDS.find(id => CATEGORY_DEFS[id].name.toLowerCase() === normalized) as CategoryId | undefined;
}
