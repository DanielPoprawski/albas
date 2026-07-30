import { useState } from 'react';
import type { AddType, CalendarEvent, Todo } from '../types';
import { SegmentedControl } from './forms/shared';
import { Dialog, DialogClose, DialogContent, DialogTitle } from './ui/dialog';
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
    // Always open: the parent mounts this component to open it, so closing is
    // purely "tell the parent". Radix supplies the scrim, focus trap, Escape
    // and scroll lock that this file used to approximate.
    <Dialog open onOpenChange={next => { if (!next) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        // no description element; without this Radix logs a missing-describedby warning
        aria-describedby={undefined}
        // one max-width, not `max-w-[28rem]` plus a margin: the content is
        // centred with a transform, so a margin wouldn't hold it off the edges
        // of a phone, and a second max-w- utility would just override this one
        className="block rounded-2xl p-md w-full max-w-[min(28rem,calc(100%-2rem))] max-h-[88vh] overflow-y-auto scrollbar-hide border-line shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-md">
          <DialogTitle className="text-headline-lg-mobile font-bold text-txt">
            {isEditing ? `Edit ${type === 'todo' ? 'To-Do' : 'Event'}` : 'Add New'}
          </DialogTitle>
          <DialogClose className="text-txt-muted hover:text-txt transition-colors">
            <span className="material-symbols-outlined">close</span>
            <span className="sr-only">Close</span>
          </DialogClose>
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
      </DialogContent>
    </Dialog>
  );
}
