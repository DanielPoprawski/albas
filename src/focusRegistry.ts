/**
 * A tiny cross-component "focus this thing" registry. `/` needs to reach a DOM
 * node owned by a component that may not even be mounted yet — the search
 * bar's input — without threading refs through AppShell's route switch or
 * standing up a React context nobody else needs. The owning component
 * registers a focus function on mount; whoever wants the focus calls the named
 * request and gets a no-op if nothing is listening.
 */

export type FocusTarget = 'search';

const registry: Partial<Record<FocusTarget, () => void>> = {};

/** Registers `fn` as the current owner of `target`. Returns an unregister callback for cleanup. */
export function registerFocusTarget(target: FocusTarget, fn: () => void): () => void {
  registry[target] = fn;
  return () => {
    if (registry[target] === fn) delete registry[target];
  };
}

/** Runs the registered handler for `target`, if any component currently owns it. */
export function requestFocus(target: FocusTarget): void {
  registry[target]?.();
}

/** Focuses the currently-mounted search bar, wherever it lives. */
export function focusSearch(): void {
  requestFocus('search');
}
