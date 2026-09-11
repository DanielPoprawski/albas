import { colorHex } from '../../colors';
import { eventTitle, sharedOpacity, sharedTitleAttr } from '../../sharedDisplay';
import type { Occurrence } from '../../eventLogic';
import type { DayCell, WeekRow } from './monthModel';

/** Layout-independent pieces of the month grid, shared by both variants. */

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
