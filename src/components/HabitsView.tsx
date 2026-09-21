import { useState } from 'react';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import QuickAddField from './QuickAddField';
import SearchPalette from './search/SearchPalette';
import { useApp } from '../context/AppContext';
import { fmt } from '../dates';
import { todoKey } from '../itemKeys';
import { byHabitOrder, isRepeating } from '../todoLogic';
import SelectionBar from './bulk/SelectionBar';
import { useListSelection } from './bulk/useListSelection';
import HabitDrawer from './habits/HabitDrawer';
import HabitRow from './habits/HabitRow';
import { buildHabitData, groupHabits, reorderHabits } from './habits/habitModel';
import { toSearchItems } from './search/searchItems';
import { AccordionHeader } from './ui/accordion-header';

export default function HabitsView() {
  const { todos, updateTodo, firstDayOfWeek, categoryById, habitsLayout } = useApp();
  const today = fmt(new Date());

  // Repeating to-dos (habits) in the user's order, grouped per the Settings
  // layout — one headerless group when flat.
  const ordered = todos.filter(isRepeating).sort(byHabitOrder);
  const groups = groupHabits(ordered, habitsLayout);
  const habits = ordered.map((todo) => buildHabitData(todo, firstDayOfWeek, today));

  const orderedKeys = ordered.map(todoKey);
  const selection = useListSelection(orderedKeys, orderedKeys);
  const selectedItems =
    selection.selected.size === 0
      ? []
      : toSearchItems(
          [],
          [],
          ordered.filter((t) => selection.selected.has(todoKey(t))),
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

  // Drag to reorder, within a group. The pointer must travel a little first
  // so a click on the handle's row still selects or opens the drawer.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const group = groups.find((g) => g.todos.some((t) => t.id === active.id));
    if (!group?.todos.some((t) => t.id === over.id)) return;
    for (const patch of reorderHabits(ordered, String(active.id), String(over.id))) {
      updateTodo(patch.id, { sort: patch.sort });
    }
  };

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

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          {groups.map(({ key, label, todos: rows }) => {
            const closed = label !== '' && collapsed.has(key);
            return (
              <div key={key} className="flex flex-col">
                {label !== '' && (
                  <AccordionHeader
                    name={label}
                    count={rows.length}
                    open={!closed}
                    onToggle={() => toggleCollapsed(key)}
                  />
                )}
                {!closed && (
                  <div className="flex flex-col border border-line divide-y divide-dotted divide-line">
                    <SortableContext items={rows.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                      {habits
                        .filter((h) => rows.includes(h.todo))
                        .map((h) => {
                          const open = h.todo.id === expandedId;
                          return (
                            <HabitRow
                              key={h.todo.id}
                              habit={h}
                              today={today}
                              open={open}
                              onToggleOpen={() => setExpanded(open ? null : h.todo.id)}
                              selected={selection.isSelected(todoKey(h.todo))}
                              onRowClick={(e) => selection.onRowClick(e, todoKey(h.todo))}
                              onContextMenu={selection.onContextMenu}
                              draggable={ordered.length > 1}
                            >
                              {open && <HabitDrawer habit={h} />}
                            </HabitRow>
                          );
                        })}
                    </SortableContext>
                    {label === '' && <QuickAddField type="habit" variant="row" />}
                  </div>
                )}
              </div>
            );
          })}
        </DndContext>
        {habitsLayout !== 'flat' && (
          <div className="border border-line">
            <QuickAddField type="habit" variant="row" />
          </div>
        )}
      </div>
    </div>
  );
}
