import { useApp } from '../../context/AppContext';
import { rotateWeek } from '../../dates';
import { isDone } from '../../todoLogic';
import { colorHex, PILL_BG_ALPHA } from '../../colors';
import { BarsOverlay, DueDots, PastX, PeriodCorners, PeriodTitles } from './monthParts';
import type { MonthLayoutProps } from './monthModel';

/** A phone column is ~50px — three letters plus padding is wider than that. */
const WEEKDAYS_NARROW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A phone cell fits one legible chip; two only truncate each other away. */
export const PILL_CAP = 1;

const PILL_CLASS = 'text-[9px] font-bold px-0.5 rounded-sm truncate hover:opacity-80';
const PILL_BORDER = '2px';

export default function MonthViewMobile({
  weeks,
  onEditEvent,
  onEditTodo,
  onDayClick,
}: MonthLayoutProps) {
  const { firstDayOfWeek } = useApp();

  return (
    // full bleed — the grid meets both screen edges, so no rounding or border
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-sheet">
      {/* Weekday headers. Single letters are too cramped to also carry the
          weekend emphasis the desktop header uses. */}
      <div className="grid grid-cols-7 border-b flex-shrink-0 border-sheet-line bg-sheet-header">
        {rotateWeek(WEEKDAYS_NARROW, firstDayOfWeek).map((day, i) => (
          <div key={i} className="py-1 text-center text-[9px] font-bold text-sheet-txt-faint">
            {day}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-hide">
        {weeks.map(week => (
          <div key={week.key} className="flex-1 relative min-h-[76px]">
            {/* Day cells */}
            <div className="grid grid-cols-7 h-full">
              {week.days.map(cell => (
                <div
                  key={cell.dateStr}
                  className={`calendar-cell relative cursor-pointer p-0.5 ${
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
                      className={`text-[11px] px-0.5 ${
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

                  {/* Event + one-time to-do pills. Phone cells are tall enough
                      that bottom-pinned chips float away from their date, so
                      these group under it instead of using mt-auto. */}
                  <div className="flex flex-col gap-0.5 overflow-hidden mt-0.5">
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
                          {/* no time prefix — it eats the whole chip at this width */}
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
                      <div className="text-[9px] text-sheet-txt-faint pl-0.5">
                        +{cell.hiddenCount}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <BarsOverlay week={week} top={22} onEditEvent={onEditEvent} />
          </div>
        ))}
      </div>
    </div>
  );
}
