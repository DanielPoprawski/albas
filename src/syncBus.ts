/**
 * One-slot notifier between `SettingsContext` (outer provider) and
 * `DataContext` (inner, owns the sync debounce). Settings writes that should
 * push call `requestSync()`; DataContext subscribes with `onSyncRequest`.
 * A module rather than a context so neither provider imports the other.
 */

type Listener = () => void;

let listener: Listener | null = null;

export function requestSync(): void {
  listener?.();
}

/** Registers the (single) handler; returns the unsubscribe. */
export function onSyncRequest(cb: Listener): () => void {
  listener = cb;
  return () => {
    if (listener === cb) listener = null;
  };
}
