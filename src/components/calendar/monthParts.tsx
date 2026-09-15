import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { accentNameOf, CATEGORY_CLASSES, colorHex, PILL_BG_ALPHA, tintOf } from '../../colors';
import { shortTime, type Occurrence } from '../../eventLogic';
import { eventTitle, sharedOpacity, sharedTitleAttr } from '../../sharedLogic';
import { isDone } from '../../todoLogic';
import type { Todo } from '../../types';
import type { DayCell, WeekRow } from './monthModel';

/** Layout-independent pieces of the month grid, shared by both variants. */

/** How one chip (an event occurrence or a one-time to-do) is painted. */
interface ChipPaint {
  className: string;
  style?: CSSProperties;
}

/**
 * The desktop chip: a category accent draws from its `--t-cat-*` classes (so
 * it follows dark mode); any other stored colour — the picker offers dozens —
 * gets a translucent wash of itself rather than silently turning purple.
 */
function desktopPaint(hex: string): ChipPaint {
  const name = accentNameOf(hex);
  if (name) {
    const c = CATEGORY_CLASSES[name];
    return { className: `${c.tint} ${c.line} ${c.ink}` };
  }
  return { className: '', style: { background: tintOf(hex), borderColor: tintOf(hex, 0.35), color: hex } };
}

/** The phone pill: the colour at `PILL_BG_ALPHA` behind itself, no border. */
function mobilePaint(hex: string): ChipPaint {
  return { className: '', style: { backgroundColor: `${hex}${PILL_BG_ALPHA}`, color: hex } };
}

/**
 * What separates the two month layouts inside a cell. Everything else — the
 * span corners, the day number's colour ladder, the period titles, the bar
 * lane spacer, the dimmed chip group and its overflow count — is `MonthCell`.
 */
const CELL_VARIANTS = {
  desktop: {
    cell: 'px-1.5 py-[0.3125rem]',
    liveBg: 'bg-surface',
    dayRow: 'flex items-start justify-between mb-xs',
    dayNumber: 'text-xs font-semibold',
    chips: 'gap-[2px] mt-auto text-xs',
    chip: 'text-xs font-semibold px-xs py-[2px] overflow-hidden whitespace-nowrap border',
    paint: desktopPaint,
    /* The time prefix only fits at desktop widths. */
    time: true,
    more: (n: number) => `+${n} more`,
    morePad: 'pl-xs',
  },
  mobile: {
    cell: 'px-px py-0.5 transition-colors hover:bg-accent-tint',
    liveBg: '',
    dayRow: '',
    dayNumber: 'text-xs px-0.5',
    chips: 'gap-px mt-px',
    chip: 'text-xs font-semibold px-px truncate hover:opacity-80',
    paint: mobilePaint,
    time: false,
    more: (n: number) => `+${n}`,
    morePad: 'pl-0.5',
  },
} as const;

export type MonthCellVariant = keyof typeof CELL_VARIANTS;

