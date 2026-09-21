import type { AddType, CalendarEvent, Todo } from '../../types';
import type { EventRepeat } from '../../createItem';

export type FieldKey =
  | 'allday'
  | 'repeat'
  | 'reminder'
  | 'location'
  | 'desc'
  | 'due'
  | 'category'
  | 'target'
  | 'routine';

export interface Section {
  id: string;
  title: string;
  keys: FieldKey[];
}

/**
 * The optional fields, grouped under collapsible headers on the phone; on the
 * desktop each key is its own checkbox in the options pane and the rows render
 * flat, in this order. A field only reaches the payload while it is switched
 * on (AddModal's `has()` rule) — which in edit mode means switching one off
 * clears what it holds. `desc` is an event's description and a to-do's `notes`.
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
    { id: 'when', title: 'When', keys: ['due'] },
    { id: 'repeat', title: 'Repeat', keys: ['repeat', 'target'] },
    { id: 'details', title: 'Details', keys: ['routine'] },
    { id: 'notify', title: 'Notify', keys: ['reminder'] },
    { id: 'notes', title: 'Notes', keys: ['desc'] },
  ],
};

/** A field's name: its row's caps label and its checkbox in the desktop options pane. */
export function fieldLabel(key: FieldKey, type: AddType): string {
  switch (key) {
    case 'due':
      return type === 'task' ? 'Due' : 'Starts';
    case 'category':
      return type === 'task' ? 'List' : 'Category';
    case 'allday':
      return 'All-day';
    case 'repeat':
      return 'Repeat';
    case 'target':
      return 'Target';
    case 'routine':
      return 'Routine';
    case 'reminder':
      return 'Remind';
    case 'location':
      return 'Where';
    case 'desc':
      return 'Notes';
  }
}

export const PLACEHOLDERS: Record<AddType, string> = {
  event: 'Team sync, dentist, flight…',
  task: 'What needs doing?',
  habit: 'Read, run, meditate…',
};

/** One optional field's row, revealed with the `row-in` keyframes (App.css). */
export const FIELD_ROW = 'flex items-center gap-2.5 animate-[row-in_0.2s_ease_both] motion-reduce:animate-none';

export interface Props {
  onClose: () => void;
  /** Edit this to-do (task/habit/chore) instead of creating one: same rows, seeded from it. */
  editTodo?: Todo;
  /** Edit this event instead of creating one: same rows, seeded from it. */
  editEvent?: CalendarEvent;
  /** Start date of the occurrence that was clicked (recurring-event deletes). */
  editEventDate?: string | null;
  /** Pre-fill the date fields, e.g. when adding from a calendar day. */
  defaultDate?: string | null;
  /** Seed the all-day switch on, e.g. a month-cell click. */
  defaultAllDay?: boolean;
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

export const REPEAT_OPTIONS: EventRepeat[] = ['Never', 'Daily', 'Weekdays', 'Weekly', 'Monthly', 'Yearly', 'Custom'];
