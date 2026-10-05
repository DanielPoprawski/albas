import { useCallback, useEffect, useMemo, useState } from 'react';
import { jumpTo } from '../../calendarNav';
import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import { REMINDER_QUICK, type ReminderChoice } from '../../reminders';
import { parseQuery } from '../../searchMatch';
import { bySort } from '../../seedLogic';
import type { Seed } from '../../types';
import { useBulkActions } from '../bulk/useBulkActions';
import { MAX_HITS, matchAll, rankHits, tabOf, toSearchItems } from './searchItems';
import type { ScopeTab, SearchItem, SearchPage } from './types';

const DEFAULT_TAB: Record<SearchPage, ScopeTab> = { calendar: 'events', todos: 'tasks', habits: 'habits' };

/** The one value every selected item shares, or null when they differ (or nothing is selected). */
function common<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  return values.every((v) => v === values[0]) ? values[0] : null;
}

/**
 * All of the palette's state and derived data, in one hook so the three
 * views (trigger, results, edit panel) stay presentational. The selection is
 * the app-wide one (`UiContext.selectedKeys`, shared with the list views'
 * Ctrl/Shift selection and the status bar's VISUAL mode): a set of keys that
 * survives query, tab and scope changes — that is what makes "select
 * everything, narrow, deselect these, clear, delete the rest" possible — and
 * is resolved against the live items whenever it's acted on.
 */
