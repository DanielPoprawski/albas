import { useApp } from '../../context/AppContext';
import type { Todo } from '../../types';
import { TODO_CATEGORIES } from '../../colors';

/**
 * Derived from `TODO_CATEGORIES` in `src/colors.ts` rather than declared here.
 * This list and the Add modal's used to be separate copies that disagreed —
 * "Work" was purple here and blue there — so a category's colour depended on
 * which screen you were looking at.
 */
const CATEGORY_DEFS = Object.fromEntries(
  TODO_CATEGORIES.map(c => [c.label.toLowerCase(), { name: c.label, color: c.hex }]),
) as Record<string, { name: string; color: string }>;

type CategoryId = string;
const CATEGORY_IDS: CategoryId[] = TODO_CATEGORIES.map(c => c.label.toLowerCase());

interface TodoCategoriesProps {
  activeCategories: CategoryId[];
  checkedCategories: Record<CategoryId, boolean>;
  showCompleted: boolean;
  completedCount: number;
  onToggleCategory: (catId: CategoryId | 'all' | 'completed') => void;
}

export default function TodoCategories({
  activeCategories,
  checkedCategories,
  showCompleted,
  completedCount,
  onToggleCategory,
}: TodoCategoriesProps) {
  const { todos } = useApp();

  // Count uncompleted tasks per category
  const getCategoryCount = (catId: CategoryId): number => {
    const catName = CATEGORY_DEFS[catId].name;
    return todos.filter(
      t =>
        t.schedule.type === 'once' &&
        !isTaskDone(t) &&
        t.category.toLowerCase() === catName.toLowerCase()
    ).length;
  };

  const allChecked = activeCategories.length === CATEGORY_IDS.length;

  /* A plain sidebar section, matching the design and the reference
     screenshot: a `sidebar-title` eyebrow over `.category-item` rows. The
     design file also carries an unused `.categories-card` (bordered box with
     a purple header); the rendered To-Do screen does not use it. */
  return (
    <>
      <div className="sidebar-title">Categories</div>

      <button
        type="button"
        className="category-item"
        aria-pressed={allChecked}
        onClick={() => onToggleCategory('all')}
      >
        <span className={`category-check${allChecked ? ' checked' : ''}`}>
          {allChecked && '✓'}
        </span>
        <span className="category-name">All</span>
      </button>

      {CATEGORY_IDS.map(catId => {
        const def = CATEGORY_DEFS[catId];
        const checked = checkedCategories[catId];
        return (
          <button
            type="button"
            key={catId}
            className="category-item"
            aria-pressed={checked}
            onClick={() => onToggleCategory(catId)}
          >
            <span
              className={`category-check${checked ? ' checked' : ''}`}
              // The tick takes the category's own colour rather than the
              // accent, which is how a checked row reads as *that* category.
              style={checked ? { background: def.color, borderColor: def.color } : undefined}
            >
              {checked && '✓'}
            </span>
            <span className="category-color" style={{ background: def.color }} />
            <span className="category-name">{def.name}</span>
            <span className="category-count">{getCategoryCount(catId)}</span>
          </button>
        );
      })}

      <button
        type="button"
        className="category-item"
        aria-pressed={showCompleted}
        onClick={() => onToggleCategory('completed')}
      >
        <span className={`category-check${showCompleted ? ' checked' : ''}`}>
          {showCompleted && '✓'}
        </span>
        <span className="category-name">Completed</span>
        <span className="category-count">{completedCount}</span>
      </button>
    </>
  );
}

/** Check if a task is done */
function isTaskDone(task: Todo): boolean {
  if (task.schedule.type !== 'once') return false;
  return Object.keys(task.completions).length > 0;
}
