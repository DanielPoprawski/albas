import { useState } from 'react';
import QuickAddField from './QuickAddField';
import SearchPalette from './search/SearchPalette';
import { colorHex } from '../colors';
import { useApp } from '../context/AppContext';
import { fmt } from '../dates';
import { todoKey } from '../itemKeys';
import { GENERAL, groupTasks, isRepeating } from '../todoLogic';
import SelectionBar from './bulk/SelectionBar';
import { useListSelection } from './bulk/useListSelection';
import HabitDrawer from './habits/HabitDrawer';
import HabitRow from './habits/HabitRow';
import { buildHabitData } from './habits/habitModel';
import { toSearchItems } from './search/searchItems';
import { AccordionHeader } from './ui/accordion-header';

export default function HabitsView() {
  const { todos, firstDayOfWeek, categoriesFor, categoryById, hiddenCategoryIds } = useApp();
  const today = fmt(new Date());

  // Repeating to-dos (habits), minus the categories the sidebar has hidden,
  // grouped by category with General first. General is always drawn so
  // there is somewhere to add the first habit.
  const groups = groupTasks(
    todos.filter((t) => isRepeating(t) && !hiddenCategoryIds.has(t.category)),
    categoriesFor('habits').map((c) => c.id),
  );
  if (groups[0]?.category !== '') groups.unshift({ category: '', todos: [] });
  const shown = groups.flatMap((g) => g.todos);
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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    // `flex-1 min-w-0` + a white ground: this is the design's `.main-column`,
    // and as a bare child of the shell's flex row it would otherwise size to
    // its content and let the page grey show through.
    <div className="flex-1 min-w-0 flex flex-col bg-surface overflow-hidden">
      {/* Header */}
      <div className="border-b border-line px-4 py-3 grid grid-cols-[auto_minmax(12.5rem,1fr)_auto] items-center gap-4 flex-shrink-0">
        <h1 className="text-h1 font-heading font-bold text-ink">Habits</h1>
        <SearchPalette scope="habits" className="flex max-md:hidden w-full max-w-[35rem] justify-self-center" />
        <span aria-hidden />
      </div>

      {/* Body - scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {selection.selected.size > 0 && (
          <SelectionBar items={selectedItems} scope="habits" selection={selection} className="mx-0 mb-0" />
        )}

        {groups.map(({ category, todos: rows }) => {
          const cat = categoryById(category);
          const closed = collapsed.has(category);
          return (
            <div key={category || GENERAL} className="flex flex-col">
              <AccordionHeader
                name={cat?.name ?? GENERAL}
                color={cat && colorHex(cat.colorKey)}
                count={rows.length}
                open={!closed}
                onToggle={() => toggleCollapsed(category)}
              />
              {!closed && (
                <div className="flex flex-col border border-line border-t-0 divide-y divide-dotted divide-line">
                  {habits
                    .filter((h) => rows.includes(h.todo))
                    .map((h) => {
                      const open = h.todo.id === expandedId;
                      return (
                        <div key={h.todo.id}>
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
                  <QuickAddField type="habit" variant="row" defaultCategory={category} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
