import { useState } from 'react';
import { useApp } from '../context/AppContext';
import TaskItem from './TaskItem';
import AddModal from './AddModal';
import type { Task } from '../types';

export default function TaskList() {
  const { tasks } = useApp();
  const [editing, setEditing] = useState<Task | null>(null);

  const pending = tasks.filter(t => !t.completed);
  const done = tasks.filter(t => t.completed);

  return (
    <div className="px-xs flex-1 flex flex-col min-h-0">
      <h3 className="text-label-md text-outline-variant mb-md uppercase tracking-wider flex-shrink-0">
        Tasks
      </h3>

      <div className="space-y-xs overflow-y-auto scrollbar-hide flex-1">
        {[...pending, ...done].map(task => (
          <TaskItem key={task.id} task={task} onEdit={setEditing} />
        ))}

        {tasks.length === 0 && (
          <p className="text-[11px] text-outline-variant text-center py-md">No tasks yet. Add one!</p>
        )}
      </div>

      {editing && <AddModal editTask={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
