import { useApp } from '../../context/AppContext';
import type { Todo } from '../../types';

const CATEGORY_DEFS = {
  work: { name: 'Work', color: '#a855f7' },
  personal: { name: 'Personal', color: '#ec4899' },
  shopping: { name: 'Shopping', color: '#10b981' },
  health: { name: 'Health', color: '#06b6d4' },
  finance: { name: 'Finance', color: '#f59e0b' },
} as const;

type CategoryId = keyof typeof CATEGORY_DEFS;
const CATEGORY_IDS: CategoryId[] = ['work', 'personal', 'shopping', 'health', 'finance'];

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

  return (
    <div className="border-l border-r border-b border-border">
      {/* Header */}
      <div
        className="px-[var(--space-12)] py-[var(--space-10)] bg-accent-tint text-accent cursor-pointer flex items-center gap-[var(--space-6)]"
      >
        <span className="text-micro font-bold uppercase tracking-widest flex-1">
          Categories
        </span>
      </div>

      {/* Body */}
      <div className="p-2 space-y-0.5">
        {/* All */}
        <div
          onClick={() => onToggleCategory('all')}
          className="flex items-center gap-[var(--space-10)] px-2 py-2 cursor-pointer hover:bg-subtle transition-colors"
        >
          <div
            className="w-4 h-4 border border-border-strong flex items-center justify-center text-micro font-bold text-white flex-shrink-0"
            style={{
              backgroundColor: allChecked ? 'var(--t-accent)' : 'transparent',
              borderColor: allChecked ? 'var(--t-accent)' : 'var(--t-border-strong)',
            }}
          >
            {allChecked && '✓'}
          </div>
          <span className="text-ui text-ink flex-1">All</span>
        </div>

        {/* Categories */}
        {CATEGORY_IDS.map(catId => {
          const def = CATEGORY_DEFS[catId];
          const checked = checkedCategories[catId];
          const count = getCategoryCount(catId);
          return (
            <div
              key={catId}
              onClick={() => onToggleCategory(catId)}
              className="flex items-center gap-[var(--space-10)] px-2 py-2 cursor-pointer hover:bg-subtle transition-colors"
            >
              <div
                className="w-4 h-4 border border-border-strong flex items-center justify-center text-micro font-bold text-white flex-shrink-0"
                style={{
                  backgroundColor: checked ? def.color : 'transparent',
                  borderColor: checked ? def.color : 'var(--t-border-strong)',
                }}
              >
                {checked && '✓'}
              </div>
              <div className="w-2.5 h-2.5 flex-shrink-0" style={{ backgroundColor: def.color }} />
              <span className="text-ui text-ink flex-1">{def.name}</span>
              <span className="text-meta text-ink-muted">{count}</span>
            </div>
          );
        })}

        {/* Completed */}
        <div
          onClick={() => onToggleCategory('completed')}
          className="flex items-center gap-[var(--space-10)] px-2 py-2 cursor-pointer hover:bg-subtle transition-colors"
        >
          <div
            className="w-4 h-4 border border-border-strong flex items-center justify-center text-micro font-bold text-white flex-shrink-0"
            style={{
              backgroundColor: showCompleted ? 'var(--t-accent)' : 'transparent',
              borderColor: showCompleted ? 'var(--t-accent)' : 'var(--t-border-strong)',
            }}
          >
            {showCompleted && '✓'}
          </div>
          <span className="text-ui text-ink flex-1">Completed</span>
          <span className="text-meta text-ink-muted">{completedCount}</span>
        </div>
      </div>
    </div>
  );
}

/** Check if a task is done */
function isTaskDone(task: Todo): boolean {
  if (task.schedule.type !== 'once') return false;
  return Object.keys(task.completions).length > 0;
}
