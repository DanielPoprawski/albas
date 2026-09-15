import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { registerFocusTarget } from '../../shortcuts';
import AddModal from '../AddModal';
import EditPanel from './EditPanel';
import PaletteResults from './PaletteResults';
import PaletteTrigger, { KBD } from './PaletteTrigger';
import type { SearchPage } from './types';
import { useSearchState } from './useSearchState';

/** Palette width in rem: results alone, and with the edit panel beside them. */
const WIDTH_REM = 45;
const WIDTH_WITH_PANEL_REM = 62.5;
const EDGE_REM = 1;

/**
 * The app-wide search: a bar in the page header that opens into an overlay
 * palette with fuzzy/regex matching, scope tabs, a persistent multi-select
 * and a bulk-edit panel. One component on three pages; `scope` only picks
 * the tab it opens on. All state lives in `useSearchState`.
 *
 * The overlay portals to `<body>`: every page header sits inside an
 * `overflow-hidden` card, which would clip anything positioned within it.
 */
export default function SearchPalette({ scope, className }: { scope: SearchPage; className?: string }) {
  const s = useSearchState(scope);
  const trigger = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState({ cx: 0, viewport: 0 });

  const openPalette = useCallback(() => {
    s.setOpen(true);
    // Focus lands once the portal has rendered.
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  }, [s.setOpen]);

  // `/` and Ctrl+K are global shortcuts (shortcuts.ts); this registers where
  // they land while this palette is the one mounted for the active route.
  useEffect(() => registerFocusTarget('search', openPalette), [openPalette]);

  // Centre on the trigger, re-measured on resize; the trigger's centre is the
  // palette's, clamped so it never leaves the viewport's margins.
  useLayoutEffect(() => {
    if (!s.open) return;
    const measure = () => {
      const r = trigger.current?.getBoundingClientRect();
      setAnchor({ cx: r ? r.left + r.width / 2 : window.innerWidth / 2, viewport: window.innerWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [s.open]);

  // Escape from anywhere inside the overlay (the panel's buttons included)
  // — but not while a dialog opened from it has the keyboard.
  useEffect(() => {
    if (!s.open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]:not([data-search-palette])')) return;
      if (e.target === input.current) return; // the input's own handler covers it
      e.preventDefault();
      if (s.selectedItems.length) s.clearSelection();
      else s.setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.open, s.selectedItems.length, s.clearSelection, s.setOpen]);

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    const mod = e.ctrlKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (s.selectedItems.length) s.clearSelection();
      else s.setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      s.setActive((a) => Math.min(a + 1, Math.max(0, s.hits.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      s.setActive((a) => Math.max(a - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      const hit = s.hits[s.active];
      if (!hit) return;
      e.preventDefault();
      if (e.shiftKey) s.toggleSelect(hit.item);
      else s.primaryAction(hit.item);
      return;
    }
    if (mod && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      s.selectAll();
      return;
    }
    if (mod && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      s.deselectAll();
    }
  }

  const remPx =
    typeof document === 'undefined' ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const wantRem = s.selectedItems.length ? WIDTH_WITH_PANEL_REM : WIDTH_REM;
  const width = Math.min(wantRem * remPx, anchor.viewport - 2 * EDGE_REM * remPx);
  const left = Math.max(EDGE_REM * remPx, Math.min(anchor.cx - width / 2, anchor.viewport - EDGE_REM * remPx - width));

  const regexChip =
    s.plan.mode === 'regex'
      ? s.plan.ok
        ? { text: s.plan.reason === 'auto' ? 'regex · auto' : 'regex', live: true }
        : { text: 'regex · incomplete', live: false }
      : null;

  return (
    <>
      <PaletteTrigger ref={trigger} query={s.query} count={s.counts.all} onOpen={openPalette} className={className} />

      {s.open &&
        createPortal(
          <div className="fixed inset-0 z-40">
            <div
              className="absolute inset-0 bg-scrim/70 animate-[fade_160ms_ease-out_both] motion-reduce:animate-none"
              onClick={() => s.setOpen(false)}
              aria-hidden
            />
            <div
              role="dialog"
              aria-label="Search"
              data-search-palette=""
              className="absolute top-[0.625rem] flex max-h-[calc(100%-1.25rem)] border border-line bg-surface shadow-modal transition-[left,width] duration-200 animate-[palette-in_180ms_cubic-bezier(0.2,0.8,0.2,1)_both] motion-reduce:animate-none"
              // dynamic: centred on the trigger, measured at open/resize
              style={{ left, width }}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-[0.875rem]">
                  <Search size="1rem" className="shrink-0 text-accent" aria-hidden />
                  <input
                    ref={input}
                    type="search"
                    value={s.query}
                    onChange={(e) => s.setQuery(e.target.value)}
                    onKeyDown={onInputKey}
                    placeholder="Search events, tasks and habits"
                    aria-label="Search"
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent text-base font-medium text-ink placeholder:text-ink-muted"
                  />
                  {regexChip && (
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-1 px-[0.4375rem] py-0.5 text-micro font-semibold leading-none',
                        regexChip.live ? 'bg-selection text-selection-ink' : 'bg-subtle text-ink-secondary',
                      )}
                    >
                      <span className="font-mono">.*</span>
                      {regexChip.text}
                    </span>
                  )}
                  {s.query && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => {
                        s.setQuery('');
                        input.current?.focus();
                      }}
                      className="shrink-0 text-ink-muted hover:text-ink"
                    >
                      <X size="0.875rem" />
                    </button>
                  )}
                  <kbd className={KBD}>esc</kbd>
                </div>
                <PaletteResults s={s} />
              </div>
              {s.selectedItems.length > 0 && <EditPanel s={s} />}
            </div>
          </div>,
          document.body,
        )}

      {s.editing?.event && <AddModal editEvent={s.editing.event} onClose={() => s.setEditing(null)} />}
      {s.editing?.todo && <AddModal editTodo={s.editing.todo} onClose={() => s.setEditing(null)} />}
    </>
  );
}
