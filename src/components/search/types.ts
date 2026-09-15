import type { ActiveView, CalendarEvent, ItemKey, Todo } from '../../types';

/** Which page mounts the palette — sets only the default scope tab. */
export type SearchPage = Exclude<ActiveView, 'settings'>;

/** The scope tabs. `all` exists but is never the default. */
export type ScopeTab = 'all' | 'events' | 'tasks' | 'habits';

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
