import { useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { rotateWeek } from '../../dates';
import { isDone } from '../../todoLogic';
import { colorHex, PILL_BG_ALPHA } from '../../colors';
import { BarsOverlay, PastX, PeriodCorners, PeriodTitles } from './monthParts';
import { useMonthSwipe } from './useMonthSwipe';
import type { MonthLayoutProps } from './monthModel';

/** A phone column is ~50px — three letters plus padding is wider than that. */
const WEEKDAYS_NARROW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A phone cell fits one legible chip; two only truncate each other away. */
export const PILL_CAP = 1;

/**
 * Always six rows. A month's natural 4–6 rows means the row height changes as
 * you swipe, which reads as the grid resizing under your thumb — and when a
 * six-week month follows a five-week one inside a fixed-height calendar, the
 * last week is pushed out of view entirely. Six rows costs a strip of greyed
 * next-month days and buys a grid that holds still.
 */
export const MIN_WEEKS = 6;

/**
 * No due dots on a phone. Home lists every habit immediately below the
 * calendar, so the dots repeated that list into the grid's tightest space.
 */
export const DUE_DOTS = false;

/** How long the month slide runs; matches the keyframes in App.css. */
const SLIDE_MS = 220;

/* See the note in MonthViewDesktop: no ellipsis, no left colour tab. */
const PILL_CLASS =
  'text-[9px] font-bold px-0.5 rounded-sm overflow-hidden whitespace-nowrap hover:opacity-80';

/**
 * Slides the grid in from the side the new month came from.
 *
 * The direction is derived from `currentMonth` rather than handed over by the
 * swipe hook, so stepping via the top bar or "jump to today" animates the same
 * way. `useLayoutEffect` sets it before paint — an effect would show the new
 * month at rest for a frame and then animate it in, which reads as a stutter.
 */
function useMonthSlide(): { key: number; className: string } {
  const { currentMonth } = useApp();
  const index = currentMonth.getFullYear() * 12 + currentMonth.getMonth();

  const prev = useRef(index);
  const [dir, setDir] = useState<1 | -1 | 0>(0);

  useLayoutEffect(() => {
    if (prev.current === index) return;
    setDir(index > prev.current ? 1 : -1);
    prev.current = index;
  }, [index]);

  return {
    // remounting restarts the animation; without a changing key the second
    // swipe in a direction would not replay it
    key: index,
    className: dir === 0 ? '' : dir === 1 ? 'month-slide-next' : 'month-slide-prev',
  };
}

export default function MonthViewMobile({
  weeks,
  onEditEvent,
  onEditTodo,
  onDayClick,
}: MonthLayoutProps) {
  const { firstDayOfWeek } = useApp();
  const swipe = useMonthSwipe();
  const slide = useMonthSlide();

  return (
    // full bleed — the grid meets both screen edges, so no rounding or border
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-sheet" {...swipe}>
      {/* Weekday headers. Outside the sliding element: they're identical every
          month, and animating them would just flicker. */}
      <div className="grid grid-cols-7 border-b flex-shrink-0 border-sheet-line bg-sheet-header">
        {rotateWeek(WEEKDAYS_NARROW, firstDayOfWeek).map((day, i) => (
          <div key={i} className="py-1 text-center text-[9px] font-bold text-sheet-txt-faint">
            {day}
          </div>
        ))}
      </div>

      {/* Week rows. The animated element is a wrapper of its own so the
          scroll container underneath it never has to own a transform — a
          translate inside an `overflow-y: auto` box makes the browser offer a
          horizontal scrollbar for the duration of the slide. */}
      <div
        key={slide.key}
        className={`flex-1 min-h-0 flex flex-col ${slide.className}`}
        style={{ animationDuration: `${SLIDE_MS}ms` }}
      >
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-hide">
          {weeks.map(week => (
            // floor is a date row plus one chip — six of these still fit a short
            // viewport without the grid starting to scroll
            <div key={week.key} className="flex-1 relative min-h-[54px]">
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

                    {/* Today gets no marker of its own — it reads as the first
                        day that isn't struck through. */}
                    <span
                      className={`text-[11px] px-0.5 ${
                        cell.isWeekend ? 'font-bold text-sheet-txt' : 'text-sheet-txt-muted'
                      }`}
                    >
                      {cell.date.getDate()}
                    </span>

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

              <BarsOverlay week={week} top={20} onEditEvent={onEditEvent} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
