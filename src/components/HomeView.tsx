import { useState } from 'react';
import Calendar from './Calendar';
import AddModal from './AddModal';
import HabitsSection from './todo/HabitsSection';
import TasksSection from './todo/TasksSection';
import type { Todo } from '../types';

/**
 * The phone's only list surface: calendar, then habits, then tasks, in one
 * scroll. Merging Calendar and To-Do removes the drawer trip that used to sit
 * between "what's this week" and "what do I have to do".
 *
 * The calendar takes a bounded height rather than `flex-1` — it has to stop
 * somewhere for the sections below it to be reachable by scrolling, and a
 * viewport-relative height keeps roughly the same amount of month visible on
 * any device.
 */
export default function HomeView() {
  const [editing, setEditing] = useState<Todo | null>(null);

  return (
    <div className="h-full overflow-y-auto scrollbar-hide">
      <div className="h-[60vh] min-h-[260px] flex flex-col">
        <Calendar isMobile />
      </div>

      <div className="p-sm ">
        <HabitsSection onEdit={setEditing} />
        <TasksSection onEdit={setEditing} />
      </div>

      {editing && <AddModal editTodo={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
