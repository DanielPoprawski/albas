import { useEffect, useRef } from 'react';
import { focusSearch } from './focusRegistry';

export type ShortcutGroup = 'Navigation' | 'Create' | 'Search';

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
 */
export const SHORTCUTS: ShortcutSpec[] = [
  { id: 'new-item', keys: ['Ctrl', 'N'], label: 'New item for the current screen', group: 'Create' },
  { id: 'next-view', keys: ['Tab'], label: 'Next view', group: 'Navigation' },
  { id: 'prev-view', keys: ['Shift', 'Tab'], label: 'Previous view', group: 'Navigation' },
  { id: 'focus-search', keys: ['/'], label: 'Focus search', group: 'Search' },
  { id: 'dismiss', keys: ['Esc'], label: 'Close a dialog or the search', group: 'Navigation' },
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

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  // `navigator.platform` is deprecated; the UA string still names the OS on
  // every WebView Albas ships to (WebKitGTK, Android WebView, WKWebView).
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent ?? '');
}

/** Renders a chord's key labels for display, swapping `Ctrl` for `⌘` on Mac. */
export function formatKeys(keys: string[]): string[] {
  const mac = isMac();
  return keys.map((k) => (mac && k === 'Ctrl' ? '⌘' : k));
}

function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') != null;
}

export interface ShortcutHandlers {
  /** Ctrl/Cmd+N — create the current screen's default item type. */
  newItem: () => void;
  /** Tab/Shift+Tab with nothing focused — move to the next/previous nav route. */
  cycleView: (dir: 1 | -1) => void;
}

/**
 * One `window` keydown listener for the app's global shortcuts (mounted once,
 * in `AppShell`). Escape isn't handled here — every surface that owns an
 * Escape-to-close already has its own local listener — it's only listed in
 * `SHORTCUTS` for the reference card.
 */
export function useShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Key repeat and IME composition aren't real keystrokes for shortcut purposes.
      if (e.repeat || e.isComposing) return;

      const target = e.target as HTMLElement | null;

      // Ctrl+N (Cmd+N on Mac) — new item.
      const mod = isMac() ? e.metaKey : e.ctrlKey;
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

      // Tab / Shift+Tab — cycle view, but only when nothing is focused and no
      // overlay (modal, open search list) is claiming the keyboard.
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement;
        const nothingFocused = active === document.body || active == null;
        if (!nothingFocused || dialogOpen() || document.querySelector('[role="listbox"]')) return;
        e.preventDefault();
        handlersRef.current.cycleView(e.shiftKey ? -1 : 1);
        return;
      }

      // '/' — focus the current screen's search bar.
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (inEditable(target) || dialogOpen()) return;
        e.preventDefault();
        focusSearch();
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
