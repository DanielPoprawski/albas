import type { WipeKind } from './ipc';
import * as ipc from './ipc';
import type { List, Seed, Tag } from './types';

const STORAGE_KEY = 'albas-data-v2';

export interface LoadedState {
  seeds: Seed[];
  lists: List[];
  tags: Tag[];
  /** Free-form user preferences (theme, …). */
  settings: Record<string, string>;
}

/** The single mutator surface `DataContext` uses; every write is an idempotent upsert. */
export interface Persistence {
  load(): Promise<LoadedState>;
  saveSeed(s: Seed): void;
  deleteSeed(id: string): void;
  setDone(seedId: string, date: string, value: number): void;
  /** Settings › Danger zone wipes — one write each, so a wipe syncs as one batch of tombstones. */
  deleteAll(kind: WipeKind): void;
  saveList(l: List): void;
  deleteList(id: string): void;
  saveTag(t: Tag): void;
  deleteTag(id: string): void;
  setSetting(key: string, value: string): void;
  /** Resolves once every write queued so far has reached the store. */
  flush(): Promise<void>;
}

export function inTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/**
 * Whether this is the Android build. The QR *scanner* only exists there
 * (`tauri-plugin-barcode-scanner` is mobile-only and a desktop rarely has a
 * camera pointed at anything), so the buttons that open it are gated on this.
 * The user agent is good enough: inside the Tauri WebView on Android it always
 * carries "Android", and the check is never security-relevant.
 */
export function isAndroid(): boolean {
  return inTauri() && /Android/i.test(navigator.userAgent);
}

/** The wipe predicates, shared by the Rust `wipe_seeds` and the dev-server store. */
export function matchesWipe(s: Seed, kind: WipeKind): boolean {
  if (kind === 'events') return s.track === null;
  return s.track !== null && (s.repeat.type === 'none') === (kind === 'todos');
}

function makeTauriPersistence(): Persistence {
  // Serial queue: rapid writes (habit +/- clicks) must reach SQLite in order.
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue(label: string, run: () => Promise<unknown>): void {
    queue = queue.then(run).catch((err) => console.warn(`persistence: ${label} failed:`, err));
  }

  return {
    async load() {
      const data = await ipc.loadState();
      return { seeds: data.seeds, lists: data.lists, tags: data.tags, settings: data.settings };
    },
    saveSeed: (s) => enqueue('save_seed', () => ipc.saveSeed(s)),
    deleteSeed: (id) => enqueue('delete_seed', () => ipc.deleteSeed(id)),
    setDone: (seedId, date, value) => enqueue('set_done', () => ipc.setDone(seedId, date, value)),
    deleteAll: (kind) => enqueue('delete_all', () => ipc.deleteAll(kind)),
    saveList: (l) => enqueue('save_list', () => ipc.saveList(l)),
    deleteList: (id) => enqueue('delete_list', () => ipc.deleteList(id)),
    saveTag: (t) => enqueue('save_tag', () => ipc.saveTag(t)),
    deleteTag: (id) => enqueue('delete_tag', () => ipc.deleteTag(id)),
    setSetting: (key, value) => enqueue('set_setting', () => ipc.setSetting(key, value)),
    flush: () => queue.then(() => undefined),
  };
}

/** Browser dev server (`bun run dev`): whole-blob localStorage. */
function makeLocalPersistence(): Persistence {
  const state: LoadedState = { seeds: [], lists: [], tags: [], settings: {} };

  function flush(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or unavailable — app keeps working in memory
    }
  }

  function upsert<T extends { id: string }>(list: T[], item: T): T[] {
    const i = list.findIndex((x) => x.id === item.id);
    return i === -1 ? [...list, item] : list.map((x) => (x.id === item.id ? item : x));
  }

  return {
    async load() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        if (parsed && typeof parsed === 'object') {
          state.seeds = Array.isArray(parsed.seeds) ? parsed.seeds : [];
          state.lists = Array.isArray(parsed.lists) ? parsed.lists : [];
          state.tags = Array.isArray(parsed.tags)
            ? parsed.tags.map((t: Tag) => ({ ...t, keywords: t.keywords ?? '' }))
            : [];
          state.settings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
        }
      } catch {
        // corrupted storage — start empty
      }
      return { ...state };
    },
    saveSeed(s) {
      // preserve done rows when the caller sends metadata only
      const existing = state.seeds.find((x) => x.id === s.id);
      state.seeds = upsert(state.seeds, { ...s, done: s.done ?? existing?.done ?? {} });
      flush();
    },
    deleteSeed(id) {
      state.seeds = state.seeds.filter((s) => s.id !== id);
      flush();
    },
    setDone(seedId, date, value) {
      state.seeds = state.seeds.map((s) => {
        if (s.id !== seedId) return s;
        const done = { ...s.done };
        if (value <= 0) delete done[date];
        else done[date] = value;
        return { ...s, done };
      });
      flush();
    },
    deleteAll(kind) {
      state.seeds = state.seeds.filter((s) => !matchesWipe(s, kind));
      flush();
    },
    saveList(l) {
      state.lists = upsert(state.lists, l);
      flush();
    },
    deleteList(id) {
      state.lists = state.lists.filter((l) => l.id !== id);
      flush();
    },
    saveTag(t) {
      state.tags = upsert(state.tags, t);
      flush();
    },
    deleteTag(id) {
      state.tags = state.tags.filter((t) => t.id !== id);
      flush();
    },
    setSetting(key, value) {
      state.settings = { ...state.settings, [key]: value };
      flush();
    },
    async flush() {},
  };
}

export const persistence: Persistence = inTauri() ? makeTauriPersistence() : makeLocalPersistence();
