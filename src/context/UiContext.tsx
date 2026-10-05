import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fmt } from '../dates';
import type { ActiveView, CalendarMode, ItemKey } from '../types';
import { useIsWide } from '../useMedia';

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
   * Lists and tags the user has unchecked in the sidebar — empty means "show
   * everything". One set each for every screen, so hiding Work on the To-Do
   * page hides it on the dashboard and the Habits page too. A seed is hidden
   * by its list (`''` is unfiled) or by any of its tags.
   */
  hiddenListIds: Set<string>;
  toggleHiddenList: (id: string) => void;
  setHiddenListIds: (ids: Set<string>) => void;
  hiddenTagIds: Set<string>;
  toggleHiddenTag: (id: string) => void;
  setHiddenTagIds: (ids: Set<string>) => void;
  /** Whether a seed passes both hidden sets. */
  isVisible: (seed: { list: string; tags: string[] }) => boolean;
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
  /** Whether the desktop dashboard's companion right-panel (habits/tasks) is open. */
  showRightPanel: boolean;
  setShowRightPanel: React.Dispatch<React.SetStateAction<boolean>>;
  toggleRightPanel: () => void;
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
  const [hiddenListIds, setHiddenListIds] = useState<Set<string>>(() => new Set());
  const [hiddenTagIds, setHiddenTagIds] = useState<Set<string>>(() => new Set());
  const [showCompleted, setShowCompleted] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<ItemKey>>(() => new Set());
  const [inserting, setInserting] = useState(false);

  const isWide = useIsWide();
  const [showRightPanel, setShowRightPanel] = useState(isWide);

  useEffect(() => {
    setShowRightPanel(isWide);
  }, [isWide]);

  const toggleRightPanel = useCallback(() => {
    setShowRightPanel((prev) => !prev);
  }, []);

  const toggle = (id: string) => (prev: Set<string>) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const toggleHiddenList = useCallback((id: string) => setHiddenListIds(toggle(id)), []);
  const toggleHiddenTag = useCallback((id: string) => setHiddenTagIds(toggle(id)), []);
  const isVisible = useCallback(
    (seed: { list: string; tags: string[] }) =>
      !hiddenListIds.has(seed.list) && !seed.tags.some((t) => hiddenTagIds.has(t)),
    [hiddenListIds, hiddenTagIds],
  );

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
      hiddenListIds,
      toggleHiddenList,
      setHiddenListIds,
      hiddenTagIds,
      toggleHiddenTag,
      setHiddenTagIds,
      isVisible,
      showCompleted,
      setShowCompleted,
      selectedKeys,
      setSelectedKeys,
      inserting,
      setInserting,
      mode,
      showRightPanel,
      setShowRightPanel,
      toggleRightPanel,
    }),
    [
      selectedDate,
      currentMonth,
      activeView,
      calendarMode,
      hiddenListIds,
      toggleHiddenList,
      hiddenTagIds,
      toggleHiddenTag,
      isVisible,
      showCompleted,
      selectedKeys,
      inserting,
      mode,
      showRightPanel,
      toggleRightPanel,
    ],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used within AppProvider');
  return ctx;
}
