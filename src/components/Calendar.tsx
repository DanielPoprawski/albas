import { useApp } from '../context/AppContext';
import { fmt } from '../dates';
import { isDoneOn, isDueOn } from '../habitLogic';
import { HABIT_COLORS } from './habitColors';

function getCalendarDays(month: Date): { date: Date; isCurrentMonth: boolean }[] {
  const year = month.getFullYear();
  const m = month.getMonth();

  const firstDay = new Date(year, m, 1);
  const lastDay = new Date(year, m + 1, 0);

  // Monday-start offset
  const startOffset = (firstDay.getDay() + 6) % 7;
  const endOffset = (7 - lastDay.getDay()) % 7;

  const start = new Date(firstDay);
  start.setDate(start.getDate() - startOffset);
  const end = new Date(lastDay);
  end.setDate(end.getDate() + endOffset);

  const days: { date: Date; isCurrentMonth: boolean }[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push({ date: new Date(cur), isCurrentMonth: cur.getMonth() === m });
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export default function Calendar() {
  const { currentMonth, setCurrentMonth, selectedDate, setSelectedDate, tasks, habits } = useApp();

  const todayStr = fmt(new Date());
  const days = getCalendarDays(currentMonth);

  function prevMonth() {
    setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
  function goToday() {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(todayStr);
  }

  // Tasks render as pills, so dots represent habits only:
  // filled dot = completed, hollow ring = due but not (yet) done
  function getDateDots(dateStr: string) {
    return habits
      .filter(h => isDueOn(h, dateStr) || isDoneOn(h, dateStr))
      .map(h => ({ hex: HABIT_COLORS[h.colorKey].hex, done: isDoneOn(h, dateStr) }))
      .slice(0, 4);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-md flex-shrink-0">
        <div className="flex items-center gap-md">
          <h2 className="text-headline-xl font-bold text-inverse-on-surface">
            {MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </h2>
          <div className="flex bg-white/10 rounded-lg p-xs">
            <button
              onClick={prevMonth}
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
              onClick={nextMonth}
              className="p-xs hover:bg-white/20 rounded transition-colors text-outline-variant hover:text-on-primary"
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-sm bg-white/10 p-xs rounded-lg">
          <button className="px-md py-xs rounded bg-surface-bright text-primary font-semibold text-label-md shadow-sm">
            Month
          </button>
          <button className="px-md py-xs rounded text-outline-variant font-medium text-label-md hover:text-on-primary">
            Week
          </button>
          <button className="px-md py-xs rounded text-outline-variant font-medium text-label-md hover:text-on-primary">
            Day
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 rounded-xl border overflow-hidden shadow-2xl" style={{ borderColor: 'rgba(195,198,215,0.2)', backgroundColor: '#f8f9ff' }}>
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b" style={{ borderColor: 'rgba(195,198,215,0.3)', backgroundColor: 'rgba(229,238,255,0.5)' }}>
          {WEEKDAYS.map((day, i) => (
            <div
              key={day}
              className={`py-sm text-center text-label-md font-bold ${
                i >= 5 ? 'text-on-surface' : 'text-outline'
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Days */}
        <div
          className="grid grid-cols-7 scrollbar-hide overflow-y-auto"
          style={{ height: `calc(100% - 40px)` }}
        >
          {days.map(({ date, isCurrentMonth }) => {
            const dateStr = fmt(date);
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const dots = getDateDots(dateStr);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            const dayTasks = tasks.filter(t => t.date === dateStr);

            return (
              <div
                key={dateStr}
                className={`calendar-cell p-sm cursor-pointer ${!isCurrentMonth ? 'opacity-30' : ''} ${isSelected && !isToday ? 'bg-blue-50' : ''}`}
                onClick={() => setSelectedDate(dateStr)}
              >
                <div className="flex items-start justify-between">
                  {isToday ? (
                    <span className="w-7 h-7 flex items-center justify-center bg-primary text-white rounded-full font-bold text-body-sm shadow-lg">
                      {date.getDate()}
                    </span>
                  ) : (
                    <span className={`text-body-sm ${isWeekend ? 'font-bold text-on-surface' : 'text-on-surface-variant'}`}>
                      {date.getDate()}
                    </span>
                  )}
                  {dots.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5">
                      {dots.map((dot, i) => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full"
                          style={dot.done
                            ? { backgroundColor: dot.hex }
                            : { border: `1.5px solid ${dot.hex}`, opacity: 0.55 }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Task pills */}
                <div className="mt-auto flex flex-col gap-0.5 overflow-hidden">
                  {dayTasks.slice(0, 2).map(task => (
                    <div
                      key={task.id}
                      className="text-[10px] font-bold px-xs py-0.5 rounded truncate"
                      style={{
                        backgroundColor: 'rgba(0,74,198,0.1)',
                        borderLeft: '3px solid #004ac6',
                        color: '#003ea8',
                      }}
                    >
                      {task.title}
                    </div>
                  ))}
                  {dayTasks.length > 2 && (
                    <div className="text-[9px] text-outline pl-xs">+{dayTasks.length - 2} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
