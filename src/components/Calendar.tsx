import { useApp } from '../context/AppContext';
import { addDays, fmt, longDate, parse, shortDate, weekOf } from '../dates';
import MonthView from './calendar/MonthView';
import WeekView from './calendar/WeekView';
import DayView from './calendar/DayView';
import type { CalendarMode } from '../types';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const MODES: { value: CalendarMode; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

export default function Calendar() {
  const {
    currentMonth, setCurrentMonth,
    selectedDate, setSelectedDate,
    calendarMode, setCalendarMode,
  } = useApp();

  const todayStr = fmt(new Date());
  // week/day navigation anchors on the selected date
  const anchor = selectedDate ?? todayStr;

  function syncMonth(dateStr: string) {
    const d = parse(dateStr);
    setCurrentMonth(m =>
      m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth()
        ? m
        : new Date(d.getFullYear(), d.getMonth(), 1)
    );
  }

  function step(dir: 1 | -1) {
    if (calendarMode === 'month') {
      setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + dir, 1));
      return;
    }
    const next = addDays(anchor, dir * (calendarMode === 'week' ? 7 : 1));
    setSelectedDate(next);
    syncMonth(next);
  }

  function goToday() {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(todayStr);
  }

  function switchMode(mode: CalendarMode) {
    setCalendarMode(mode);
    if (mode !== 'month') syncMonth(anchor);
  }

  let title: string;
  if (calendarMode === 'month') {
    title = `${MONTH_NAMES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
  } else if (calendarMode === 'week') {
    const weekDays = weekOf(parse(anchor));
    title = `${shortDate(weekDays[0])} – ${shortDate(weekDays[6])}, ${parse(weekDays[6]).getFullYear()}`;
  } else {
    title = longDate(anchor);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-md flex-shrink-0">
        <div className="flex items-center gap-md">
          <h2 className="text-headline-xl font-bold text-inverse-on-surface whitespace-nowrap">
            {title}
          </h2>
          <div className="flex bg-white/10 rounded-lg p-xs">
            <button
              onClick={() => step(-1)}
              className="p-xs hover:bg-white/20 rounded transition-colors text-outline-variant hover:text-on-primary"
            >
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <button
              onClick={goToday}
              className="px-sm text-label-md font-semibold text-on-primary hover:bg-white/20 rounded transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => step(1)}
              className="p-xs hover:bg-white/20 rounded transition-colors text-outline-variant hover:text-on-primary"
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-sm bg-white/10 p-xs rounded-lg">
          {MODES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => switchMode(value)}
              className={`px-md py-xs rounded font-semibold text-label-md transition-colors ${
                calendarMode === value
                  ? 'bg-surface-bright text-primary shadow-sm'
                  : 'text-outline-variant font-medium hover:text-on-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {calendarMode === 'month' && <MonthView />}
      {calendarMode === 'week' && <WeekView />}
      {calendarMode === 'day' && <DayView />}
    </div>
  );
}
