import { useEffect, useRef } from 'react';
import type { ActiveView } from './types';

/**
 * A tiny cross-component "focus this thing" registry. `/` needs to reach a DOM
 * node owned by a component that may not even be mounted yet — the search
 * bar's input — without threading refs through AppShell's route switch or
 * standing up a React context nobody else needs. The owning component
 * registers a focus function on mount; whoever wants the focus calls the named
 * request and gets a no-op if nothing is listening.
 */
type FocusTarget = 'search';

const focusRegistry: Partial<Record<FocusTarget, () => void>> = {};

/** Registers `fn` as the current owner of `target`. Returns an unregister callback for cleanup. */
export function registerFocusTarget(target: FocusTarget, fn: () => void): () => void {
  focusRegistry[target] = fn;
  return () => {
    if (focusRegistry[target] === fn) delete focusRegistry[target];
  };
}

/** Focuses the currently-mounted search bar, wherever it lives. */
function focusSearch(): void {
  focusRegistry.search?.();
}

export type ShortcutGroup = 'Navigation' | 'Calendar' | 'Create' | 'Search';

export interface ShortcutSpec {
  id: string;
  /** Chord as separate key labels, e.g. `['Ctrl', 'N']` — rendered as one `<kbd>` per entry. */
  keys: string[];
  label: string;
  group: ShortcutGroup;
}

/**
 * The single source of truth for the app's global shortcuts: both the
 * `keydown` handler below and Settings' reference card read this list, so
 * they can't drift apart.
 *
 * Plain Tab is deliberately *not* a shortcut: it is the browser's own focus
 * walk, which is how every row, checkbox and star is reachable from the
 * keyboard. Views are numbered instead, with `g`-chords as the Vim spelling.
 */
export const SHORTCUTS: ShortcutSpec[] = [
  { id: 'new-item', keys: ['Ctrl', 'N'], label: 'New item for the current screen', group: 'Create' },
  { id: 'goto-dashboard', keys: ['1'], label: 'Dashboard (also g d)', group: 'Navigation' },
  { id: 'goto-todo', keys: ['2'], label: 'To-Dos (also g t)', group: 'Navigation' },
  { id: 'goto-habits', keys: ['3'], label: 'Habits (also g h)', group: 'Navigation' },
  { id: 'goto-settings', keys: ['0'], label: 'Settings (also g s)', group: 'Navigation' },
  { id: 'focus-search', keys: ['/'], label: 'Open search', group: 'Search' },
  { id: 'open-search', keys: ['Ctrl', 'K'], label: 'Open search', group: 'Search' },
  { id: 'dismiss', keys: ['Esc'], label: 'Close a dialog or the search', group: 'Navigation' },
  { id: 'cal-today', keys: ['T'], label: 'Jump to today', group: 'Calendar' },
  { id: 'cal-prev-month', keys: ['['], label: 'Previous month', group: 'Calendar' },
  { id: 'cal-next-month', keys: [']'], label: 'Next month', group: 'Calendar' },
  { id: 'cal-prev-year', keys: ['Shift', '['], label: 'Previous year', group: 'Calendar' },
  { id: 'cal-next-year', keys: ['Shift', ']'], label: 'Next year', group: 'Calendar' },
];

/** True when the keystroke belongs to something the user is already typing in. */
export function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** A search-bar `<input type="search">`, specifically — the one editable element Ctrl+N still fires from. */
function isSearchInput(el: HTMLElement): boolean {
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'search';
}

/** Ctrl is the modifier on every platform — no ⌘ swap — so the reference card prints the keys as they are. */
export function formatKeys(keys: string[]): string[] {
  return keys;
}

const NAV_KEYS: Record<string, ActiveView> = {
  '1': 'calendar',
  '2': 'todos',
  '3': 'habits',
  '0': 'settings',
};

/** The second key of a `g` chord. */
const CHORD_KEYS: Record<string, ActiveView> = {
  d: 'calendar',
  t: 'todos',
  h: 'habits',
  s: 'settings',
};

/** How long a leading `g` waits for its second key. */
const CHORD_MS = 600;

const CALENDAR_KEYS: Record<string, (h: ShortcutHandlers) => void> = {
  t: (h) => h.calendarToday(),
  T: (h) => h.calendarToday(),
  '[': (h) => h.calendarStepMonth(-1),
  ']': (h) => h.calendarStepMonth(1),
  '{': (h) => h.calendarStepYear(-1),
  '}': (h) => h.calendarStepYear(1),
};

