import { useState } from 'react';
import type { AddType, CalendarEvent, Todo } from '../types';
import { SegmentedControl } from './forms/shared';
import TodoForm from './forms/TodoForm';
import EventForm from './forms/EventForm';

interface Props {
  onClose: () => void;
  editTodo?: Todo;
  editEvent?: CalendarEvent;
  /** Start date of the occurrence that was clicked (recurring-event deletes). */
  editEventDate?: string | null;
  /** Pre-fill the date fields, e.g. when adding from a calendar day. */
  defaultDate?: string | null;
  defaultType?: AddType;
}

export default function AddModal({ onClose, editTodo, editEvent, editEventDate, defaultDate, defaultType }: Props) {
  const isEditing = !!editTodo || !!editEvent;
  const [type, setType] = useState<AddType>(
    editTodo ? 'todo' : editEvent ? 'event' : defaultType ?? 'todo'
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim"
      style={{ backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-2xl p-md w-full max-w-[28rem] mx-md shadow-2xl max-h-[88vh] overflow-y-auto scrollbar-hide border border-line bg-elevated"
        
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-md">
          <h2 className="text-headline-lg-mobile font-bold text-txt">
            {isEditing ? `Edit ${type === 'todo' ? 'To-Do' : 'Event'}` : 'Add New'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-txt-muted hover:text-txt transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Event = something that's just there; Task = something to do (create only) */}
        {!isEditing && (
          <div className="mb-md">
            <SegmentedControl
              options={[{ value: 'event', label: 'Event' }, { value: 'todo', label: 'Task' }]}
              value={type}
              onChange={setType}
            />
          </div>
        )}

        {type === 'todo' && <TodoForm edit={editTodo} defaultDate={defaultDate} onDone={onClose} />}
        {type === 'event' && <EventForm edit={editEvent} occurrenceDate={editEventDate} defaultDate={defaultDate} onDone={onClose} />}
      </div>
    </div>
  );
}
