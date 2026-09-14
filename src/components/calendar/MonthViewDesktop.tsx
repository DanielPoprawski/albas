import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { rotateWeek, weekdayAt } from '../../dates';
import { goToday, isThisMonth, stepMonth } from '../../calendarNav';
import { isDone } from '../../todoLogic';
import { shortTime } from '../../eventLogic';
import { CATEGORY_CLASSES, accentNameOf, colorHex, tintOf } from '../../colors';
import { eventTitle, sharedTitleAttr } from '../../sharedLogic';
import { BarsOverlay, PeriodCorners, PeriodTitles, dimCell } from './monthParts';
import SearchPalette from '../search/SearchPalette';
import type { MonthLayoutProps } from './monthModel';
import MonthYearPopover from './MonthYearPopover';
import { Button, IconButton } from '../ui/button';
import { Card } from '../ui/card';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A desktop cell has room for two chips and a bottom-pinned stack. */
/*
 * A chip's tint/hairline/ink trio. A category accent draws from its
 * `--t-cat-*` classes (so it follows dark mode); any other stored colour — the
 * desktop picker offers dozens — gets a translucent wash of itself rather than
 * silently turning purple, which is what the old hex-keyed lookup did.
 */
function chipPaint(hex: string): { className: string; style?: CSSProperties } {
  const name = accentNameOf(hex);
  if (name) {
    const c = CATEGORY_CLASSES[name];
    return { className: `${c.tint} ${c.line} ${c.ink}` };
  }
  return { className: '', style: { background: tintOf(hex), borderColor: tintOf(hex, 0.35), color: hex } };
}

export const PILL_CAP = 2;

/*
 * Event chip styling: square corners, category-tinted backgrounds
 */
const CHIP_CLASS = 'text-xs font-semibold px-xs py-[2px] overflow-hidden whitespace-nowrap';

/**
 * A day cell wants to be 3 wide by 2 tall. Height is dictated by the window,
 * so the grid derives its own *width* from the height it was given and lets
 * whatever is beside it have the rest — rather than stretching to fill and
 * leaving the cells over-wide.
 */
const CELL_ASPECT = 3 / 2;

/**
 * The grid sits in a `flex-none` column, so nothing downstream can shrink it —
 * it has to refuse to starve the panel itself. Every term is a CSS var so
 * this tracks a live sidebar/right-panel drag (Phase L): the sidebar
 * (`--layout-sidebar-w`), a 1rem gap, the two 0.5rem `ResizeHandle`s either
 * side of the content column, and the right panel (`--layout-right-w`). Each
 * var falls back to its own default, so this is correct even before
 * `applyLayout()` has run.
 */
const RESERVED = 'var(--layout-sidebar-w, 12.5rem) + 1rem + 0.5rem + 0.5rem + var(--layout-right-w, 20rem)';

