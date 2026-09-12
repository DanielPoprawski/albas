import React, { createContext, useContext, useMemo, useState } from 'react';
import { fmt } from '../dates';
import type { ActiveView, CalendarMode } from '../types';

export interface UiContextType {
  selectedDate: string | null;
  currentMonth: Date;
  activeView: ActiveView;
  calendarMode: CalendarMode;
  setSelectedDate: (date: string | null) => void;
  setCurrentMonth: React.Dispatch<React.SetStateAction<Date>>;
  setActiveView: (view: ActiveView) => void;
  setCalendarMode: (mode: CalendarMode) => void;
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
    }),
    [selectedDate, currentMonth, activeView, calendarMode],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used within AppProvider');
  return ctx;
}
