import { useApp } from '../context/AppContext';
import CalendarNav from './calendar/CalendarNav';
import CalendarCategories from './calendar/CalendarCategories';
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
      {!isMobile && <CalendarCategories />}
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
