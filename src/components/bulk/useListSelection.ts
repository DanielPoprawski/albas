import { useCallback, useRef } from 'react';
import { useUi } from '../../context/UiContext';
import type { ItemKey } from '../../types';

/** What a row click did to the selection; `plain` means "not a selection gesture, treat as activation". */
export type RowClickResult = 'toggled' | 'ranged' | 'plain';

/**
 * Ctrl+Click / Shift+Click selection over a rendered list, backed by the
 * shared `selectedKeys` in `UiContext` so the status bar's VISUAL mode and
 * the shell's route-change clearing see the same set.
 *
 * `orderedKeys` is the list in the order the user sees it (ranges run over
 * it); `generalKeys` are the rows in the General category. Ctrl only — Cmd
 * is not a modifier here on any platform, so behaviour matches everywhere.
 */
export function useListSelection(orderedKeys: ItemKey[], generalKeys: ItemKey[]) {
  const { selectedKeys, setSelectedKeys } = useUi();
  const anchor = useRef<ItemKey | null>(null);

  const isSelected = useCallback((key: ItemKey) => selectedKeys.has(key), [selectedKeys]);

  const onRowClick = useCallback(
    (e: React.MouseEvent, key: ItemKey): RowClickResult => {
      if (e.shiftKey) {
        e.preventDefault();
        const from = anchor.current && orderedKeys.includes(anchor.current) ? anchor.current : key;
        const a = orderedKeys.indexOf(from);
        const b = orderedKeys.indexOf(key);
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const range = orderedKeys.slice(lo, hi + 1);
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          for (const k of range) next.add(k);
          return next;
        });
        if (!anchor.current) anchor.current = key;
        // Shift+Click also selected the row text in the browser; drop that.
        window.getSelection()?.removeAllRanges();
        return 'ranged';
      }
      if (e.ctrlKey) {
        e.preventDefault();
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
        anchor.current = key;
        return 'toggled';
      }
      anchor.current = key;
      return 'plain';
    },
    [orderedKeys, setSelectedKeys],
  );

  /** macOS WebKit turns Ctrl+Click into a contextmenu event; keep it a selection click. */
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey) e.preventDefault();
  }, []);

  const selectAll = useCallback(() => setSelectedKeys(new Set(orderedKeys)), [orderedKeys, setSelectedKeys]);
  const selectGeneral = useCallback(() => setSelectedKeys(new Set(generalKeys)), [generalKeys, setSelectedKeys]);
  const clear = useCallback(() => {
    setSelectedKeys(new Set());
    anchor.current = null;
  }, [setSelectedKeys]);

  return {
    selected: selectedKeys,
    isSelected,
    onRowClick,
    onContextMenu,
    selectAll,
    deselectAll: clear,
    selectGeneral,
    clear,
  };
}

export type ListSelection = ReturnType<typeof useListSelection>;
