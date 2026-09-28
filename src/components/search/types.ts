import type { ActiveView, ColorKey, ItemKey, Seed } from '../../types';

/** Which page mounts the palette — sets only the default scope tab. */
export type SearchPage = Exclude<ActiveView, 'settings'>;

/** The scope tabs. `all` exists but is never the default. */
export type ScopeTab = 'all' | 'events' | 'tasks' | 'habits';

export interface SearchItem {
  key: ItemKey;
  seed: Seed;
  title: string;
  /** Searchable strings, title first (full weight), the rest at 0.85×. */
  fields: string[];
  /** The day a hit lands on: the nearest occurrence / due day. Null = undated to-do. */
  date: string | null;
  color: ColorKey;
  listName: string;
  hasReminder: boolean;
  /** Shared seeds are read-only and never selectable. */
  selectable: boolean;
}

export interface Hit {
  item: SearchItem;
  score: number;
  /** Matched character indices per `item.fields` entry. */
  positions: number[][];
}
