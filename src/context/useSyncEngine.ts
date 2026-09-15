import { useCallback, useEffect, useRef, useState } from 'react';
import * as ipc from '../ipc';
import type { SyncOutcome } from '../ipc';
import { inTauri, persistence } from '../persistence';
import { onSyncRequest } from '../syncBus';

const DEBOUNCE_DEFAULT_MS = 2000;
const DEBOUNCE_MIN_MS = 500;
const DEBOUNCE_MAX_MS = 10000;
/** Upper bound on the close-time push: a dead server must not hold the window hostage. */
const CLOSE_SYNC_TIMEOUT_MS = 5000;

const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface SyncEngine {
  /** Epoch millis of the last successful sync on this device, or null for never. */
  lastSync: number | null;
  /** True while a sync is in flight, whoever started it. */
  syncing: boolean;
  /**
   * Runs a sync and folds the result back into React. Every caller goes
   * through this — the status bar, Settings, and the launch sync — so there
   * is a single `lastSync` rather than one per surface. Rejects on failure;
   * how loudly to say so is the caller's business.
   */
  syncNow: () => Promise<SyncOutcome>;
  /**
   * Debounced push after an edit (`__sync_debounce_ms`, default 2 s). Every
   * mutator calls it; a sync already in flight marks it dirty and re-runs
   * once done. No-op outside Tauri or while no server is configured.
   */
  scheduleSync: () => void;
  /**
   * The launch sync. Starts alongside `loading` (the store read) rather than
   * after first paint, but is never awaited before it: a slow or unreachable
   * server must not delay startup. The pull is folded in once both have
   * settled — folding earlier would race the load's own state writes.
   */
  startup: (loading: Promise<unknown>) => void;
}

/**
 * Everything about *when* the app talks to the sync server. Rust does the
 * merge into SQLite; this decides when to ask it to (after edits, at launch,
 * on close, on backgrounding) and hands each pull back to React through
 * `reloadFromStore`. Bookkeeping lives in refs so the callbacks — and the
 * timers they arm — keep one identity for the life of the provider.
 */
