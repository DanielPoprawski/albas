import { colorHex } from '../../colors';
import { eventTitle, sharedOpacity, sharedTitleAttr } from '../../sharedDisplay';
import type { Occurrence } from '../../eventLogic';
import type { DayCell, WeekRow } from './monthModel';

/** Layout-independent pieces of the month grid, shared by both variants. */

/** Half-border brackets marking the start/end days of a week-plus span. */
export function PeriodCorners({ cell }: { cell: DayCell }) {
  return (
    <>
      {cell.longStarts.map(o => {
        const hex = colorHex(o.event.colorKey);
        return (
          <span key={`s-${o.key}`} className="pointer-events-none">
            <span
              className="absolute top-0 left-0 w-2 h-2"
              style={{ borderTop: `2px solid ${hex}`, borderLeft: `2px solid ${hex}` }}
            />
            <span
              className="absolute bottom-0 left-0 w-2 h-2"
              style={{ borderBottom: `2px solid ${hex}`, borderLeft: `2px solid ${hex}` }}
            />
          </span>
        );
      })}
      {cell.longEnds.map(o => {
        const hex = colorHex(o.event.colorKey);
        return (
          <span key={`e-${o.key}`} className="pointer-events-none">
            <span
              className="absolute top-0 right-0 w-2 h-2"
              style={{ borderTop: `2px solid ${hex}`, borderRight: `2px solid ${hex}` }}
            />
            <span
              className="absolute bottom-0 right-0 w-2 h-2"
              style={{ borderBottom: `2px solid ${hex}`, borderRight: `2px solid ${hex}` }}
            />
          </span>
        );
      })}
    </>
  );
}

/**
 * Strikes out an elapsed day. `preserveAspectRatio="none"` stretches the box to
 * the cell whatever its aspect, and `vector-effect` keeps the stroke a true 1px
 * instead of scaling with it. Rendered before the cell content so titles and
 * chips paint over the lines and stay legible.
 */
export function PastX({ cell }: { cell: DayCell }) {
  if (!cell.isPast) return null;
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none text-past-x"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1="0" y1="0" x2="100" y2="100" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1="100" y1="0" x2="0" y2="100" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Repeating-to-do markers: filled = done that day, hollow ring = still due. */
export function DueDots({ cell }: { cell: DayCell }) {
  if (cell.dots.length === 0) return null;
  return (
    <div className="flex gap-0.5 mt-0.5">
      {cell.dots.map((dot, i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={dot.done
            ? { backgroundColor: dot.hex }
            : { border: `1.5px solid ${dot.hex}`, opacity: 0.55 }}
        />
      ))}
    </div>
  );
}

/** The period name, shown once on its start day. */
export function PeriodTitles({
  cell,
  onEditEvent,
}: {
  cell: DayCell;
  onEditEvent: (o: Occurrence) => void;
}) {
  return (
    <>
      {cell.longStarts.map(o => (
        <div
          key={`t-${o.key}`}
          onClick={e => { e.stopPropagation(); onEditEvent(o); }}
          title={sharedTitleAttr(o.event)}
          className="text-[9px] font-bold uppercase tracking-wide truncate hover:opacity-70"
          style={{ color: colorHex(o.event.colorKey), opacity: sharedOpacity(o.event) }}
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
 */
export function BarsOverlay({
  week,
  top,
  onEditEvent,
}: {
  week: WeekRow;
  top: number;
  onEditEvent: (o: Occurrence) => void;
}) {
  if (week.barsHeight === 0) return null;
  return (
    <div
      className="absolute left-0 right-0 grid grid-cols-7 pointer-events-none"
      style={{ top, gridAutoRows: 'min-content' }}
    >
      {week.barLanes.map(({ seg, lane }) => {
        const hex = colorHex(seg.item.event.colorKey);
        return (
          <div
            key={seg.item.key}
            onClick={e => { e.stopPropagation(); onEditEvent(seg.item); }}
            title={sharedTitleAttr(seg.item.event)}
            className="pointer-events-auto cursor-pointer text-[10px] font-bold px-xs truncate hover:opacity-90"
            style={{
              gridColumn: `${seg.startCol} / span ${seg.span}`,
              gridRow: lane + 1,
              height: 18,
              lineHeight: '18px',
              marginBottom: 2,
              marginLeft: seg.startsHere ? 4 : 0,
              marginRight: seg.endsHere ? 4 : 0,
              borderRadius: seg.startsHere && seg.endsHere ? 6
                : seg.startsHere ? '6px 0 0 6px'
                : seg.endsHere ? '0 6px 6px 0' : 0,
              backgroundColor: `${hex}cc`,
              color: '#fff',
              opacity: sharedOpacity(seg.item.event),
            }}
          >
            {seg.startsHere ? eventTitle(seg.item.event) : '…'}
          </div>
        );
      })}
    </div>
  );
}