/** One day of the month grid: the cell body both layouts draw. */
export function MonthCell({
  cell,
  week,
  variant,
  className,
  onDayClick,
  onEditEvent,
  onEditTodo,
}: {
  cell: DayCell;
  week: WeekRow;
  variant: MonthCellVariant;
  /** Borders and any layout-specific extras (the phone's selected tint). */
  className?: string;
  onDayClick: (dateStr: string) => void;
  onEditEvent: (o: Occurrence) => void;
  onEditTodo: (t: Todo) => void;
}) {
  const v = CELL_VARIANTS[variant];
  const dim = dimCell(cell);
  const chip = (key: string, hex: string, onClick: () => void, extra: string, title?: string, body?: ReactNode) => {
    const paint = v.paint(hex);
    return (
      <div
        key={key}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title={title}
        className={cn(v.chip, paint.className, extra)}
        // dynamic: the chip's own colour
        style={paint.style}
      >
        {body}
      </div>
    );
  };

  return (
    <div
      className={cn(
        'relative flex flex-col cursor-pointer overflow-hidden',
        v.cell,
        !cell.isCurrentMonth ? 'bg-outside-cell' : cell.isPast ? 'bg-past-cell' : v.liveBg,
        cell.isToday && 'today-cell',
        className,
      )}
      // dynamic: a long span washes its cells in its own colour
      style={{ background: cell.background }}
      onClick={() => onDayClick(cell.dateStr)}
    >
      <PeriodCorners cell={cell} />

      <div className={v.dayRow}>
        <span
          className={cn(
            v.dayNumber,
            !cell.isCurrentMonth
              ? 'text-outside-ink'
              : cell.isPast
                ? 'text-past-ink'
                : cell.isWeekend
                  ? 'font-bold text-ink'
                  : 'text-ink-secondary',
          )}
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

      {/* Event + one-time to-do chips. Past/outside days dull their chips as
          one group rather than each chip computing its own dim — the wrapper
          isn't absolutely positioned, so opacity here doesn't disturb the
          overlay layers (BarsOverlay/PeriodCorners) painted outside it. */}
      <div className={cn('flex flex-col overflow-hidden', v.chips, dim && 'opacity-50')}>
        {cell.shownOccs.map((o) =>
          chip(
            o.key,
            colorHex(o.event.colorKey),
            () => onEditEvent(o),
            o.event.sharedBy ? 'opacity-45' : '',
            sharedTitleAttr(o.event),
            <>
              {v.time && o.event.startTime && !o.event.allDay && (
                <span className="font-normal opacity-70">{shortTime(o.event.startTime)} </span>
              )}
              {eventTitle(o.event)}
            </>,
          ),
        )}
        {cell.shownOnce.map((todo) =>
          chip(
            todo.id,
            colorHex(todo.colorKey),
            () => onEditTodo(todo),
            isDone(todo) ? 'line-through opacity-50' : '',
            undefined,
            todo.name,
          ),
        )}
        {cell.hiddenCount > 0 && (
          <div className={cn('text-xs text-ink-muted', v.morePad)}>{v.more(cell.hiddenCount)}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Whether a cell's own content (chips, titles, bars) should read as
 * dulled: an elapsed day in the current month, or any day outside it. Kept
 * separate from the cell *background* choice (outside beats past there) since
 * both cases dim the same way.
 */
export function dimCell(cell: DayCell): boolean {
  return cell.isPast || !cell.isCurrentMonth;
}

/** Half-border brackets marking the start/end days of a week-plus span. */
export function PeriodCorners({ cell }: { cell: DayCell }) {
  return (
    <>
      {cell.longStarts.map((o) => {
        const hex = colorHex(o.event.colorKey);
        return (
          <span key={`s-${o.key}`} className="pointer-events-none">
            <span
              className="absolute top-0 left-0 w-2 h-2"
              // dynamic: the span's own colour
              style={{ borderTop: `2px solid ${hex}`, borderLeft: `2px solid ${hex}` }}
            />
            <span
              className="absolute bottom-0 left-0 w-2 h-2"
              // dynamic: the span's own colour
              style={{ borderBottom: `2px solid ${hex}`, borderLeft: `2px solid ${hex}` }}
            />
          </span>
        );
      })}
      {cell.longEnds.map((o) => {
        const hex = colorHex(o.event.colorKey);
        return (
          <span key={`e-${o.key}`} className="pointer-events-none">
            <span
              className="absolute top-0 right-0 w-2 h-2"
              // dynamic: the span's own colour
              style={{ borderTop: `2px solid ${hex}`, borderRight: `2px solid ${hex}` }}
            />
            <span
              className="absolute bottom-0 right-0 w-2 h-2"
              // dynamic: the span's own colour
              style={{ borderBottom: `2px solid ${hex}`, borderRight: `2px solid ${hex}` }}
            />
          </span>
        );
      })}
    </>
  );
}

/** The period name, shown once on its start day. */
export function PeriodTitles({ cell, onEditEvent }: { cell: DayCell; onEditEvent: (o: Occurrence) => void }) {
  // Multiplied rather than a separate `opacity-50` class: an inline `style`
  // always wins over a class, so a shared-event's own opacity would silently
  // swallow the dim.
  const dimFactor = dimCell(cell) ? 0.5 : 1;
  return (
    <>
      {cell.longStarts.map((o) => (
        <div
          key={`t-${o.key}`}
          onClick={(e) => {
            e.stopPropagation();
            onEditEvent(o);
          }}
          title={sharedTitleAttr(o.event)}
          className="text-xs font-bold uppercase tracking-wide truncate hover:opacity-70"
          // dynamic: the event's own colour, dimmed when shared
          style={{ color: colorHex(o.event.colorKey), opacity: (sharedOpacity(o.event) ?? 1) * dimFactor }}
        >
          {eventTitle(o.event)}
        </div>
      ))}
    </>
  );
}

/**
 * All-day/multi-day event bars, absolutely positioned over the week's cells.
 * `top` clears the day-number row, which is shorter under the phone's padding.
 *
 * Bars span multiple columns, so a single segment can straddle both dimmed
 * and live days — splitting one visually would look broken, so a segment
 * only dulls when *every* column it covers is dimmed (`week.days`, in
 * column order); a bar still running into today or the future stays at full
 * strength.
 */
export function BarsOverlay({
  week,
  topClass,
  onEditEvent,
}: {
  week: WeekRow;
  /** A `top-*` utility clearing the layout's day-number row. */
  topClass: string;
  onEditEvent: (o: Occurrence) => void;
}) {
  if (week.barLanes.length === 0) return null;
  return (
    <div className={`absolute left-0 right-0 grid grid-cols-7 auto-rows-min pointer-events-none ${topClass}`}>
      {week.barLanes.map(({ seg, lane }) => {
        const hex = colorHex(seg.item.event.colorKey);
        // Multiplied, not a separate `opacity-50` class — an inline `style`
        // always wins over a class, so a shared-event's own opacity would
        // silently swallow the dim.
        const dimFactor = week.days.slice(seg.startCol - 1, seg.startCol - 1 + seg.span).every(dimCell) ? 0.5 : 1;
        return (
          <div
            key={seg.item.key}
            onClick={(e) => {
              e.stopPropagation();
              onEditEvent(seg.item);
            }}
            title={sharedTitleAttr(seg.item.event)}
            className={`pointer-events-auto cursor-pointer text-xs font-bold px-xs truncate hover:opacity-90 h-lane-h leading-(--spacing-lane-h) mb-0.5 ${seg.startsHere ? 'ml-1' : ''} ${seg.endsHere ? 'mr-1' : ''}`}
            // dynamic: grid placement and the event's own colour
            style={{
              gridColumn: `${seg.startCol} / span ${seg.span}`,
              gridRow: lane + 1,
              backgroundColor: `${hex}cc`,
              color: 'var(--t-on-accent)',
              opacity: (sharedOpacity(seg.item.event) ?? 1) * dimFactor,
            }}
          >
            {seg.startsHere ? eventTitle(seg.item.event) : '…'}
          </div>
        );
      })}
    </div>
  );
}
