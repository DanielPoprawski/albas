import { useState } from 'react';
import { cn } from '@/lib/utils';
import { CalendarDays, CalendarRange, CalendarClock, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import { goToday as navToday, stepPeriod, syncMonth } from '../../calendarNav';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { IconButton } from '../ui/button';
import type { CalendarMode } from '../../types';

const MODES: { value: CalendarMode; label: string; Icon: LucideIcon; hint: string }[] = [
  { value: 'month', label: 'Month', Icon: CalendarDays, hint: 'The whole month at a glance' },
  { value: 'week', label: 'Week', Icon: CalendarRange, hint: 'Seven days, hour by hour' },
  { value: 'day', label: 'Day', Icon: CalendarClock, hint: 'One day, hour by hour' },
];

/**
 * Desktop mode switch: three buttons, not a dropdown. All three modes are
 * top-level destinations used constantly, and a menu hid two of them behind a
 * click plus a read. Today sits beside them as what it is — an action, not a
 * fourth mode.
 */
function ModeButtons({
  mode,
  onPick,
  onToday,
}: {
  mode: CalendarMode;
  onPick: (mode: CalendarMode) => void;
  onToday: () => void;
}) {
  return (
    <div className="flex items-center gap-xs">
      <div className="flex items-center bg-subtle-strong p-xs gap-0.5">
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onPick(value)}
            aria-pressed={mode === value}
            className={`px-md py-xs font-semibold text-meta transition-colors ${
              mode === value ? 'bg-accent text-on-accent' : 'text-ink-muted hover:text-ink hover:bg-line-strong'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        onClick={onToday}
        className="px-md py-xs font-semibold text-meta text-ink-muted bg-subtle-strong hover:text-ink hover:bg-line-strong transition-colors"
      >
        Today
      </button>
    </div>
  );
}

/**
 * Phone mode switch: a calendar button that opens a modal. Exported so the
 * phone's top bar (`HomeView`'s `MobileShell`) can put it in its top-left
 * corner, beside the date, instead of on a row of its own above the grid. The dropdown it
 * replaces anchored to the right edge of a cramped top bar; a modal has room
 * for a legible row per mode, and is a bigger tap target on the way in.
 *
 * Today lives here too — it's the only way back on a phone now that the arrows
 * are gone.
 */
export function ModeModal({
  mode,
  onPick,
  onToday,
}: {
  mode: CalendarMode;
  onPick: (mode: CalendarMode) => void;
  onToday: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Current = MODES.find((m) => m.value === mode)!.Icon;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Calendar view: ${mode}`}
        title="Calendar view"
        className={cn(
          // Matches `HomeView`'s Settings button so the phone header's two corners agree.
          'flex size-8 shrink-0 cursor-pointer items-center justify-center border-0 bg-subtle p-0 text-ink transition-all active:bg-line',
          'text-ink-muted hover:text-ink active:scale-95',
        )}
      >
        <Current size="1rem" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-[min(22rem,calc(100%-2rem))]">
          <DialogTitle className="text-h1">View</DialogTitle>

          <div className="space-y-xs">
            {MODES.map(({ value, label, Icon, hint }) => (
              <button
                key={value}
                onClick={() => {
                  onPick(value);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-sm p-sm border text-left transition-colors ${
                  mode === value ? 'border-accent bg-subtle-strong' : 'border-line hover:bg-subtle-strong'
                }`}
              >
                <Icon size="1.25rem" className={mode === value ? 'text-accent' : 'text-ink-muted'} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{label}</span>
                  <span className="block text-xs text-ink-muted">{hint}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              onToday();
              setOpen(false);
            }}
            className="mt-md w-full px-md py-sm bg-accent text-on-accent font-semibold text-sm active:scale-95 transition-transform"
          >
            Jump to today
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The calendar's own navigation. On desktop it's a row of its own above the
 * grid; on mobile (`compact`) it rides in the top bar's left corner beside
 * the date, which is the same period it steps.
 *
 * The phone drops the prev/next arrows in month view — the grid is swipeable,
 * so the arrows were a second control for a gesture that's already there, on
 * the one row where space is tightest. Week and day view keep them, because
 * neither is swipeable.
 */
export default function CalendarNav({ compact = false }: { compact?: boolean }) {
  const { setCurrentMonth, selectedDate, setSelectedDate, calendarMode, setCalendarMode } = useApp();

  const todayStr = fmt(new Date());
  // week/day navigation anchors on the selected date
  const anchor = selectedDate ?? todayStr;

  const nav = { setCurrentMonth, setSelectedDate };

  function step(dir: 1 | -1) {
    stepPeriod(nav, calendarMode, anchor, dir);
  }

  function goToday() {
    navToday(nav);
  }

  function switchMode(mode: CalendarMode) {
    setCalendarMode(mode);
    if (mode !== 'month') syncMonth(nav, anchor);
  }

  // compact trades icon size for tap area — 1.25rem glyphs, but the button still
  // carries padding so the target isn't a 1.25rem square on a touchscreen
  const arrow = (dir: 1 | -1) => {
    const Icon = dir === 1 ? ChevronRight : ChevronLeft;
    return (
      <IconButton
        variant="accent2"
        onClick={() => step(dir)}
        aria-label={dir === 1 ? 'Next' : 'Previous'}
        className={compact ? 'size-auto p-xs' : undefined}
      >
        <Icon size={compact ? '1.25rem' : '1.125rem'} />
      </IconButton>
    );
  };

  if (compact) {
    return (
      <div className="flex items-center gap-xs">
        <ModeModal mode={calendarMode} onPick={switchMode} onToday={goToday} />
        {calendarMode !== 'month' && (
          <div className="flex items-center bg-subtle-strong p-0.5">
            {arrow(-1)}
            {arrow(1)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-sm">
      <div className="flex items-center bg-subtle-strong p-xs">
        {arrow(-1)}
        {arrow(1)}
      </div>
      <ModeButtons mode={calendarMode} onPick={switchMode} onToday={goToday} />
    </div>
  );
}
