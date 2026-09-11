import { useApp } from '../context/AppContext';
import MonthView from './calendar/MonthView';
import WeekView from './calendar/WeekView';
import DayView from './calendar/DayView';

interface CalendarProps {
  isMobile?: boolean;
}

export default function Calendar({ isMobile = false }: CalendarProps) {
  const { calendarMode } = useApp();

  return (
    <>
      {/* The design puts a Categories list in the sidebar here, but there is
          nothing to build it from: `category` exists on `Todo` only —
          `CalendarEvent` has no such field — so the section could only ever
          list invented names. It shipped as a self-described stub with
          "Birthdays"/"School" and checkboxes that toggled nothing. Real
          calendar categories mean a schema column, `sync.rs` TABLES and
          `sharedLogic.ts` moving together; until then the slot stays empty. */}
      <div className="flex flex-col h-full min-h-0 bg-surface">
        {/* No navigation row here: the desktop header lives in
            MonthViewDesktop, and the phone's mode button rides in the top bar
            (`HomeView`'s `MobileShell`). */}
        {calendarMode === 'month' && <MonthView isMobile={isMobile} />}
        {calendarMode === 'week' && <WeekView />}
        {calendarMode === 'day' && <DayView />}
      </div>
    </>
  );
}
