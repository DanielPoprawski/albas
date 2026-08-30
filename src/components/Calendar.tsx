import { useApp } from '../context/AppContext';
import CalendarNav from './calendar/CalendarNav';
import MonthView from './calendar/MonthView';
import WeekView from './calendar/WeekView';
import DayView from './calendar/DayView';

interface CalendarProps {
  isMobile?: boolean;
  onAdd?: () => void;
}

export default function Calendar({ isMobile = false, onAdd }: CalendarProps) {
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
        {/* Mobile navigation — desktop header is in MonthViewDesktop */}
        {isMobile && (
          <div className="flex items-center mb-0 flex-shrink-0">
            <CalendarNav compact />
          </div>
        )}

        {calendarMode === 'month' && <MonthView isMobile={isMobile} onAdd={onAdd} />}
        {calendarMode === 'week' && <WeekView />}
        {calendarMode === 'day' && <DayView />}
      </div>
    </>
  );
}
