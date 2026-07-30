import { useState } from 'react';
import { useApp } from '../context/AppContext';
import AddModal from './AddModal';
import HabitsSection from './todo/HabitsSection';
import TasksSection from './todo/TasksSection';
import { isRepeating } from '../todoLogic';
import type { Todo } from '../types';

/**
 * The list surface: optionally habits and chores on top, then one-time tasks
 * grouped by category.
 *
 * `habits` is off in the To-Do view and on in the calendar's right panel. The
 * two surfaces answer different questions — the panel is a companion to a
 * month you're looking at, where "am I keeping this up" belongs; the To-Do view
 * is the list of things left to do, and a habit is never *done*, so it only
 * padded the top of the page. Habits also cost a full week strip per row, which
 * is most of a 280px panel and none of a full-width view.
 */
export default function TodoPanel({ habits = false }: { habits?: boolean }) {
  const { todos } = useApp();
  const [editing, setEditing] = useState<Todo | null>(null);

  // "nothing here yet" has to mean nothing *this surface would show*, or the
  // To-Do view stays blank and silent for someone who only has habits
  const visible = habits ? todos : todos.filter(t => !isRepeating(t));

  return (
    <div className="mb-lg px-xs">
      {habits && <HabitsSection onEdit={setEditing} />}
      <TasksSection onEdit={setEditing} />

      {visible.length === 0 && (
        <p className="text-[11px] text-txt-muted text-center py-md">
          Nothing here yet — hit + to add your first to-do.
        </p>
      )}

      {editing && <AddModal editTodo={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