export function useSyncEngine({
  reloadFromStore,
  getSetting,
  signedIn,
}: {
  reloadFromStore: () => Promise<void>;
  getSetting: (key: string) => string | undefined;
  signedIn: boolean;
}): SyncEngine {
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const configured = useRef(false);
  const inflight = useRef<Promise<SyncOutcome> | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef<Promise<void> | null>(null);
  const getSettingRef = useRef(getSetting);
  getSettingRef.current = getSetting;
  const reloadRef = useRef(reloadFromStore);
  reloadRef.current = reloadFromStore;
  const syncNowRef = useRef<() => Promise<SyncOutcome>>(() => Promise.reject(new Error('sync not ready')));

  /** What a finished sync means for React: re-read on a pull, stamp the time. */
  const fold = useCallback(async (out: SyncOutcome) => {
    if (out.pulled > 0 || out.sharedChanged) await reloadRef.current();
    if (out.lastSync) setLastSync(Number(out.lastSync));
  }, []);

  const scheduleSync = useCallback(() => {
    if (!inTauri() || !configured.current) return;
    if (inflight.current) {
      dirty.current = true; // re-run once the current one finishes
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    const raw = Number.parseInt(getSettingRef.current('__sync_debounce_ms') ?? '', 10);
    const delay = Math.min(DEBOUNCE_MAX_MS, Math.max(DEBOUNCE_MIN_MS, raw || DEBOUNCE_DEFAULT_MS));
    timer.current = setTimeout(() => {
      timer.current = null;
      syncNowRef.current().catch((err) => console.warn('background sync failed:', err));
    }, delay);
  }, []);

  // Queued store writes are flushed first so the push carries them.
  // Overlapping calls share the in-flight run and queue one more.
  const syncNow = useCallback(async (): Promise<SyncOutcome> => {
    if (inflight.current) {
      dirty.current = true;
      return inflight.current;
    }
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setSyncing(true);
    const run = (async () => {
      try {
        await persistence.flush();
        const out = await ipc.syncNow();
        configured.current = true;
        await fold(out);
        return out;
      } finally {
        inflight.current = null;
        setSyncing(false);
        if (dirty.current) {
          dirty.current = false;
          scheduleSync();
        }
      }
    })();
    inflight.current = run;
    return run;
  }, [fold, scheduleSync]);
  syncNowRef.current = syncNow;

  const startup = useCallback(
    (loading: Promise<unknown>) => {
      // Raw `ipc.syncNow`, not `syncNow`: its fold would reload mid-load.
      const sync = (async (): Promise<SyncOutcome | null> => {
        if (!inTauri()) return null;
        const status = await ipc.syncStatus();
        configured.current = status.configured;
        if (!status.configured) return null;
        setSyncing(true);
        try {
          return await ipc.syncNow();
        } finally {
          setSyncing(false);
        }
      })();
      void (async () => {
        const [, synced] = await Promise.allSettled([loading, sync]);
        if (synced.status === 'rejected') {
          console.warn('startup sync failed:', synced.reason);
          return;
        }
        if (!synced.value) return;
        try {
          await fold(synced.value);
        } catch (err) {
          console.warn('failed to fold the startup sync in:', err);
        }
        if (dirty.current) {
          dirty.current = false;
          scheduleSync();
        }
      })();
    },
    [fold, scheduleSync],
  );

  // Settings writes (outer provider) ask for a push through the bus.
  useEffect(() => onSyncRequest(scheduleSync), [scheduleSync]);

  // Desktop close: hold the window until queued writes are on disk and one
  // push has been attempted (bounded), then destroy it for real. A second
  // close request while that runs just waits on the same promise.
  useEffect(() => {
    if (!inTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    ipc
      .onCloseRequested(async (e) => {
        e.preventDefault();
        if (!closing.current) {
          closing.current = (async () => {
            if (timer.current) clearTimeout(timer.current);
            try {
              await persistence.flush();
            } catch {
              // nothing more to do about it at close time
            }
            if (configured.current) {
              try {
                await Promise.race([syncNowRef.current(), timeout(CLOSE_SYNC_TIMEOUT_MS)]);
              } catch {
                // offline or server down — the next launch's sync recovers
              }
            }
            try {
              await ipc.destroyWindow();
            } catch (err) {
              console.warn('destroy on close failed:', err);
              closing.current = null;
            }
          })();
        }
        await closing.current;
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => console.warn('close handler not registered:', err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Backgrounding (Android has no close event): flush, then push. Fire and
  // forget — the OS may kill the process before the sync lands, in which case
  // the next launch's sync carries it.
  useEffect(() => {
    if (!inTauri()) return;
    const push = () => {
      if (!configured.current) return;
      persistence
        .flush()
        .then(() => syncNowRef.current())
        .catch(() => {});
    };
    const onVisibility = () => {
      if (document.hidden) push();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', push);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', push);
    };
  }, []);

  // Rust owns the stamp, and not every sync passes through `syncNow`: the
  // browser sign-in flow (`useBrowserSignIn`) syncs from inside the poll
  // loop, so on sign-in React can only learn when that happened by asking.
  // Signing out clears it — the next account's history is not this one's.
  useEffect(() => {
    if (!inTauri()) return;
    if (!signedIn) {
      configured.current = false;
      setLastSync(null);
      return;
    }
    (async () => {
      try {
        const status = await ipc.syncStatus();
        configured.current = status.configured;
        setLastSync(status.lastSync ? Number(status.lastSync) : null);
      } catch {
        // backend not ready — the bar reads "never synced" until one runs
      }
    })();
  }, [signedIn]);

  return { lastSync, syncing, syncNow, scheduleSync, startup };
}
