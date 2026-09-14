import { useCallback, useEffect, useMemo, useState } from 'react';
import { jumpTo } from '../../calendarNav';
import { useBulkActions } from '../bulk/useBulkActions';
import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import { parseQuery } from '../../searchMatch';
import type { CalendarEvent, Category, CategoryScope, Todo } from '../../types';
import { MAX_HITS, matchAll, rankHits, tabOf, toSearchItems } from './searchItems';
import type { ItemKey, ReminderChoice, ScopeTab, SearchItem, SearchPage } from './types';

const DEFAULT_TAB: Record<SearchPage, ScopeTab> = { calendar: 'events', tasks: 'tasks', habits: 'habits' };

/** The one value every selected item shares, or null when they differ (or nothing is selected). */
function common<T>(values: T[]): T | null {
  if (!values.length) return null;
  return values.every((v) => v === values[0]) ? values[0] : null;
}

/**
 * All of the palette's state and derived data, in one hook so the three
 * views (trigger, results, edit panel) stay presentational. The selection is
 * a set of keys that survives query, tab and scope changes — that is what
 * makes "select everything, narrow, deselect these, clear, delete the rest"
 * possible — and is resolved against the live items whenever it's acted on.
 */
export function useSearchState(page: SearchPage) {
  const app = useApp();
  const {
    events,
    sharedEvents,
    todos,
    categories,
    categoryById,
    firstDayOfWeek,
    getSetting,
    setActiveView,
    setCurrentMonth,
    setSelectedDate,
  } = app;

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ScopeTab>(DEFAULT_TAB[page]);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<Set<ItemKey>>(() => new Set());
  const [shiftN, setShiftN] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState<{ event?: CalendarEvent; todo?: Todo } | null>(null);

  const todayStr = fmt(new Date());
  const autoRegex = getSetting('__search_auto_regex') === '1';

  const items = useMemo(
    () => toSearchItems(events, sharedEvents, todos, categoryById, firstDayOfWeek, todayStr),
    [events, sharedEvents, todos, categoryById, firstDayOfWeek, todayStr],
  );
  const itemByKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);

  const plan = useMemo(() => parseQuery(query, { autoRegex }), [query, autoRegex]);
  const allMatches = useMemo(() => matchAll(plan, items), [plan, items]);

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
  useEffect(() => setActive(0), [query, tab]);

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

  const commonCategory = common(selectedItems.map((i) => (i.kind === 'event' ? i.event.category : i.todo.category)));
  const commonReminder = common<ReminderChoice | 'mixed'>(
    selectedItems.map((i) => {
      if (i.kind === 'event') {
        const r = i.event.reminders;
        if (r.length === 0) return 'none';
        if (r.length === 1 && (r[0] === 0 || r[0] === 10 || r[0] === 60 || r[0] === 1440)) return r[0];
        return 'mixed';
      }
      return i.todo.reminder ? 0 : 'none';
    }),
  );
  const datedCount = selectedItems.filter((i) => i.kind === 'event' || (i.kind === 'task' && i.todo.dueDate)).length;

  /** Categories the selection could move to: any whose scopes cover a selected kind. */
  const categoryOptions = useMemo<Category[]>(() => {
    const scopes = new Set<CategoryScope>(
      selectedItems.map((i) => (i.kind === 'event' ? 'calendar' : i.kind === 'task' ? 'tasks' : 'habits')),
    );
    return categories
      .filter((c) => c.scopes.some((s) => scopes.has(s)))
      .slice()
      .sort((a, b) => a.sort - b.sort);
  }, [categories, selectedItems]);

  // --- selection ---

  const toggleSelect = useCallback((item: SearchItem) => {
    if (!item.selectable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.key)) next.delete(item.key);
      else next.add(item.key);
      return next;
    });
  }, []);

  /** Adds every match in the current tab (all of them, not just the 50 shown). */
  const selectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const h of tabMatches) if (h.item.selectable) next.add(h.item.key);
      return next;
    });
  }, [tabMatches]);

  /** Removes every match in the current tab; anything selected elsewhere stays. */
  const deselectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const h of tabMatches) next.delete(h.item.key);
      return next;
    });
  }, [tabMatches]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setConfirmDelete(false);
  }, []);

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
   * event can't be edited, so it always jumps — switching to the calendar.
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
      setConfirmDelete(false);
    },
    [page, jump, setActiveView],
  );

  const openFullEditor = useCallback(() => {
    if (selectedItems.length !== 1) return;
    const item = selectedItems[0];
    setEditing(item.kind === 'event' ? { event: item.event } : { todo: item.todo });
  }, [selectedItems]);

  const { applyCategory, applyReminder } = bulk;

  const applyShift = useCallback((dir: 1 | -1) => bulk.applyShift(shiftN * dir), [bulk.applyShift, shiftN]);

  const applyDelete = useCallback(() => {
    bulk.applyDelete();
    setSelected(new Set());
    setConfirmDelete(false);
  }, [bulk.applyDelete]);

  return {
    // state
    query,
    setQuery,
    open,
    setOpen,
    tab,
    setTab,
    active,
    setActive,
    selected,
    shiftN,
    setShiftN,
    confirmDelete,
    setConfirmDelete,
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
    commonCategory,
    commonReminder,
    datedCount,
    categoryOptions,
    firstDayOfWeek,
    // actions
    toggleSelect,
    selectAll,
    deselectAll,
    clearSelection,
    primaryAction,
    openFullEditor,
    applyCategory,
    applyShift,
    applyReminder,
    applyDelete,
  };
}

export type SearchState = ReturnType<typeof useSearchState>;
