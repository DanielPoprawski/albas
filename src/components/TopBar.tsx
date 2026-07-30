import { useApp } from '../context/AppContext';
import CalendarNav from './calendar/CalendarNav';
import { calendarTitle, fmt } from '../dates';
import type { ActiveView } from '../types';

const VIEW_TITLES: Record<Exclude<ActiveView, 'calendar'>, string> = {
  todos: 'To-Do',
  weight: 'Weight',
  settings: 'Settings',
};

interface Props {
  isMobile: boolean;
  /** Only meaningful on mobile — opens the nav drawer. */
  onOpenDrawer?: () => void;
}

export default function TopBar({ isMobile, onOpenDrawer }: Props) {
  const { activeView, calendarMode, currentMonth, selectedDate, firstDayOfWeek } = useApp();

  // The rail and drawer already do navigation, so the bar carries only the
  // title — plus, on a phone, the calendar's own nav, which belongs beside the
  // period it steps and costs the grid nothing here.
  const title = activeView === 'calendar'
    ? calendarTitle(calendarMode, currentMonth, selectedDate ?? fmt(new Date()), firstDayOfWeek)
    : VIEW_TITLES[activeView];

  return (
    <header
      className={`fixed top-0 left-0 right-0 h-16 z-40 border-b border-line bg-chrome flex items-center ${
        // tight gap on a phone: the title and the nav are competing for the
        // same row, and a long day title is the first thing to truncate
        isMobile ? 'px-sm gap-xs' : 'px-margin'
      }`}
    >
      {isMobile && (
        <button
          onClick={onOpenDrawer}
          aria-label="Open navigation"
          className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg text-txt-muted hover:bg-fill-strong active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
      )}

      <h1
        className={`font-bold text-txt truncate min-w-0 ${
          isMobile ? 'text-headline-lg-mobile' : 'text-headline-lg ml-16'
        }`}
      >
        {title}
      </h1>

      {isMobile && activeView === 'calendar' && (
        <div className="ml-auto flex-shrink-0">
          <CalendarNav compact />
        </div>
      )}
    </header>
  );
}
