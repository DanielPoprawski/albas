import type { CalendarEvent, ItemKey, Todo } from '../../types';

/** Which page mounts the palette — sets only the default scope tab. */
export type SearchPage = 'calendar' | 'tasks' | 'habits';

/** The scope tabs. `all` exists but is never the default. */
export type ScopeTab = 'all' | 'events' | 'tasks' | 'habits';

export type { ItemKey } from '../../types';

interface ItemBase {
  key: ItemKey;
  title: string;
  /** Searchable strings, title first (full weight), the rest at 0.85×. */
  fields: string[];
  /** The day a hit lands on: the nearest occurrence / due day. Null = undated to-do. */
  date: string | null;
  /** Resolved hex. */
  color: string;
  categoryName: string;
  hasReminder: boolean;
}

export type SearchItem =
  | (ItemBase & { kind: 'event'; event: CalendarEvent; selectable: boolean })
  | (ItemBase & { kind: 'task' | 'habit'; todo: Todo; selectable: true });

export interface Hit {
  item: SearchItem;
  score: number;
  /** Matched character indices per `item.fields` entry. */
  positions: number[][];
}

/** The reminder chips: none, or minutes before. To-dos only know on/off. */
export type { ReminderChoice } from '../bulk/useBulkActions';
export { REMINDER_CHOICES } from '../bulk/useBulkActions';