export function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') != null;
}

export interface ShortcutHandlers {
  /** Ctrl+N — create the current screen's default item type. */
  newItem: () => void;
  /** 1/2/3/0 or g d/t/h/s — go to a sidebar destination. */
  navigate: (target: ActiveView) => void;
  /** T — show today. Only the calendar screen answers. */
  calendarToday: () => void;
  /** [ / ] — previous/next month. */
  calendarStepMonth: (dir: 1 | -1) => void;
  /** { / } (Shift+[ / Shift+]) — previous/next year. */
  calendarStepYear: (dir: 1 | -1) => void;
}

/**
 * One `window` keydown listener for the app's global shortcuts (mounted once,
 * in `AppShell`). Escape isn't handled here — every surface that owns an
 * Escape-to-close already has its own local listener — it's only listed in
 * `SHORTCUTS` for the reference card.
 *
 * Every single-key shortcut is gated on NORMAL mode: nothing editable has
 * focus and no dialog is open. That is the whole guard that lets `2` be a
 * shortcut and a character at the same time.
 */
export function useShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    // A pending `g`, waiting for its second key.
    let chordTimer: ReturnType<typeof setTimeout> | null = null;
    function clearChord() {
      if (chordTimer) clearTimeout(chordTimer);
      chordTimer = null;
    }

    function onKey(e: KeyboardEvent) {
      // Key repeat and IME composition aren't real keystrokes for shortcut purposes.
      if (e.repeat || e.isComposing) return;

      const target = e.target as HTMLElement | null;
      const mod = e.ctrlKey;

      // Ctrl+N — new item.
      if (mod && !e.altKey && (e.key === 'n' || e.key === 'N')) {
        if (dialogOpen()) return;
        if (inEditable(target)) {
          if (!target || !isSearchInput(target)) return;
          e.preventDefault();
          target.blur();
          handlersRef.current.newItem();
          return;
        }
        e.preventDefault();
        handlersRef.current.newItem();
        return;
      }

      // Ctrl+K — open the search palette.
      if (mod && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        if (dialogOpen() || inEditable(target)) return;
        e.preventDefault();
        focusSearch();
        return;
      }

      // Everything below is a bare key: NORMAL mode only.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (inEditable(target) || dialogOpen()) {
        clearChord();
        return;
      }

      // Second key of a `g` chord.
      if (chordTimer) {
        clearChord();
        const target = CHORD_KEYS[e.key];
        if (target) {
          e.preventDefault();
          handlersRef.current.navigate(target);
        }
        return;
      }
      if (e.key === 'g') {
        e.preventDefault();
        chordTimer = setTimeout(clearChord, CHORD_MS);
        return;
      }

      const nav = NAV_KEYS[e.key];
      if (nav) {
        e.preventDefault();
        handlersRef.current.navigate(nav);
        return;
      }

      // '/' — focus the current screen's search bar.
      if (e.key === '/') {
        e.preventDefault();
        focusSearch();
        return;
      }

      // Calendar: T today, [ ] months, { } (Shift+[ ]) years. Matched on
      // `e.key`, which already reflects Shift on the bracket row.
      const cal = CALENDAR_KEYS[e.key];
      if (!cal) return;
      e.preventDefault();
      cal(handlersRef.current);
    }

    window.addEventListener('keydown', onKey);
    return () => {
      clearChord();
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}

/**
 * Tracks whether the keyboard belongs to something editable — an input,
 * textarea, select, contenteditable or an open dialog — and reports it to
 * `UiContext` as INSERT. Focus events bubble as `focusin`/`focusout`; a
 * dialog opening without moving focus is caught by the same observer that
 * watches for it closing.
 */
export function useEditorMode(setInserting: (v: boolean) => void): void {
  useEffect(() => {
    const update = () => setInserting(inEditable(document.activeElement) || dialogOpen());
    update();
    window.addEventListener('focusin', update);
    window.addEventListener('focusout', update);
    const mo = new MutationObserver(update);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener('focusin', update);
      window.removeEventListener('focusout', update);
      mo.disconnect();
    };
  }, [setInserting]);
}
