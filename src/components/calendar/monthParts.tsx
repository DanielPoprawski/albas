import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { COLOR_CLASSES } from '../../colors';
import { useApp } from '../../context/AppContext';
import { type Occurrence, shortTime } from '../../seedLogic';
import { seedTitle, sharedOpacity, sharedTitleAttr } from '../../sharedLogic';
import { Icon } from '../ui/icon';
import { type DayCell, occDone, type WeekRow } from './monthModel';

/** Layout-independent pieces of the month grid, shared by both variants. */

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
    chip: 'text-xs font-semibold px-xs py-[2px] overflow-hidden whitespace-nowrap border hover:shadow-pop',
    /* The time prefix and the tag icon only fit at desktop widths. */
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
    chip: 'text-xs font-extralight px-px overflow-hidden whitespace-nowrap hover:opacity-80 hover:shadow-pop',
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
  onShowDay,
  onEdit,
  onToggle,
}: {
  cell: DayCell;
  week: WeekRow;
  variant: MonthCellVariant;
  /** Borders and any layout-specific extras (the phone's selected tint). */
  className?: string;
  onDayClick: (dateStr: string) => void;
  onShowDay: (dateStr: string) => void;
  onEdit: (o: Occurrence) => void;
  onToggle: (o: Occurrence) => void;
}) {
  const { colorOf, iconOf } = useApp();
  const v = CELL_VARIANTS[variant];
  const dim = dimCell(cell);

  const chip = (o: Occurrence): ReactNode => {
    const c = COLOR_CLASSES[colorOf(o.seed)];
    const done = !!o.seed.track && occDone(o);
    const icon = v.time ? iconOf(o.seed) : null;
    return (
      <div
        key={o.key}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(o);
        }}
        title={sharedTitleAttr(o.seed)}
        className={cn(
          v.chip,
          c.tint,
          c.line,
          c.ink,
          'flex items-center gap-1',
          o.seed.sharedBy && 'opacity-45',
          done && 'line-through opacity-50',
        )}
      >
        {o.seed.track && !o.seed.sharedBy && (
          <Icon
            name={done ? 'check_box' : 'check_box_outline_blank'}
            size="0.75rem"
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(o);
            }}
          />
        )}
        {icon && <Icon name={icon} size="0.75rem" />}
        <span className="min-w-0 truncate">
          {v.time && o.seed.time && <span className="font-normal opacity-70">{shortTime(o.seed.time)} </span>}
          {seedTitle(o.seed)}
        </span>
      </div>
    );
  };

  return (
    <div
      className={cn(
        'relative flex flex-col cursor-pointer overflow-hidden',
        v.cell,
        !cell.isCurrentMonth ? 'bg-outside-cell' : cell.isPast ? 'bg-past-cell' : v.liveBg,
        // a long span washes its cells in its own tint
        cell.wash && COLOR_CLASSES[cell.wash].tint,
        cell.isToday && 'today-cell',
        className,
      )}
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

      <PeriodTitles cell={cell} onEdit={onEdit} />

      {/* space reserved for the spanning bars overlay */}
      {week.barLaneCount > 0 && (
        // dynamic: one lane-row per bar lane this week carries
        <div style={{ height: `calc(var(--spacing-lane-row) * ${week.barLaneCount})` }} />
      )}

      {/* Chips. Past/outside days dull their chips as one group rather than
          each chip computing its own dim — the wrapper isn't absolutely
          positioned, so opacity here doesn't disturb the overlay layers
          (BarsOverlay/PeriodCorners) painted outside it. */}
      <div className={cn('flex flex-col overflow-hidden', v.chips, dim && 'opacity-50')}>
        {cell.shownOccs.map(chip)}
        {cell.hiddenCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowDay(cell.dateStr);
            }}
            className={cn('cursor-pointer text-left text-xs text-ink-muted hover:text-ink hover:underline', v.morePad)}
          >
            {v.more(cell.hiddenCount)}
          </button>
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

/** Half-border brackets marking the start/end days of a week-plus span, drawn in its colour via `border-current`. */
export function PeriodCorners({ cell }: { cell: DayCell }) {
  const { colorOf } = useApp();
  return (
    <>
      {cell.longStarts.map((o) => (
        <span key={`s-${o.key}`} className={cn('pointer-events-none', COLOR_CLASSES[colorOf(o.seed)].text)}>
          <span className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-current" />
          <span className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-current" />
        </span>
      ))}
      {cell.longEnds.map((o) => (
        <span key={`e-${o.key}`} className={cn('pointer-events-none', COLOR_CLASSES[colorOf(o.seed)].text)}>
          <span className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-current" />
          <span className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-current" />
        </span>
      ))}
    </>
  );
}

/** The span's name, shown once on its start day. */
export function PeriodTitles({ cell, onEdit }: { cell: DayCell; onEdit: (o: Occurrence) => void }) {
  const { colorOf } = useApp();
  // Multiplied rather than a separate `opacity-50` class: an inline `style`
  // always wins over a class, so a shared seed's own opacity would silently
  // swallow the dim.
  const dimFactor = dimCell(cell) ? 0.5 : 1;
  return (
    <>
      {cell.longStarts.map((o) => (
        <div
          key={`t-${o.key}`}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(o);
          }}
          title={sharedTitleAttr(o.seed)}
          className={cn(
            'text-xs font-bold uppercase tracking-wide overflow-hidden whitespace-nowrap hover:opacity-70 hover:shadow-pop',
            COLOR_CLASSES[colorOf(o.seed)].text,
          )}
          // dynamic: dimmed when shared or elapsed
          style={{ opacity: (sharedOpacity(o.seed) ?? 1) * dimFactor }}
        >
          {seedTitle(o.seed)}
        </div>
      ))}
    </>
  );
}

/**
 * All-day/multi-day bars, absolutely positioned over the week's cells.
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
  onEdit,
}: {
  week: WeekRow;
  /** A `top-*` utility clearing the layout's day-number row. */
  topClass: string;
  onEdit: (o: Occurrence) => void;
}) {
  const { colorOf } = useApp();
  if (week.barLanes.length === 0) return null;
  return (
    <div className={`absolute left-0 right-0 grid grid-cols-7 auto-rows-min pointer-events-none ${topClass}`}>
      {week.barLanes.map(({ seg, lane }) => {
        // Multiplied, not a separate `opacity-50` class — an inline `style`
        // always wins over a class, so a shared seed's own opacity would
        // silently swallow the dim.
        const dimFactor = week.days.slice(seg.startCol - 1, seg.startCol - 1 + seg.span).every(dimCell) ? 0.5 : 1;
        return (
          <div
            key={seg.item.key}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(seg.item);
            }}
            title={sharedTitleAttr(seg.item.seed)}
            className={cn(
              'pointer-events-auto cursor-pointer text-xs font-bold px-xs overflow-hidden whitespace-nowrap hover:opacity-90 hover:shadow-pop h-lane-h leading-(--spacing-lane-h) mb-0.5 text-on-accent',
              COLOR_CLASSES[colorOf(seg.item.seed)].bg,
              seg.startsHere && 'ml-1',
              seg.endsHere && 'mr-1',
            )}
            // dynamic: grid placement, dimmed when shared or elapsed
            style={{
              gridColumn: `${seg.startCol} / span ${seg.span}`,
              gridRow: lane + 1,
              opacity: (sharedOpacity(seg.item.seed) ?? 1) * dimFactor,
            }}
          >
            {seg.startsHere ? seedTitle(seg.item.seed) : '…'}
          </div>
        );
      })}
    </div>
  );
}
