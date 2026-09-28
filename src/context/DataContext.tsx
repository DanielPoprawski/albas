import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from '../dates';
import * as ipc from '../ipc';
import type { SyncOutcome, WipeKind } from '../ipc';
import { loadInitialState } from '../loadState';
import { inTauri, matchesWipe, persistence } from '../persistence';
import { isHabit, nextHabitSort, resolveColor, resolveIcon, targetOf } from '../seedLogic';
import { mapSharedRows } from '../sharedLogic';
import type { ColorKey, List, NewList, NewSeed, NewTag, Seed, SharedGroup, Tag } from '../types';
import { useSettings } from './SettingsContext';
import { useSyncEngine } from './useSyncEngine';

export interface DataContextType {
  seeds: Seed[];
  lists: List[];
  tags: Tag[];
  loaded: boolean;
  /** Returns the stored row (with its new id) so a caller can select it immediately. */
  addSeed: (seed: NewSeed) => Seed;
  updateSeed: (id: string, updates: Partial<Omit<Seed, 'id' | 'done'>>) => void;
  deleteSeed: (id: string) => void;
  /** Check: toggles done. Count: jumps to target, or back to 0 if already done. */
  toggleDone: (seedId: string, date: string) => void;
  setDone: (seedId: string, date: string, value: number) => void;
  /** Settings › Danger zone: every own seed of one kind goes (shared ones aren't ours to delete). */
  deleteAll: (kind: WipeKind) => void;
  /** Bulk upsert (by id), e.g. an ICS import — re-importing updates in place. */
  importSeeds: (incoming: Seed[]) => void;
  addList: (list: NewList) => List;
  updateList: (id: string, updates: Partial<Omit<List, 'id'>>) => void;
  /** Also clears `list` on every seed in it (they persist as unfiled). */
  deleteList: (id: string) => void;
  addTag: (tag: NewTag) => Tag;
  updateTag: (id: string, updates: Partial<Omit<Tag, 'id'>>) => void;
  /** Also drops the id from every seed's `tags`. */
  deleteTag: (id: string) => void;
  /** Resolves an id against own rows, then shared ones (namespaced `${owner}:${pk}`). */
  listById: (id: string) => List | undefined;
  tagById: (id: string) => Tag | undefined;
  /** The colour a seed is drawn in: its own, else its last tag's, else grey. */
  colorOf: (seed: Seed) => ColorKey;
  /** The last tag's icon, or null. */
  iconOf: (seed: Seed) => string | null;
  /**
   * Re-reads everything from the store. Needed after a server sync, which
   * writes straight to SQLite from Rust and so bypasses React state.
   */
  reloadFromStore: () => Promise<void>;
  /** Everything other accounts share with this one, hidden owners included. */
  shared: SharedGroup[];
  /** `shared` minus locally hidden owners — what the panels should render. */
  visibleShared: SharedGroup[];
  /** Visible shared seeds flattened, each carrying `sharedBy`. */
  sharedSeeds: Seed[];
  /** Own + visible shared seeds — what every calendar surface expands. */
  allSeeds: Seed[];
  /** See `SyncEngine` (`useSyncEngine.ts`) for these four. */
  lastSync: number | null;
  syncing: boolean;
  syncNow: () => Promise<SyncOutcome>;
  scheduleSync: () => void;
}

const DataContext = createContext<DataContextType | null>(null);

/**
 * Mutators use functional updaters so two edits queued in one tick (a form
 * committing while a list delete cascades, say) each see the other's result
 * instead of the render they were created in. The store write sits inside
 * the updater because that is the only place the merged row exists; every
 * write is an idempotent upsert, so StrictMode's double invocation of
 * updaters in dev is harmless.
 */
function patchRow<T extends { id: string }>(list: T[], id: string, updates: Partial<T>, save: (row: T) => void): T[] {
  let hit = false;
  const next = list.map((row) => {
    if (row.id !== id) return row;
    hit = true;
    const merged = { ...row, ...updates };
    save(merged);
    return merged;
  });
  return hit ? next : list;
}