export default function MonthViewDesktop({ weeks, onEditEvent, onEditTodo, onDayClick }: MonthLayoutProps) {
  const { firstDayOfWeek, currentMonth, setCurrentMonth, setSelectedDate } = useApp();

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

  const nav = { setCurrentMonth, setSelectedDate };

  return (
    <Card
      // dynamic: width follows the ResizeObserver, see above
      style={{ width, maxWidth: `calc(100vw - (${RESERVED}))` }}
      className="flex-1 min-h-0 overflow-hidden flex flex-col"
    >
      {/* Calendar header: Today + month navigation on the left, search
          centred (adding is a click on a day — the "+ Add" button that used
          to sit here duplicated that). The third column is an empty spacer
          so the search stays centred on the sheet. */}
      <div className="grid grid-cols-[auto_minmax(12.5rem,1fr)_auto] items-center gap-4 px-4 py-3 border-b border-line flex-shrink-0 bg-surface">
        <div className="flex items-center gap-xs">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={isThisMonth(currentMonth)}
            onClick={() => goToday(nav)}
          >
            Today
          </Button>
          <IconButton variant="accent2" aria-label="Previous month" onClick={() => stepMonth(nav, -1)}>
            <ChevronLeft size="0.875rem" />
          </IconButton>
          <MonthYearPopover month={currentMonth} onPick={setCurrentMonth} />
          <IconButton variant="accent2" aria-label="Next month" onClick={() => stepMonth(nav, 1)}>
            <ChevronRight size="0.875rem" />
          </IconButton>
        </div>

        <SearchPalette scope="calendar" className="w-full max-w-[35rem] justify-self-center" />

        <div className="w-[4.5rem]" aria-hidden />
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b flex-shrink-0 border-line bg-subtle">
        {rotateWeek(WEEKDAYS, firstDayOfWeek).map((day, i) => {
          // weekend follows the actual weekday, not the column index — under a
          // Sunday start, columns 5 and 6 are Friday and Saturday
          const dayNum = weekdayAt(i, firstDayOfWeek);
          const isWeekendCol = dayNum === 0 || dayNum === 6;
          return (
            <div
              key={i}
              className={`py-xs px-1.5 text-center text-xs font-bold uppercase tracking-wider ${
                isWeekendCol ? 'text-ink' : 'text-ink-muted'
              }`}
            >
              {day}
            </div>
          );
        })}
      </div>

      {/* Week rows */}
      <div ref={rowsRef} className="flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-hide">
        {weeks.map((week) => (
          <div key={week.key} className="flex-1 relative min-h-[5.75rem]">
            {/* Day cells */}
            <div className="grid grid-cols-7 h-full">
              {week.days.map((cell, colIdx) => {
                const isLastCol = colIdx === 6;
                const dim = dimCell(cell);
                return (
                  <div
                    key={cell.dateStr}
                    className={`relative cursor-pointer px-1.5 py-[0.3125rem] ${
                      !cell.isCurrentMonth ? 'bg-outside-cell' : cell.isPast ? 'bg-past-cell' : 'bg-surface'
                    } ${!isLastCol ? 'border-r border-line' : ''} border-b border-line ${
                      cell.isToday ? 'today-cell' : ''
                    }`}
                    // dynamic: a long span washes its cells in its own colour
                    style={{ background: cell.background }}
                    onClick={() => onDayClick(cell.dateStr)}
                  >
                    <PeriodCorners cell={cell} />

                    <div className="flex items-start justify-between mb-xs">
                      {/* Day number */}
                      <span
                        className={`text-xs font-semibold ${
                          !cell.isCurrentMonth
                            ? 'text-outside-ink'
                            : cell.isPast
                              ? 'text-past-ink'
                              : cell.isWeekend
                                ? 'text-ink font-bold'
                                : 'text-ink-secondary'
                        }`}
                      >
                        {cell.date.getDate()}
                      </span>
                    </div>

                    <PeriodTitles cell={cell} onEditEvent={onEditEvent} />

                    {/* space reserved for the spanning bars overlay */}
                    {week.barLaneCount > 0 && (
                      // dynamic: one lane-row per bar lane this week carries
                      <div style={{ height: `calc(var(--spacing-lane-row) * ${week.barLaneCount})` }} />
                    )}

                    {/* Event + one-time to-do chips, pinned to the bottom of the cell.
                        Past/outside days dull their chips as one group rather than
                        each chip computing its own dim — the wrapper isn't absolutely
                        positioned, so opacity here doesn't disturb the overlay layers
                        (BarsOverlay/PeriodCorners) painted outside it. */}
                    <div
                      className={`flex flex-col gap-[2px] overflow-hidden mt-auto text-xs ${dim ? 'opacity-50' : ''}`}
                    >
                      {cell.shownOccs.map((o) => {
                        const paint = chipPaint(colorHex(o.event.colorKey));
                        return (
                          <div
                            key={o.key}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditEvent(o);
                            }}
                            title={sharedTitleAttr(o.event)}
                            className={`${CHIP_CLASS} border ${paint.className} ${
                              o.event.sharedBy ? 'opacity-45' : ''
                            }`}
                            // dynamic: the chip's own colour
                            style={paint.style}
                          >
                            {o.event.startTime && !o.event.allDay && (
                              <span className="font-normal opacity-70">{shortTime(o.event.startTime)} </span>
                            )}
                            {eventTitle(o.event)}
                          </div>
                        );
                      })}
                      {cell.shownOnce.map((todo) => {
                        const paint = chipPaint(colorHex(todo.colorKey));
                        return (
                          <div
                            key={todo.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditTodo(todo);
                            }}
                            className={`${CHIP_CLASS} border ${paint.className} ${isDone(todo) ? 'line-through opacity-50' : ''}`}
                            // dynamic: the chip's own colour
                            style={paint.style}
                          >
                            {todo.name}
                          </div>
                        );
                      })}
                      {cell.hiddenCount > 0 && (
                        <div className="text-xs text-ink-muted pl-xs">+{cell.hiddenCount} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <BarsOverlay week={week} topClass="top-[2.125rem]" onEditEvent={onEditEvent} />
          </div>
        ))}
      </div>
    </Card>
  );
}
