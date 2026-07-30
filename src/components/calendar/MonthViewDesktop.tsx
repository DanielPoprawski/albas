import { useEffect, useRef, useState } from 'react';
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

/*
 * `overflow-hidden whitespace-nowrap` rather than `truncate`: truncate adds an
 * ellipsis, which costs a character of an already narrow cell and tells you
 * nothing you couldn't see from the clipped word. The colour now reads from the
 * tinted background alone — the old 3px left tab spent horizontal space
 * repeating information.
 */
const PILL_CLASS =
  'text-[10px] font-bold px-xs py-0.5 rounded overflow-hidden whitespace-nowrap hover:opacity-80';

/**
 * A day cell wants to be 3 wide by 2 tall. Height is dictated by the window,
 * so the grid derives its own *width* from the height it was given and lets
 * whatever is beside it have the rest — rather than stretching to fill and
 * leaving the cells over-wide.
 */
const CELL_ASPECT = 3 / 2;

/**
 * The grid sits in a `flex-none` column, so nothing downstream can shrink it —
 * it has to refuse to starve the panel itself. The rail is `w-16`, which is
 * rem-based and scales with the browser's root font size, so it has to be
 * subtracted as 4rem and not a px guess; the column's padding (p-md) and the
 * panel's floor are genuine pixels.
 */
const RESERVED = '4rem + 48px + 280px';

export default function MonthViewDesktop({
  weeks,
  onEditEvent,
  onEditTodo,
  onDayClick,
}: MonthLayoutProps) {
  const { firstDayOfWeek } = useApp();

  // Measure the rows area, not the whole sheet: the weekday header's height
  // isn't part of any cell. Width never feeds back into height (that comes from
  // the flex parent), so this settles in one pass.
  const rowsRef = useRef<HTMLDivElement>(null);
  const [rowsHeight, setRowsHeight] = useState(0);
  useEffect(() => {
    const el = rowsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setRowsHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = Math.max(weeks.length, 1);
  // 0 until the first measurement lands; full width is the sane starting point
  const width = rowsHeight > 0 ? (rowsHeight / rows) * CELL_ASPECT * 7 : undefined;

  return (
    <div
      style={{ width, maxWidth: `calc(100vw - (${RESERVED}))` }}
      className="flex-1 min-h-0 overflow-hidden flex flex-col bg-sheet rounded-xl border shadow-2xl border-sheet-border">
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
      <div ref={rowsRef} className="flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-hide">
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
