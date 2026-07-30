import { useApp } from '../../context/AppContext';
import { rotateWeek, weekdayAt } from '../../dates';
import { isDone } from '../../todoLogic';
import { shortTime } from '../../eventLogic';
import { colorHex, PILL_BG_ALPHA } from '../../colors';
import { BarsOverlay, DueDots, PastX, PeriodCorners, PeriodTitles } from './monthParts';
import type { MonthLayoutProps } from './monthModel';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** A desktop cell has room for two chips and a bottom-pinned stack. */
export const PILL_CAP = 2;

const PILL_CLASS = 'text-[10px] font-bold px-xs py-0.5 rounded truncate hover:opacity-80';
const PILL_BORDER = '3px';

export default function MonthViewDesktop({
  weeks,
  onEditEvent,
  onEditTodo,
  onDayClick,
}: MonthLayoutProps) {
  const { firstDayOfWeek } = useApp();

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-sheet rounded-xl border shadow-2xl border-sheet-border">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b flex-shrink-0 border-sheet-line bg-sheet-header">
        {rotateWeek(WEEKDAYS, firstDayOfWeek).map((day, i) => {
          // weekend follows the actual weekday, not the column index — under a
          // Sunday start, columns 5 and 6 are Friday and Saturday
          const dayNum = weekdayAt(i, firstDayOfWeek);
          const isWeekendCol = dayNum === 0 || dayNum === 6;
          return (
            <div
              key={i}
              className={`py-sm text-center text-label-md font-bold ${
                isWeekendCol ? 'text-sheet-txt' : 'text-sheet-txt-faint'
              }`}
            >
              {day}
            </div>
          );
        })}
      </div>

      {/* Week rows */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-hide">
        {weeks.map(week => (
          <div key={week.key} className="flex-1 relative min-h-[92px]">
            {/* Day cells */}
            <div className="grid grid-cols-7 h-full">
              {week.days.map(cell => (
                <div
                  key={cell.dateStr}
                  className={`calendar-cell relative cursor-pointer p-sm ${
                    !cell.isCurrentMonth ? 'opacity-30' : ''
                  } ${
                    cell.isSelected && !cell.isToday && !cell.background ? 'bg-primary/10' : ''
                  }`}
                  style={{ background: cell.background }}
                  onClick={() => onDayClick(cell.dateStr)}
                >
                  <PastX cell={cell} />
                  <PeriodCorners cell={cell} />

                  <div className="flex items-start justify-between">
                    {/* Today gets no marker of its own — it reads as the first
                        day that isn't struck through. */}
                    <span
                      className={`text-body-sm ${
                        cell.isWeekend ? 'font-bold text-sheet-txt' : 'text-sheet-txt-muted'
                      }`}
                    >
                      {cell.date.getDate()}
                    </span>
                    <DueDots cell={cell} />
                  </div>

                  <PeriodTitles cell={cell} onEditEvent={onEditEvent} />

                  {/* space reserved for the spanning bars overlay */}
                  {week.barsHeight > 0 && <div style={{ height: week.barsHeight }} />}

                  {/* Event + one-time to-do pills, pinned to the bottom of the cell */}
                  <div className="flex flex-col gap-0.5 overflow-hidden mt-auto">
                    {cell.shownOccs.map(o => {
                      const hex = colorHex(o.event.colorKey);
                      return (
                        <div
                          key={o.key}
                          onClick={e => { e.stopPropagation(); onEditEvent(o); }}
                          className={PILL_CLASS}
                          style={{
                            backgroundColor: `${hex}${PILL_BG_ALPHA}`,
                            borderLeft: `${PILL_BORDER} solid ${hex}`,
                            color: hex,
                          }}
                        >
                          {o.event.startTime && !o.event.allDay && (
                            <span className="font-normal opacity-70">{shortTime(o.event.startTime)} </span>
                          )}
                          {o.event.title}
                        </div>
                      );
                    })}
                    {cell.shownOnce.map(todo => {
                      const hex = colorHex(todo.colorKey);
                      return (
                        <div
                          key={todo.id}
                          onClick={e => { e.stopPropagation(); onEditTodo(todo); }}
                          className={`${PILL_CLASS} ${isDone(todo) ? 'line-through opacity-50' : ''}`}
                          style={{
                            backgroundColor: `${hex}${PILL_BG_ALPHA}`,
                            borderLeft: `${PILL_BORDER} solid ${hex}`,
                            color: hex,
                          }}
                        >
                          {todo.name}
                        </div>
                      );
                    })}
                    {cell.hiddenCount > 0 && (
                      <div className="text-[9px] text-sheet-txt-faint pl-xs">
                        +{cell.hiddenCount} more
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <BarsOverlay week={week} top={34} onEditEvent={onEditEvent} />
          </div>
        ))}
      </div>
    </div>
  );
}
