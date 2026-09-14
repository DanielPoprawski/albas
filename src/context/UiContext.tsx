import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { fmt } from '../dates';
import type { ActiveView, CalendarMode, ItemKey } from '../types';

/**
 * The bottom bar's mode, Vim-style. NORMAL: nothing is being typed in and
 * the single-key shortcuts are live. INSERT: an input, textarea or dialog
 * has the keyboard. VISUAL: one or more items are selected.
 */
export type EditorMode = 'NORMAL' | 'INSERT' | 'VISUAL';

export interface UiContextType {
  selectedDate: string | null;
  currentMonth: Date;
  activeView: ActiveView;
  calendarMode: CalendarMode;
  setSelectedDate: (date: string | null) => void;
  setCurrentMonth: React.Dispatch<React.SetStateAction<Date>>;
  setActiveView: (view: ActiveView) => void;
  setCalendarMode: (mode: CalendarMode) => void;
  /**
   * Categories the user has unchecked in the sidebar — empty means "show
   * everything". One set for every screen, so hiding Work on the To-Do page
   * hides it on the dashboard and the Habits page too. `''` is General.
   */
  hiddenCategoryIds: Set<string>;
  toggleHiddenCategory: (id: string) => void;
  setHiddenCategoryIds: (ids: Set<string>) => void;
  /** Whether the To-Do page shows its Completed section. */
  showCompleted: boolean;
  setShowCompleted: (show: boolean) => void;
  /** The list views' multi-selection. Cleared on route change by the shell. */
  selectedKeys: Set<ItemKey>;
  setSelectedKeys: React.Dispatch<React.SetStateAction<Set<ItemKey>>>;
  /** Whether something editable currently has the keyboard (see `useEditorMode`). */
  inserting: boolean;
  setInserting: (v: boolean) => void;
  mode: EditorMode;
}

const UiContext = createContext<UiContextType | null>(null);

/** Navigation state: what is selected and which surface is showing. Never persisted. */
export function UiProvider({ children }: { children: React.ReactNode }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(() => fmt(new Date()));
  const [currentMonth, setCurrentMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [activeView, setActiveView] = useState<ActiveView>('calendar');
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month');
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState<Set<string>>(() => new Set());
  const [showCompleted, setShowCompleted] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<ItemKey>>(() => new Set());
  const [inserting, setInserting] = useState(false);

  const toggleHiddenCategory = useCallback((id: string) => {
    setHiddenCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const mode: EditorMode = inserting ? 'INSERT' : selectedKeys.size > 0 ? 'VISUAL' : 'NORMAL';

  const value = useMemo<UiContextType>(
    () => ({
      selectedDate,
      currentMonth,
      activeView,
      calendarMode,
      setSelectedDate,
      setCurrentMonth,
      setActiveView,
      setCalendarMode,
      hiddenCategoryIds,
      toggleHiddenCategory,
      setHiddenCategoryIds,
      showCompleted,
      setShowCompleted,
      selectedKeys,
      setSelectedKeys,
      inserting,
      setInserting,
      mode,
    }),
    [
      selectedDate,
      currentMonth,
      activeView,
      calendarMode,
      hiddenCategoryIds,
      toggleHiddenCategory,
      showCompleted,
      selectedKeys,
      inserting,
      mode,
    ],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used within AppProvider');
  return ctx;
}
