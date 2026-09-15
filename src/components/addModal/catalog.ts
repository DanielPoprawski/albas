import type { AddType, CalendarEvent, CategoryScope, Todo } from '../../types';
import type { EventRepeat } from '../../createItem';

export type FieldKey = 'allday' | 'repeat' | 'reminder' | 'location' | 'desc' | 'due' | 'category' | 'target';

export interface Section {
  id: string;
  title: string;
  keys: FieldKey[];
}

/**
 * The optional fields, grouped under collapsible headers. Expanding a section
 * switches all of its fields on; a field only reaches the payload while its
 * section is open (CreateModal's `has()` rule).
 */
export const SECTIONS: Record<AddType, Section[]> = {
  event: [
    { id: 'when', title: 'When', keys: ['allday', 'repeat'] },
    { id: 'details', title: 'Details', keys: ['category', 'location'] },
    { id: 'notify', title: 'Notify', keys: ['reminder'] },
    { id: 'notes', title: 'Notes', keys: ['desc'] },
  ],
  task: [
    { id: 'when', title: 'When', keys: ['due'] },
    { id: 'details', title: 'Details', keys: ['category'] },
    { id: 'notify', title: 'Notify', keys: ['reminder'] },
    { id: 'notes', title: 'Notes', keys: ['desc'] },
  ],
  habit: [
    { id: 'repeat', title: 'Repeat', keys: ['repeat', 'target'] },
    { id: 'details', title: 'Details', keys: ['category'] },
    { id: 'notify', title: 'Notify', keys: ['reminder'] },
    { id: 'notes', title: 'Notes', keys: ['desc'] },
  ],
};

export const PLACEHOLDERS: Record<AddType, string> = {
  event: 'Team sync, dentist, flight…',
  task: 'What needs doing?',
  habit: 'Read, run, meditate…',
};

/** Which `categoriesFor()` scope each Add-modal type's category chip offers. */
export const SCOPE_FOR: Record<AddType, CategoryScope> = { event: 'calendar', task: 'tasks', habit: 'habits' };

/** One optional field's row, revealed with the `row-in` keyframes (App.css). */
export const FIELD_ROW = 'flex items-center gap-2.5 animate-[row-in_0.2s_ease_both] motion-reduce:animate-none';

export interface Props {
  onClose: () => void;
  /** Edit an existing to-do (task/habit/chore) — mounts the full TodoForm. */
  editTodo?: Todo;
  /** Edit an existing event — mounts the full EventForm. */
  editEvent?: CalendarEvent;
  /** Start date of the occurrence that was clicked (recurring-event deletes). */
  editEventDate?: string | null;
  /** Pre-fill the date fields, e.g. when adding from a calendar day. */
  defaultDate?: string | null;
  /** Pre-fill the start time (`HH:MM`), e.g. when adding from an hour slot. */
  defaultStartTime?: string;
  /** Pre-fill the title, e.g. what a quick-add line already holds. */
  defaultTitle?: string;
  defaultType?: AddType;
  /** Pre-fill (and switch on) the task's List by category id, e.g. from a category header. */
  defaultCategory?: string;
  /** Optional observer. The modal persists by itself either way. */
  onSubmit?: (data: SubmitData) => void;
  snappiness?: number;
}

export interface SubmitData {
  type: AddType;
  title: string;
  fields: Record<string, any>;
}

export const REPEAT_OPTIONS: EventRepeat[] = ['Never', 'Daily', 'Weekly', 'Monthly'];
