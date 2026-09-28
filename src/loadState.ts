// The store read at launch. No React in here — rows in, rows out;
// `DataContext` sets its state from the result.

import { persistence } from './persistence';
import type { List, Seed, Tag } from './types';

export interface LoadedApp {
  seeds: Seed[];
  lists: List[];
  tags: Tag[];
  settings: Record<string, string>;
}

/** What a fresh install starts with. Ordinary rows the user can rename, reorder or delete. */
const STARTER_LISTS = ['Work', 'Personal', 'Shopping', 'Health', 'Finance'];

export async function loadInitialState(): Promise<LoadedApp> {
  const state = await persistence.load();

  // Starter lists only for a genuinely fresh, never-signed-in install: nothing
  // exists yet and no sync is about to pull the real ones.
  const signedIn = !!state.settings.__sync_token?.trim();
  let lists = state.lists;
  if (lists.length === 0 && state.seeds.length === 0 && !signedIn) {
    lists = STARTER_LISTS.map((name, i) => ({ id: crypto.randomUUID(), name, sort: i }));
    for (const l of lists) persistence.saveList(l);
  }

  return { seeds: state.seeds, lists, tags: state.tags, settings: state.settings };
}
