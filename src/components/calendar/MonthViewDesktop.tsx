import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { rotateWeek, weekdayAt, fmt } from '../../dates';
import { isDone } from '../../todoLogic';
import { shortTime } from '../../eventLogic';
import { colorHex } from '../../colors';
import { eventTitle, sharedTitleAttr } from '../../sharedDisplay';
import { BarsOverlay, DueDots, PastX, PeriodCorners, PeriodTitles } from './monthParts';
import type { MonthLayoutProps } from './monthModel';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A desktop cell has room for two chips and a bottom-pinned stack. */
/*
 * A chip's tint/hairline/ink trio, keyed by the event's own colour.
 *
 * One table rather than a copy inside each of the two chip loops — they had
 * drifted apart before, and a category added to only one of them shows up as
 * a chip that is tinted in the grid but not in the to-do row beneath it.
 * Unmatched colours fall back to purple, the app accent.
 */
const CHIP_TINTS: Record<string, string> = {
  '#a855f7': 'bg-cat-purple-tint border-cat-purple-line text-cat-purple-ink',
  '#f59e0b': 'bg-cat-amber-tint border-cat-amber-line text-cat-amber-ink',
  '#3b82f6': 'bg-cat-blue-tint border-cat-blue-line text-cat-blue-ink',
  '#10b981': 'bg-cat-green-tint border-cat-green-line text-cat-green-ink',
  '#ec4899': 'bg-cat-pink-tint border-cat-pink-line text-cat-pink-ink',
  '#06b6d4': 'bg-cat-teal-tint border-cat-teal-line text-cat-teal-ink',
  '#ef4444': 'bg-cat-red-tint border-cat-red-line text-cat-red-ink',
};

function chipTint(hex: string): string {
  return CHIP_TINTS[hex] ?? CHIP_TINTS['#a855f7'];
}

export const PILL_CAP = 2;

/*
 * Event chip styling: square corners, category-tinted backgrounds
 */
const CHIP_CLASS =
  'text-[10px] font-semibold px-xs py-[2px] overflow-hidden whitespace-nowrap';

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
const RESERVED = '200px + 16px + 320px';

export default function MonthViewDesktop({
  weeks,
  onEditEvent,
  onEditTodo,
  onDayClick,
  onAdd,
}: MonthLayoutProps) {
  const { firstDayOfWeek, currentMonth, setCurrentMonth } = useApp();

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

  const monthStr = fmt(currentMonth).substring(0, 7);

  const handlePrevMonth = () => {
    setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  };

  return (
    <div
      style={{ width, maxWidth: `calc(100vw - (${RESERVED}))` }}
      className="flex-1 min-h-0 overflow-hidden flex flex-col bg-surface border border-line">
      {/* Calendar header with navigation and add button */}
      <div className="flex items-center gap-xs px-[var(--space-16)] py-[var(--space-16)] border-b border-line flex-shrink-0 bg-surface">
        <button
          onClick={handlePrevMonth}
          className="w-7 h-7 flex items-center justify-center border border-line hover:border-accent text-ink-secondary hover:text-ink transition-colors"
        >
          <ChevronLeft size={14} />
        </button>

        <select
          value={monthStr}
          onChange={(e) => {
            const [year, month] = e.target.value.split('-').map(Number);
            setCurrentMonth(new Date(year, month - 1, 1));
          }}
          className="px-xs py-[6px] border border-line bg-surface text-[13px] font-medium font-body cursor-pointer"
        >
          {Array.from({ length: 12 }).map((_, i) => {
            const d = new Date(currentMonth.getFullYear(), i, 1);
            const key = fmt(d).substring(0, 7);
            const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
            return <option key={key} value={key}>{label}</option>;
          })}
        </select>

        <button
          onClick={handleNextMonth}
          className="w-7 h-7 flex items-center justify-center border border-line hover:border-accent text-ink-secondary hover:text-ink transition-colors"
        >
          <ChevronRight size={14} />
        </button>

        <button
          onClick={onAdd}
          className="ml-auto px-xs py-[6px] border border-accent text-accent text-[12px] font-semibold hover:bg-accent-tint transition-colors"
        >
          + Add
        </button>
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
              className={`py-xs px-[var(--space-6)] text-center text-[9px] font-bold uppercase tracking-wider ${
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
        {weeks.map(week => (
          <div key={week.key} className="flex-1 relative min-h-[92px]">
            {/* Day cells */}
            <div className="grid grid-cols-7 h-full">
              {week.days.map((cell, colIdx) => {
                const isLastCol = colIdx === 6;
                return (
                  <div
                    key={cell.dateStr}
                    className={`relative cursor-pointer px-[var(--space-6)] py-[5px] ${
                      !cell.isCurrentMonth ? 'bg-[var(--t-past-cell)]' : 'bg-surface'
                    } ${
                      !isLastCol ? 'border-r border-line' : ''
                    } ${
                      cell.isCurrentMonth ? 'border-b border-line' : 'border-b border-line'
                    }`}
                    style={{ background: cell.background }}
                    onClick={() => onDayClick(cell.dateStr)}
                  >
                    <PastX cell={cell} />
                    <PeriodCorners cell={cell} />

                    <div className="flex items-start justify-between mb-xs">
                      {/* Day number */}
                      <span
                        className={`text-[11px] font-semibold ${
                          !cell.isCurrentMonth
                            ? 'text-[var(--t-past-ink)]'
                            : cell.isWeekend
                            ? 'text-ink font-bold'
                            : 'text-ink-secondary'
                        }`}
                      >
                        {cell.date.getDate()}
                      </span>
                      <DueDots cell={cell} />
                    </div>

                    <PeriodTitles cell={cell} onEditEvent={onEditEvent} />

                    {/* space reserved for the spanning bars overlay */}
                    {week.barsHeight > 0 && <div style={{ height: week.barsHeight }} />}

                    {/* Event + one-time to-do chips, pinned to the bottom of the cell */}
                    <div className="flex flex-col gap-[2px] overflow-hidden mt-auto text-[10px]">
                      {cell.shownOccs.map(o => {
                        const hex = colorHex(o.event.colorKey);
                        return (
                          <div
                            key={o.key}
                            onClick={e => { e.stopPropagation(); onEditEvent(o); }}
                            title={sharedTitleAttr(o.event)}
                            className={`${CHIP_CLASS} border ${chipTint(hex)} ${
                              o.event.sharedBy ? 'opacity-45' : ''
                            }`}
                          >
                            {o.event.startTime && !o.event.allDay && (
                              <span className="font-normal opacity-70">{shortTime(o.event.startTime)} </span>
                            )}
                            {eventTitle(o.event)}
                          </div>
                        );
                      })}
                      {cell.shownOnce.map(todo => {
                        const hex = colorHex(todo.colorKey);
                        return (
                          <div
                            key={todo.id}
                            onClick={e => { e.stopPropagation(); onEditTodo(todo); }}
                            className={`${CHIP_CLASS} border ${chipTint(hex)} ${isDone(todo) ? 'line-through opacity-50' : ''}`}
                          >
                            {todo.name}
                          </div>
                        );
                      })}
                      {cell.hiddenCount > 0 && (
                        <div className="text-[9px] text-ink-muted pl-xs">
                          +{cell.hiddenCount} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <BarsOverlay week={week} top={34} onEditEvent={onEditEvent} />
          </div>
        ))}
      </div>
    </div>
  );
}
