import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { rotateWeek, weekdayAt } from '../../dates';
import { goToday, isThisMonth, stepMonth } from '../../calendarNav';
import { BarsOverlay, MonthCell } from './monthParts';
import SearchPalette from '../search/SearchPalette';
import type { MonthLayoutProps } from './monthModel';
import MonthYearPopover from './MonthYearPopover';
import { Button, IconButton } from '../ui/button';
import { Card } from '../ui/card';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A desktop cell has room for two chips and a bottom-pinned stack. */
export const PILL_CAP = 2;

/**
 * A day cell wants to be 3 wide by 2 tall. Height is dictated by the window,
 * so the grid derives its own *width* from the height it was given and lets
 * whatever is beside it have the rest — rather than stretching to fill and
 * leaving the cells over-wide.
 */
const CELL_ASPECT = 3 / 2;

export default function MonthViewDesktop({ weeks, onEditEvent, onEditTodo, onDayClick }: MonthLayoutProps) {
  const { firstDayOfWeek, currentMonth, setCurrentMonth, setSelectedDate, showRightPanel, toggleRightPanel } = useApp();

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

  const reservedRight = showRightPanel ? ' + 0.5rem + var(--layout-right-w, 20rem)' : '';
  const reserved = `var(--layout-sidebar-w, 12.5rem) + 1rem + 0.5rem${reservedRight}`;

  return (
    <Card
      // dynamic: width follows the ResizeObserver, see above
      style={{ width, maxWidth: `calc(100vw - (${reserved}))` }}
      className="flex-1 min-h-0 overflow-hidden flex flex-col"
    >
      {/* Calendar header: Today + month navigation on the left, search
          centred (adding is a click on a day — the "+ Add" button that used
          to sit here duplicated that). The third column toggles the companion panel
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

        <div className="flex items-center justify-end min-w-[4.5rem]">
          <IconButton
            variant="accent2"
            aria-label={showRightPanel ? 'Hide side panel' : 'Show side panel'}
            title={showRightPanel ? 'Hide side panel' : 'Show side panel'}
            onClick={toggleRightPanel}
          >
            {showRightPanel ? <PanelRightClose size="0.875rem" /> : <PanelRightOpen size="0.875rem" />}
          </IconButton>
        </div>
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
              {week.days.map((cell, colIdx) => (
                <MonthCell
                  key={cell.dateStr}
                  cell={cell}
                  week={week}
                  variant="desktop"
                  className={colIdx === 6 ? 'border-b border-line' : 'border-r border-b border-line'}
                  onDayClick={onDayClick}
                  onEditEvent={onEditEvent}
                  onEditTodo={onEditTodo}
                />
              ))}
            </div>

            <BarsOverlay week={week} topClass="top-[2.125rem]" onEditEvent={onEditEvent} />
          </div>
        ))}
      </div>
    </Card>
  );
}