export function useSearchState(page: SearchPage) {
  const app = useApp();
  const {
    allSeeds,
    lists,
    tags,
    listById,
    tagById,
    colorOf,
    firstDayOfWeek,
    getSetting,
    setActiveView,
    setCurrentMonth,
    setSelectedDate,
    selectedKeys: selected,
    setSelectedKeys: setSelected,
  } = app;

  const [query, setQuery] = useState('');
  /** Tag ids an item must all carry to match — the chips in the input row. */
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ScopeTab>(DEFAULT_TAB[page]);
  const [active, setActive] = useState(0);
  const [shiftN, setShiftN] = useState(1);
  const [editing, setEditing] = useState<Seed | null>(null);

  const todayStr = fmt(new Date());
  const autoRegex = getSetting('__search_auto_regex') === '1';

  const items = useMemo(
    () => toSearchItems(allSeeds, listById, tagById, colorOf, firstDayOfWeek, todayStr),
    [allSeeds, listById, tagById, colorOf, firstDayOfWeek, todayStr],
  );
  const itemByKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);

  const plan = useMemo(() => parseQuery(query, { autoRegex }), [query, autoRegex]);
  const allMatches = useMemo(
    () =>
      matchAll(
        plan,
        tagFilter.length > 0 ? items.filter((i) => tagFilter.every((t) => i.seed.tags.includes(t))) : items,
      ),
    [plan, items, tagFilter],
  );

  const counts = useMemo(() => {
    const c: Record<ScopeTab, number> = { all: allMatches.length, events: 0, tasks: 0, habits: 0 };
    for (const h of allMatches) c[tabOf(h.item)]++;
    return c;
  }, [allMatches]);

  const tabMatches = useMemo(
    () => rankHits(tab === 'all' ? allMatches : allMatches.filter((h) => tabOf(h.item) === tab), todayStr),
    [allMatches, tab, todayStr],
  );
  const hits = useMemo(() => tabMatches.slice(0, MAX_HITS), [tabMatches]);

  // A new query or tab starts the cursor over; the selection is untouched.
  useEffect(() => setActive(0), [query, tab, tagFilter]);

  const selectedItems = useMemo<SearchItem[]>(() => {
    const out: SearchItem[] = [];
    for (const key of selected) {
      const item = itemByKey.get(key);
      if (item) out.push(item);
    }
    return out;
  }, [selected, itemByKey]);

  const bulk = useBulkActions(selectedItems);
  const { notice } = bulk;

  const missingCount = useMemo(() => {
    const visible = new Set(tabMatches.map((h) => h.item.key));
    let n = 0;
    for (const item of selectedItems) if (!visible.has(item.key)) n++;
    return n;
  }, [selectedItems, tabMatches]);

  const commonList = common(selectedItems.map((i) => i.seed.list));
  const commonReminder = common<ReminderChoice | 'mixed'>(
    selectedItems.map((i) => {
      const r = i.seed.reminders;
      if (r.length === 0) return 'none';
      if (r.length === 1 && (REMINDER_QUICK as readonly number[]).includes(r[0])) return r[0];
      return 'mixed';
    }),
  );
  const datedCount = selectedItems.filter((i) => i.seed.date).length;

  const listOptions = useMemo(() => [...lists].sort(bySort), [lists]);
  const tagOptions = useMemo(() => [...tags].sort(bySort), [tags]);

  const toggleTagFilter = useCallback(
    (id: string) => setTagFilter((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id])),
    [],
  );

  // --- selection ---

  const toggleSelect = useCallback(
    (item: SearchItem) => {
      if (!item.selectable) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.key)) next.delete(item.key);
        else next.add(item.key);
        return next;
      });
    },
    [setSelected],
  );

  /** Adds every match in the current tab (all of them, not just the 50 shown). */
  const selectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const h of tabMatches) if (h.item.selectable) next.add(h.item.key);
      return next;
    });
  }, [tabMatches, setSelected]);

  /** Removes every match in the current tab; anything selected elsewhere stays. */
  const deselectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const h of tabMatches) next.delete(h.item.key);
      return next;
    });
  }, [tabMatches, setSelected]);

  const clearSelection = useCallback(() => setSelected(new Set()), [setSelected]);

  const visibleSelectedCount = useMemo(() => {
    let n = 0;
    for (const h of tabMatches) if (selected.has(h.item.key)) n++;
    return n;
  }, [tabMatches, selected]);

  // --- actions ---

  const jump = useCallback(
    (item: SearchItem) => {
      if (!item.date) return false;
      jumpTo({ setCurrentMonth, setSelectedDate }, item.date);
      return true;
    },
    [setCurrentMonth, setSelectedDate],
  );

  /**
   * Row click / Enter. On the calendar the item's date is what you want; on
   * the list pages it's the item itself, opened lightly in the panel. A shared
   * seed can't be edited, so it always jumps — switching to the calendar.
   */
  const primaryAction = useCallback(
    (item: SearchItem) => {
      if (page === 'calendar' || !item.selectable) {
        if (page !== 'calendar') setActiveView('calendar');
        if (jump(item)) {
          setOpen(false);
          return;
        }
      }
      setSelected(new Set([item.key]));
    },
    [page, jump, setActiveView, setSelected],
  );

  const openFullEditor = useCallback(() => {
    if (selectedItems.length === 1) setEditing(selectedItems[0].seed);
  }, [selectedItems]);

  const { applyList, applyReminder, applyTag } = bulk;

  const applyShift = useCallback((dir: 1 | -1) => bulk.applyShift(shiftN * dir), [bulk.applyShift, shiftN]);

  const applyDelete = useCallback(() => {
    bulk.applyDelete();
    setSelected(new Set());
  }, [bulk.applyDelete, setSelected]);

  return {
    // state
    query,
    setQuery,
    tagFilter,
    setTagFilter,
    open,
    setOpen,
    tab,
    setTab,
    active,
    setActive,
    selected,
    shiftN,
    setShiftN,
    notice,
    editing,
    setEditing,
    // derived
    plan,
    hits,
    tabMatches,
    counts,
    selectedItems,
    visibleSelectedCount,
    missingCount,
    commonList,
    commonReminder,
    datedCount,
    listOptions,
    tagOptions,
    firstDayOfWeek,
    // actions
    toggleSelect,
    selectAll,
    deselectAll,
    clearSelection,
    primaryAction,
    openFullEditor,
    toggleTagFilter,
    applyList,
    applyTag,
    applyShift,
    applyReminder,
    applyDelete,
  };
}

export type SearchState = ReturnType<typeof useSearchState>;
