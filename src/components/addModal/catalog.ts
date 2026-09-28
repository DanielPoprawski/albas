import type { Seed } from '../../types';

export type FieldKey =
  | 'time'
  | 'ends'
  | 'repeat'
  | 'target'
  | 'routine'
  | 'list'
  | 'tags'
  | 'location'
  | 'remind'
  | 'notes';

/** What a row's `when` predicate sees: the two axes of the seed being edited. */
export interface OptionCtx {
  doable: boolean;
  repeating: boolean;
}

export interface Option {
  key: FieldKey;
  label: string;
  /** Omit = always offered. */
  when?: (ctx: OptionCtx) => boolean;
}

/**
 * The optional fields, in display order. A field only reaches the payload
 * while it is switched on (AddModal's `has()` rule) — which in edit mode
 * means switching one off clears what it holds. Rows the current seed can't
 * use (`when`) are neither listed nor kept.
 */
export const OPTIONS: Option[] = [
  { key: 'time', label: 'Time' },
  { key: 'ends', label: 'Ends' },
  { key: 'repeat', label: 'Repeat' },
  { key: 'target', label: 'Target', when: (c) => c.doable },
  { key: 'routine', label: 'Routine', when: (c) => c.doable && c.repeating },
  { key: 'list', label: 'List' },
  { key: 'tags', label: 'Tags' },
  { key: 'location', label: 'Where' },
  { key: 'remind', label: 'Remind' },
  { key: 'notes', label: 'Notes' },
];

export const PLACEHOLDER = 'Team sync, call mom, run…';

/** One optional field's row, revealed with the `row-in` keyframes (App.css). */
export const FIELD_ROW = 'flex items-center gap-2.5 animate-[row-in_0.2s_ease_both] motion-reduce:animate-none';

export interface Props {
  onClose: () => void;
  /** Edit this seed instead of creating one: same rows, seeded from it. */
  edit?: Seed;
  /** Start date of the occurrence that was clicked (repeating-seed deletes). */
  editDate?: string | null;
  /** Pre-fill the date, e.g. when adding from a calendar day. */
  defaultDate?: string | null;
  /** Pre-fill the start time (`HH:MM`), e.g. when adding from an hour slot. */
  defaultTime?: string;
  /** Start all-day, e.g. a month-cell click. */
  defaultAllDay?: boolean;
  /** Pre-fill the title, e.g. what a quick-add line already holds. */
  defaultTitle?: string;
  /** Start with the doable checkbox on (To-dos and Habits surfaces). */
  defaultDoable?: boolean;
  /** Start repeating (the Habits surface). */
  defaultRepeating?: boolean;
  /** Pre-fill (and switch on) the list by id, e.g. from a list header. */
  defaultList?: string;
  /** Optional observer. The modal persists by itself either way. */
  onSubmit?: (data: SubmitData) => void;
  snappiness?: number;
}

export interface SubmitData {
  title: string;
  fields: Record<string, any>;
}
