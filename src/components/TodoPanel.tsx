import { useState } from 'react';
import { useApp } from '../context/AppContext';
import AddModal from './AddModal';
import HabitsSection from './todo/HabitsSection';
import TasksSection from './todo/TasksSection';
import type { Todo } from '../types';

/**
 * The single To-Do surface: habits and chores on top, then one-time tasks
 * grouped by category. Used as the desktop main view and as the whole of
 * `RightPanel`; the mobile home page composes the same two sections itself so
 * the calendar can sit above them.
 */
export default function TodoPanel() {
  const { todos } = useApp();
  const [editing, setEditing] = useState<Todo | null>(null);

  return (
    <div className="mb-lg px-xs">
      <HabitsSection onEdit={setEditing} />
      <TasksSection onEdit={setEditing} />

      {todos.length === 0 && (
        <p className="text-[11px] text-txt-muted text-center py-md">
          Nothing here yet — hit + to add your first to-do.
        </p>
      )}

      {editing && <AddModal editTodo={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