function withDone(s: Seed, date: string, value: number): Seed {
  const done = { ...s.done };
  if (value <= 0) delete done[date];
  else done[date] = value;
  return { ...s, done };
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { hydrateSettings, hiddenOwners, signedIn, getSetting } = useSettings();
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [shared, setShared] = useState<SharedGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const initStarted = useRef(false);

  /** Re-reads the shared cache. Tauri-only — the browser dev server has no sync. */
  const refreshShared = useCallback(async () => {
    if (!inTauri()) return;
    try {
      const rows = await ipc.loadShared();
      setShared(mapSharedRows(rows));
    } catch (err) {
      console.warn('failed to load shared data:', err);
    }
  }, []);

  const reloadFromStore = useCallback(async () => {
    // Queued writes must land first, or an edit made during a sync is read
    // back as the pre-edit row and vanishes from the screen until next load.
    await persistence.flush();
    const state = await persistence.load();
    setSeeds(state.seeds);
    setLists(state.lists);
    setTags(state.tags);
    hydrateSettings(state.settings);
    await refreshShared();
  }, [hydrateSettings, refreshShared]);

  const { lastSync, syncing, syncNow, scheduleSync, startup } = useSyncEngine({
    reloadFromStore,
    getSetting,
    signedIn,
  });

  useEffect(() => {
    if (initStarted.current) return; // StrictMode double-mount guard
    initStarted.current = true;

    const load = async () => {
      try {
        const loadedState = await loadInitialState();
        hydrateSettings(loadedState.settings);
        setSeeds(loadedState.seeds);
        setLists(loadedState.lists);
        setTags(loadedState.tags);
        await refreshShared();
      } catch (err) {
        console.error('failed to load persisted data:', err);
      }
      setLoaded(true);
    };
    startup(load());
  }, []);

  const addSeed = useCallback(
    (seed: NewSeed): Seed => {
      const full: Seed = {
        ...seed,
        id: crypto.randomUUID(),
        createdAt: fmt(new Date()),
        done: {},
        // A new habit lands at the end of the list.
        sort: isHabit(seed) ? nextHabitSort(seeds) : 0,
      };
      setSeeds((prev) => [...prev, full]);
      persistence.saveSeed(full);
      scheduleSync();
      return full;
    },
    [scheduleSync, seeds],
  );

  const updateSeed = useCallback(
    (id: string, updates: Partial<Omit<Seed, 'id' | 'done'>>) => {
      setSeeds((prev) => patchRow(prev, id, updates, persistence.saveSeed));
      scheduleSync();
    },
    [scheduleSync],
  );

  const deleteSeed = useCallback(
    (id: string) => {
      setSeeds((prev) => prev.filter((s) => s.id !== id));
      persistence.deleteSeed(id);
      scheduleSync();
    },
    [scheduleSync],
  );

  const setDone = useCallback(
    (seedId: string, date: string, value: number) => {
      setSeeds((prev) => prev.map((s) => (s.id === seedId ? withDone(s, date, value) : s)));
      persistence.setDone(seedId, date, value);
      scheduleSync();
    },
    [scheduleSync],
  );

  const toggleDone = useCallback(
    (seedId: string, date: string) => {
      setSeeds((prev) => {
        const seed = prev.find((s) => s.id === seedId);
        if (!seed?.track) return prev;
        const target = targetOf(seed);
        const value = (seed.done[date] ?? 0) >= target ? 0 : target;
        persistence.setDone(seedId, date, value);
        return prev.map((s) => (s.id === seedId ? withDone(s, date, value) : s));
      });
      scheduleSync();
    },
    [scheduleSync],
  );

  const deleteAll = useCallback(
    (kind: WipeKind) => {
      setSeeds((prev) => prev.filter((s) => !matchesWipe(s, kind)));
      persistence.deleteAll(kind);
      scheduleSync();
    },
    [scheduleSync],
  );

  const importSeeds = useCallback(
    (incoming: Seed[]) => {
      setSeeds((prev) => {
        const byId = new Map(prev.map((s) => [s.id, s]));
        for (const s of incoming) byId.set(s.id, s);
        return [...byId.values()];
      });
      incoming.forEach((s) => persistence.saveSeed(s));
      scheduleSync();
    },
    [scheduleSync],
  );

  const addList = useCallback(
    (input: NewList): List => {
      const full: List = { ...input, id: crypto.randomUUID() };
      setLists((prev) => [...prev, full]);
      persistence.saveList(full);
      scheduleSync();
      return full;
    },
    [scheduleSync],
  );

  const updateList = useCallback(
    (id: string, updates: Partial<Omit<List, 'id'>>) => {
      setLists((prev) => patchRow(prev, id, updates, persistence.saveList));
      scheduleSync();
    },
    [scheduleSync],
  );

  const deleteList = useCallback(
    (id: string) => {
      setLists((prev) => prev.filter((l) => l.id !== id));
      persistence.deleteList(id);
      // Each cleared row is saved like any other edit, so the clear itself
      // persists (and syncs) rather than being a local-only side effect.
      setSeeds((prev) =>
        prev.map((s) => {
          if (s.list !== id) return s;
          const next = { ...s, list: '' };
          persistence.saveSeed(next);
          return next;
        }),
      );
      scheduleSync();
    },
    [scheduleSync],
  );

  const addTag = useCallback(
    (input: NewTag): Tag => {
      const full: Tag = { ...input, id: crypto.randomUUID() };
      setTags((prev) => [...prev, full]);
      persistence.saveTag(full);
      scheduleSync();
      return full;
    },
    [scheduleSync],
  );

  const updateTag = useCallback(
    (id: string, updates: Partial<Omit<Tag, 'id'>>) => {
      setTags((prev) => patchRow(prev, id, updates, persistence.saveTag));
      scheduleSync();
    },
    [scheduleSync],
  );

  const deleteTag = useCallback(
    (id: string) => {
      setTags((prev) => prev.filter((t) => t.id !== id));
      persistence.deleteTag(id);
      setSeeds((prev) =>
        prev.map((s) => {
          if (!s.tags.includes(id)) return s;
          const next = { ...s, tags: s.tags.filter((t) => t !== id) };
          persistence.saveSeed(next);
          return next;
        }),
      );
      scheduleSync();
    },
    [scheduleSync],
  );

  const listById = useCallback(
    (id: string): List | undefined => {
      if (!id) return undefined;
      return lists.find((l) => l.id === id) ?? shared.flatMap((g) => g.lists).find((l) => l.id === id);
    },
    [lists, shared],
  );

  const tagById = useCallback(
    (id: string): Tag | undefined => {
      if (!id) return undefined;
      return tags.find((t) => t.id === id) ?? shared.flatMap((g) => g.tags).find((t) => t.id === id);
    },
    [tags, shared],
  );

  const colorOf = useCallback((seed: Seed) => resolveColor(seed, tagById), [tagById]);
  const iconOf = useCallback((seed: Seed) => resolveIcon(seed, tagById), [tagById]);

  const visibleShared = useMemo(() => shared.filter((g) => !hiddenOwners.includes(g.owner)), [shared, hiddenOwners]);
  const sharedSeeds = useMemo(() => visibleShared.flatMap((g) => g.seeds), [visibleShared]);
  const allSeeds = useMemo(() => [...seeds, ...sharedSeeds], [seeds, sharedSeeds]);

  const value = useMemo<DataContextType>(
    () => ({
      seeds,
      lists,
      tags,
      loaded,
      addSeed,
      updateSeed,
      deleteSeed,
      toggleDone,
      setDone,
      deleteAll,
      importSeeds,
      addList,
      updateList,
      deleteList,
      addTag,
      updateTag,
      deleteTag,
      listById,
      tagById,
      colorOf,
      iconOf,
      reloadFromStore,
      shared,
      visibleShared,
      sharedSeeds,
      allSeeds,
      lastSync,
      syncing,
      syncNow,
      scheduleSync,
    }),
    [
      seeds,
      lists,
      tags,
      loaded,
      addSeed,
      updateSeed,
      deleteSeed,
      toggleDone,
      setDone,
      deleteAll,
      importSeeds,
      addList,
      updateList,
      deleteList,
      addTag,
      updateTag,
      deleteTag,
      listById,
      tagById,
      colorOf,
      iconOf,
      reloadFromStore,
      shared,
      visibleShared,
      sharedSeeds,
      allSeeds,
      lastSync,
      syncing,
      syncNow,
      scheduleSync,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within AppProvider');
  return ctx;
}
