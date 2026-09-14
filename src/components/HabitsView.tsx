import { useState } from 'react';
import QuickAddField from './QuickAddField';
import SearchPalette from './search/SearchPalette';
import { useApp } from '../context/AppContext';
import { fmt } from '../dates';
import { todoKey } from '../itemKeys';
import { isRepeating } from '../todoLogic';
import SelectionBar from './bulk/SelectionBar';
import { useListSelection } from './bulk/useListSelection';
import HabitDrawer from './habits/HabitDrawer';
import HabitRow from './habits/HabitRow';
import { buildHabitData } from './habits/habitModel';
import { toSearchItems } from './search/searchItems';

export default function HabitsView() {
  const { todos, firstDayOfWeek, categoryById, hiddenCategoryIds } = useApp();
  const today = fmt(new Date());

  // Repeating to-dos (habits), minus the categories the sidebar has hidden.
  const shown = todos.filter((t) => isRepeating(t) && !hiddenCategoryIds.has(t.category));
  const habits = shown.map((todo) => buildHabitData(todo, firstDayOfWeek, today));

  const orderedKeys = shown.map(todoKey);
  const generalKeys = shown.filter((t) => t.category === '').map(todoKey);
  const selection = useListSelection(orderedKeys, generalKeys);
  const selectedItems =
    selection.selected.size === 0
      ? []
      : toSearchItems(
          [],
          [],
          shown.filter((t) => selection.selected.has(todoKey(t))),
          categoryById,
          firstDayOfWeek,
          today,
        );

  // One drawer open at a time; the first habit's, to begin with, so the page
  // shows what a drawer holds without a click. `undefined` = never touched.
  const [expanded, setExpanded] = useState<string | null | undefined>(undefined);
  const expandedId = expanded === undefined ? (habits[0]?.todo.id ?? null) : expanded;

  return (
    // `flex-1 min-w-0` + a white ground: this is the design's `.main-column`,
    // and as a bare child of the shell's flex row it would otherwise size to
    // its content and let the page grey show through.
    <div className="flex-1 min-w-0 flex flex-col bg-surface overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[auto_minmax(12.5rem,1fr)_auto] items-center gap-4 px-6 py-4 border-b border-[var(--t-border)]">
        <div className="flex flex-col gap-[2px]">
          <h1 className="font-heading text-lg font-bold text-[var(--t-ink)]">Habits</h1>
          <p className="text-sm text-[var(--t-ink-muted)]">Build consistency, one day at a time.</p>
        </div>
        <SearchPalette scope="habits" className="hidden md:flex w-full max-w-[35rem] justify-self-center" />
        <span aria-hidden />
      </div>

      {/* Body - scrollable */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
        {selection.selected.size > 0 && (
          <SelectionBar items={selectedItems} scope="habits" selection={selection} className="mx-0 mb-0" />
        )}

        <div className="flex flex-col border border-line">
          {habits.map((h) => {
            const open = h.todo.id === expandedId;
            return (
              <div key={h.todo.id} className="border-b border-line">
                <HabitRow
                  habit={h}
                  today={today}
                  open={open}
                  onToggleOpen={() => setExpanded(open ? null : h.todo.id)}
                  selected={selection.isSelected(todoKey(h.todo))}
                  onRowClick={(e) => selection.onRowClick(e, todoKey(h.todo))}
                  onContextMenu={selection.onContextMenu}
                />
                {open && <HabitDrawer habit={h} />}
              </div>
            );
          })}
          <QuickAddField type="habit" variant="row" />
        </div>
      </div>
    </div>
  );
}
