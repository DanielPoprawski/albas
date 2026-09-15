import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useApp } from '../../context/AppContext';
import { rotateWeek } from '../../dates';
import { BarsOverlay, MonthCell } from './monthParts';
import { useMonthSwipe } from './useMonthSwipe';
import type { MonthLayoutProps } from './monthModel';

/** A phone column is ~3.125rem — three letters plus padding is wider than that. */
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

/** How long the month slide runs; matches the keyframes in App.css. */
/** The slide is 220ms — written literally, since Tailwind only emits class strings it can see. */
const SLIDE_CLASS = {
  1: 'animate-[month-slide-next_220ms_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none',
  '-1': 'animate-[month-slide-prev_220ms_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none',
} as const;

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
    className: dir === 0 ? '' : SLIDE_CLASS[dir],
  };
}

export default function MonthViewMobile({ weeks, onEditEvent, onEditTodo, onDayClick }: MonthLayoutProps) {
  const { firstDayOfWeek } = useApp();
  const swipe = useMonthSwipe();
  const slide = useMonthSlide();

  return (
    // full bleed — the grid meets both screen edges, so no rounding or border
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-surface" {...swipe}>
      {/* Weekday headers. Outside the sliding element: they're identical every
          month, and animating them would just flicker. */}
      <div className="grid grid-cols-7 border-b flex-shrink-0 border-line bg-subtle">
        {rotateWeek(WEEKDAYS_NARROW, firstDayOfWeek).map((day, i) => (
          <div key={i} className="py-1 text-center text-xs font-bold text-ink-muted">
            {day}
          </div>
        ))}
      </div>

      {/* Week rows. The animated element is a wrapper of its own so the
          scroll container underneath it never has to own a transform — a
          translate inside an `overflow-y: auto` box makes the browser offer a
          horizontal scrollbar for the duration of the slide. */}
      <div key={slide.key} className={`flex-1 min-h-0 flex flex-col ${slide.className}`}>
        <div className="flex-1 min-h-0 flex flex-col">
          {weeks.map((week) => (
            // A fixed, equal height per week rather than `flex-1`: on the phone
            // this grid sits in an unbounded scroll column, so flex rows sized
            // to their content and the inner `h-full` resolved to auto — rows
            // with events came out tall, empty rows short, and the cells never
            // filled their row. 4rem is a date line plus one chip plus a bar
            // lane, and six of them are what the dashboard reserves.
            <div key={week.key} className="relative h-16 grid grid-cols-7">
              {week.days.map((cell) => (
                <MonthCell
                  key={cell.dateStr}
                  cell={cell}
                  week={week}
                  variant="mobile"
                  className={cn(
                    'border-r border-b border-line',
                    cell.isSelected && !cell.isToday && !cell.background && 'bg-primary/10',
                  )}
                  onDayClick={onDayClick}
                  onEditEvent={onEditEvent}
                  onEditTodo={onEditTodo}
                />
              ))}

              <BarsOverlay week={week} topClass="top-5" onEditEvent={onEditEvent} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
