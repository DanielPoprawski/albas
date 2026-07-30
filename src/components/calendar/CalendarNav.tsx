import { useState } from 'react';
import { CalendarDays, CalendarRange, CalendarClock, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { addDays, fmt, parse } from '../../dates';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
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
function ModeButtons({ mode, onPick, onToday }: {
  mode: CalendarMode;
  onPick: (mode: CalendarMode) => void;
  onToday: () => void;
}) {
  return (
    <div className="flex items-center gap-xs">
      <div className="flex items-center bg-fill-strong rounded-lg p-xs gap-0.5">
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onPick(value)}
            aria-pressed={mode === value}
            className={`px-md py-xs rounded font-semibold text-label-md transition-colors ${
              mode === value
                ? 'bg-primary text-on-primary'
                : 'text-txt-muted hover:text-txt hover:bg-fill-stronger'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        onClick={onToday}
        className="px-md py-xs rounded-lg font-semibold text-label-md text-txt-muted bg-fill-strong hover:text-txt hover:bg-fill-stronger transition-colors"
      >
        Today
      </button>
    </div>
  );
}

/**
 * Phone mode switch: a calendar button that opens a modal. The dropdown it
 * replaces anchored to the right edge of a cramped top bar; a modal has room
 * for a legible row per mode, and is a bigger tap target on the way in.
 *
 * Today lives here too — it's the only way back on a phone now that the arrows
 * are gone.
 */
function ModeModal({ mode, onPick, onToday }: {
  mode: CalendarMode;
  onPick: (mode: CalendarMode) => void;
  onToday: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Current = MODES.find(m => m.value === mode)!.Icon;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Calendar view: ${mode}`}
        className="w-10 h-10 flex items-center justify-center rounded-lg bg-fill-strong text-txt-muted hover:text-txt active:scale-95 transition-all"
      >
        <Current size={20} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="block rounded-2xl p-md w-full max-w-[min(22rem,calc(100%-2rem))] border-line shadow-2xl"
        >
          <DialogTitle className="text-headline-lg-mobile font-title font-normal text-txt mb-md">
            View
          </DialogTitle>

          <div className="space-y-xs">
            {MODES.map(({ value, label, Icon, hint }) => (
              <button
                key={value}
                onClick={() => { onPick(value); setOpen(false); }}
                className={`w-full flex items-center gap-sm p-sm rounded-lg border text-left transition-colors ${
                  mode === value
                    ? 'border-primary bg-fill-strong'
                    : 'border-line hover:bg-fill-strong'
                }`}
              >
                <Icon size={20} className={mode === value ? 'text-primary' : 'text-txt-muted'} />
                <span className="min-w-0">
                  <span className="block text-body-sm font-semibold text-txt">{label}</span>
                  <span className="block text-[11px] text-txt-muted">{hint}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => { onToday(); setOpen(false); }}
            className="mt-md w-full px-md py-sm bg-primary text-on-primary rounded-lg font-semibold text-body-sm active:scale-95 transition-transform"
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
 * grid; on mobile it rides in `TopBar` beside the title, which is the same
 * period it steps.
 *
 * The phone drops the prev/next arrows in month view — the grid is swipeable,
 * so the arrows were a second control for a gesture that's already there, on
 * the one row where space is tightest. Week and day view keep them, because
 * neither is swipeable.
 */
export default function CalendarNav({ compact = false }: { compact?: boolean }) {
  const {
    setCurrentMonth,
    selectedDate, setSelectedDate,
    calendarMode, setCalendarMode,
  } = useApp();

  const todayStr = fmt(new Date());
  // week/day navigation anchors on the selected date
  const anchor = selectedDate ?? todayStr;

  function syncMonth(dateStr: string) {
    const d = parse(dateStr);
    setCurrentMonth(m =>
      m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth()
        ? m
        : new Date(d.getFullYear(), d.getMonth(), 1)
    );
  }

  function step(dir: 1 | -1) {
    if (calendarMode === 'month') {
      setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + dir, 1));
      return;
    }
    const next = addDays(anchor, dir * (calendarMode === 'week' ? 7 : 1));
    setSelectedDate(next);
    syncMonth(next);
  }

  function goToday() {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(todayStr);
  }

  function switchMode(mode: CalendarMode) {
    setCalendarMode(mode);
    if (mode !== 'month') syncMonth(anchor);
  }

  // compact trades icon size for tap area — 20px glyphs, but the button still
  // carries padding so the target isn't a 20px square on a touchscreen
  const arrowClass =
    'p-xs hover:bg-fill-stronger rounded transition-colors text-txt-muted hover:text-txt';

  const arrow = (dir: 1 | -1) => {
    const Icon = dir === 1 ? ChevronRight : ChevronLeft;
    return (
      <button
        onClick={() => step(dir)}
        aria-label={dir === 1 ? 'Next' : 'Previous'}
        className={arrowClass}
      >
        <Icon size={compact ? 20 : 18} />
      </button>
    );
  };

  if (compact) {
    return (
      <div className="flex items-center gap-xs">
        {calendarMode !== 'month' && (
          <div className="flex items-center bg-fill-strong rounded-lg p-0.5">
            {arrow(-1)}
            {arrow(1)}
          </div>
        )}
        <ModeModal mode={calendarMode} onPick={switchMode} onToday={goToday} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-sm">
      <div className="flex items-center bg-fill-strong rounded-lg p-xs">
        {arrow(-1)}
        {arrow(1)}
      </div>
      <ModeButtons mode={calendarMode} onPick={switchMode} onToday={goToday} />
    </div>
  );
}
