import { useApp } from '../../context/AppContext';
import { colorHex } from '../../colors';
import type { Todo } from '../../types';
import { cn } from '@/lib/utils';

interface TodoCategoriesProps {
  /** Task-scoped categories, in the user's Settings order. */
  categories: { id: string; name: string; colorKey: string }[];
  /** Category ids the user has unchecked — empty means "show everything". */
  hiddenIds: Set<string>;
  showCompleted: boolean;
  completedCount: number;
  onToggleCategory: (catId: string | 'all' | 'completed') => void;
}

/** The tick box at the head of a category row; `checked` fills it in. */
const CHECK = 'flex size-3.5 shrink-0 items-center justify-center border border-line-strong text-xs text-accent';
const CHECKED = 'border-accent bg-accent text-on-accent';
const NAME = 'min-w-0 flex-1 text-ink';
const COUNT = 'text-xs text-ink-muted';

export default function TodoCategories({
  categories,
  hiddenIds,
  showCompleted,
  completedCount,
  onToggleCategory,
}: TodoCategoriesProps) {
  const { todos } = useApp();

  // Count uncompleted tasks per category
  const getCategoryCount = (catId: string): number =>
    todos.filter((t) => t.schedule.type === 'once' && !isTaskDone(t) && t.category === catId).length;

  const allChecked = hiddenIds.size === 0;

  /* A plain sidebar section, matching the design and the reference
     screenshot: a `sidebar-title` eyebrow over `.sidebar-item` rows. The
     design file also carries an unused `.categories-card` (bordered box with
     a purple header); the rendered To-Do screen does not use it. */
  return (
    <>
      <div className="sidebar-title">Categories</div>

      <button
        type="button"
        className="sidebar-item w-full gap-2 text-left"
        aria-pressed={allChecked}
        onClick={() => onToggleCategory('all')}
      >
        <span className={cn(CHECK, allChecked && CHECKED)}>{allChecked && '✓'}</span>
        <span className={NAME}>All</span>
      </button>

      {categories.map((cat) => {
        const checked = !hiddenIds.has(cat.id);
        const color = colorHex(cat.colorKey);
        return (
          <button
            type="button"
            key={cat.id}
            className="sidebar-item w-full gap-2 text-left"
            aria-pressed={checked}
            onClick={() => onToggleCategory(cat.id)}
          >
            <span
              className={cn(CHECK, checked && CHECKED)}
              // The tick takes the category's own colour rather than the
              // accent, which is how a checked row reads as *that* category.
              // dynamic: the category's own colour
              style={checked ? { background: color, borderColor: color } : undefined}
            >
              {checked && '✓'}
            </span>
            {/* dynamic: the category's own hex */}
            <span className="size-2 shrink-0" style={{ background: color }} />
            <span className={NAME}>{cat.name}</span>
            <span className={COUNT}>{getCategoryCount(cat.id)}</span>
          </button>
        );
      })}

      <button
        type="button"
        className="sidebar-item w-full gap-2 text-left"
        aria-pressed={showCompleted}
        onClick={() => onToggleCategory('completed')}
      >
        <span className={cn(CHECK, showCompleted && CHECKED)}>{showCompleted && '✓'}</span>
        <span className={NAME}>Completed</span>
        <span className={COUNT}>{completedCount}</span>
      </button>
    </>
  );
}

/** Check if a task is done */
function isTaskDone(task: Todo): boolean {
  if (task.schedule.type !== 'once') return false;
  return Object.keys(task.completions).length > 0;
}
