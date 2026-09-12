import { useRef } from 'react';
import { ModalChrome } from '../ui/modal-chrome';
import TodoForm from '../forms/TodoForm';
import EventForm from '../forms/EventForm';
import type { CommitResult } from '../forms/shared';
import { useModalDismiss } from '../ui/useModalDismiss';
import type { Props } from './catalog';

/**
 * Leaving an edit saves it. Every dismissal — scrim, ×, Escape, Android
 * back — runs the form's `commit()` first and only stays open when the
 * form has something it cannot save (an end before its start). An untouched
 * form is a no-op, so idly opening and closing never writes a row.
 */
export function EditModal({ onClose, editTodo, editEvent, editEventDate, defaultDate }: Props) {
  const commitRef = useRef<(() => CommitResult) | null>(null);
  const dismiss = () => {
    const result = commitRef.current?.() ?? 'empty';
    if (result !== 'invalid') onClose();
  };
  useModalDismiss(dismiss);

  return (
    <ModalChrome title={editEvent ? 'Edit event' : 'Edit to-do'} onClose={dismiss}>
      <div className="px-5 pt-[1.125rem] pb-5">
        {editTodo ? (
          <TodoForm edit={editTodo} defaultDate={defaultDate} onDone={onClose} commitRef={commitRef} />
        ) : (
          <EventForm
            edit={editEvent}
            occurrenceDate={editEventDate}
            defaultDate={defaultDate}
            onDone={onClose}
            commitRef={commitRef}
          />
        )}
      </div>
    </ModalChrome>
  );
}
