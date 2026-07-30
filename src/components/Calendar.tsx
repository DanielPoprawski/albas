import { useApp } from '../context/AppContext';
import CalendarNav from './calendar/CalendarNav';
import MonthView from './calendar/MonthView';
import WeekView from './calendar/WeekView';
import DayView from './calendar/DayView';

export default function Calendar({ isMobile = false }: { isMobile?: boolean }) {
  const { calendarMode } = useApp();

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* The title lives in the top bar, and on mobile so does the navigation —
          the grid needs that row's height more than the phone needs a second
          bar. Desktop keeps it here, above the sheet. */}
      {!isMobile && (
        <div className="flex items-center mb-md flex-shrink-0">
          <CalendarNav />
        </div>
      )}

      {calendarMode === 'month' && <MonthView isMobile={isMobile} />}
      {calendarMode === 'week' && <WeekView />}
      {calendarMode === 'day' && <DayView />}
    </div>
  );
}
