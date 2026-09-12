import type { AddType, CalendarEvent, CategoryScope, Todo } from '../../types';
import { PALETTE_COMPACT } from '../../colors';
import type { EventRepeat, HabitFreq, Priority } from '../../createItem';

export type FieldKey =
  | 'allday'
  | 'repeat'
  | 'reminder'
  | 'location'
  | 'color'
  | 'desc'
  | 'due'
  | 'priority'
  | 'category'
  | 'target';

export const CATALOG: Record<AddType, Array<{ key: FieldKey; label: string }>> = {
  event: [
    { key: 'allday', label: 'All-day' },
    { key: 'repeat', label: 'Repeat' },
    { key: 'reminder', label: 'Reminder' },
    { key: 'location', label: 'Location' },
    { key: 'category', label: 'Category' },
    { key: 'color', label: 'Color' },
    { key: 'desc', label: 'Description' },
  ],
  task: [
    { key: 'due', label: 'Due date' },
    { key: 'priority', label: 'Priority' },
    { key: 'category', label: 'List' },
    { key: 'reminder', label: 'Reminder' },
    { key: 'desc', label: 'Description' },
  ],
  habit: [
    { key: 'target', label: 'Daily target' },
    { key: 'category', label: 'Category' },
    { key: 'reminder', label: 'Reminder' },
    { key: 'color', label: 'Color' },
    { key: 'desc', label: 'Description' },
  ],
};

export const PLACEHOLDERS: Record<AddType, string> = {
  event: 'Team sync, dentist, flight…',
  task: 'What needs doing?',
  habit: 'Read, run, meditate…',
};

/** Which `categoriesFor()` scope each Add-modal type's category chip offers. */
export const SCOPE_FOR: Record<AddType, CategoryScope> = { event: 'calendar', task: 'tasks', habit: 'habits' };

export const PALETTE = PALETTE_COMPACT;

/** One optional field's row, revealed with the `rowIn` keyframes (App.css). */
export const FIELD_ROW = 'flex items-center gap-2.5 animate-[rowIn_0.2s_ease_both] motion-reduce:animate-none';

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

/** Reminder chip label → lead time in minutes before the start. */
export const REMINDER_MINUTES: Record<string, number> = {
  'At time': 0,
  '10 min': 10,
  '1 hour': 60,
  '1 day': 1440,
};

export const REPEAT_OPTIONS: EventRepeat[] = ['Never', 'Daily', 'Weekly', 'Monthly'];
export const FREQ_OPTIONS: HabitFreq[] = ['Daily', 'Weekdays', 'Weekly'];
export const PRIORITY_OPTIONS: Priority[] = ['Low', 'Normal', 'High'];
