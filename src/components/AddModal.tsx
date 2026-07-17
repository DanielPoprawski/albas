import { useState } from 'react';
import type { AddType, CalendarEvent, Habit, Period, Task } from '../types';
import { SegmentedControl } from './forms/shared';
import TaskForm from './forms/TaskForm';
import HabitForm from './forms/HabitForm';
import EventForm from './forms/EventForm';
import PeriodForm from './forms/PeriodForm';

interface Props {
  onClose: () => void;
  editTask?: Task;
  editHabit?: Habit;
  editEvent?: CalendarEvent;
  editPeriod?: Period;
}

const TYPE_LABELS: Record<AddType, string> = {
  task: 'Task',
  habit: 'Habit',
  event: 'Event',
  period: 'Period',
};

export default function AddModal({ onClose, editTask, editHabit, editEvent, editPeriod }: Props) {
  const isEditing = !!editTask || !!editHabit || !!editEvent || !!editPeriod;
  const [type, setType] = useState<AddType>(
    editHabit ? 'habit' : editEvent ? 'event' : editPeriod ? 'period' : 'task'
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(10,18,30,0.8)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-2xl p-md w-full max-w-[28rem] mx-md shadow-2xl max-h-[88vh] overflow-y-auto scrollbar-hide border"
        style={{ backgroundColor: '#13233a', borderColor: 'rgba(255,255,255,0.1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-md">
          <h2 className="text-headline-lg-mobile font-bold text-inverse-on-surface">
            {isEditing ? `Edit ${TYPE_LABELS[type]}` : 'Add New'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-outline-variant hover:text-inverse-on-surface transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Type toggle (create only) */}
        {!isEditing && (
          <div className="mb-md">
            <SegmentedControl
              options={(Object.keys(TYPE_LABELS) as AddType[]).map(t => ({ value: t, label: TYPE_LABELS[t] }))}
              value={type}
              onChange={setType}
            />
          </div>
        )}

        {type === 'task' && <TaskForm edit={editTask} onDone={onClose} />}
        {type === 'habit' && <HabitForm edit={editHabit} onDone={onClose} />}
        {type === 'event' && <EventForm edit={editEvent} onDone={onClose} />}
        {type === 'period' && <PeriodForm edit={editPeriod} onDone={onClose} />}
      </div>
    </div>
  );
}
