import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { addDays, fmt, parse } from '../dates';
import MonthView from './calendar/MonthView';
import WeekView from './calendar/WeekView';
import DayView from './calendar/DayView';
import type { CalendarMode } from '../types';

const MODES: { value: CalendarMode; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

/**
 * Mode picker + Today, collapsed into one button so the header costs a single
 * row. Follows the hand-rolled overlay shape used by `EventForm`'s colour
 * picker rather than introducing a second popover pattern.
 */
function ViewMenu({ mode, onPick, onToday }: {
  mode: CalendarMode;
  onPick: (mode: CalendarMode) => void;
  onToday: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const itemClass =
    'w-full text-left px-sm py-xs text-body-sm rounded transition-colors hover:bg-fill-strong';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-0.5 pl-sm pr-xs py-xs rounded font-semibold text-label-md text-txt hover:bg-fill-stronger transition-colors"
      >
        {MODES.find(m => m.value === mode)!.label}
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
          arrow_drop_down
        </span>
      </button>

      {open && (
        <>
          {/* click-anywhere-else scrim */}
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute left-0 top-full mt-xs z-[61] min-w-[9rem] rounded-lg border border-line bg-elevated shadow-2xl p-xs"
          >
            {MODES.map(({ value, label }) => (
              <button
                key={value}
                role="menuitem"
                onClick={() => { onPick(value); setOpen(false); }}
                className={`${itemClass} ${
                  mode === value ? 'text-primary font-semibold' : 'text-txt'
                }`}
              >
                {label}
              </button>
            ))}
            <div className="h-px bg-fill-strong my-xs" />
            <button
              role="menuitem"
              onClick={() => { onToday(); setOpen(false); }}
              className={`${itemClass} text-txt`}
            >
              Today
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Calendar({ isMobile = false }: { isMobile?: boolean }) {
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* The title now lives in the top bar; this row is navigation only.
          On mobile it keeps its own padding so the grid below can go
          edge-to-edge. */}
      <div className={`flex items-center mb-sm flex-shrink-0 ${isMobile ? 'px-sm' : 'mb-md'}`}>
        <div className="flex items-center bg-fill-strong rounded-lg p-xs">
          <button
            onClick={() => step(-1)}
            aria-label="Previous"
            className="p-xs hover:bg-fill-stronger rounded transition-colors text-txt-muted hover:text-txt"
          >
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <ViewMenu mode={calendarMode} onPick={switchMode} onToday={goToday} />
          <button
            onClick={() => step(1)}
            aria-label="Next"
            className="p-xs hover:bg-fill-stronger rounded transition-colors text-txt-muted hover:text-txt"
          >
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
      </div>

      {calendarMode === 'month' && <MonthView isMobile={isMobile} />}
      {calendarMode === 'week' && <WeekView />}
      {calendarMode === 'day' && <DayView />}
    </div>
  );
}
