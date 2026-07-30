import { useApp } from '../../context/AppContext';
import { addDays, fmt, parse } from '../../dates';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { CalendarMode } from '../../types';

const MODES: { value: CalendarMode; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

/**
 * Mode picker + Today, collapsed into one button so the header costs a single
 * row. Radix owns the open state, focus trap, Escape and outside-click; what
 * used to be a hand-rolled scrim plus a keydown listener is now just markup.
 */
function ViewMenu({ mode, onPick, onToday, compact }: {
  mode: CalendarMode;
  onPick: (mode: CalendarMode) => void;
  onToday: () => void;
  compact: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`flex items-center gap-0.5 py-xs rounded font-semibold text-label-md text-txt hover:bg-fill-stronger transition-colors outline-none ${
          compact ? 'pl-xs pr-0' : 'pl-sm pr-xs'
        }`}
      >
        {MODES.find(m => m.value === mode)!.label}
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
          arrow_drop_down
        </span>
      </DropdownMenuTrigger>

      {/* on mobile the nav sits at the right edge of the top bar, so the menu
          hangs from that edge instead of running off screen */}
      <DropdownMenuContent align={compact ? 'end' : 'start'} className="min-w-[9rem]">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={v => onPick(v as CalendarMode)}
        >
          {MODES.map(({ value, label }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className="text-body-sm data-[state=checked]:text-primary data-[state=checked]:font-semibold"
            >
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {/* not part of the radio group: Today is an action, not a mode */}
        <DropdownMenuItem onSelect={onToday} className="text-body-sm pl-8">
          Today
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Prev / view menu / next. On desktop it's a row of its own above the grid; on
 * mobile it rides in `TopBar` beside the title, which is the same period,
 * week or day the arrows step — and gives the grid that row's height back.
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
  const arrowSize = compact ? '20px' : undefined;

  const arrow = (dir: 1 | -1) => (
    <button
      onClick={() => step(dir)}
      aria-label={dir === 1 ? 'Next' : 'Previous'}
      className={arrowClass}
    >
      <span className="material-symbols-outlined" style={{ fontSize: arrowSize }}>
        {dir === 1 ? 'chevron_right' : 'chevron_left'}
      </span>
    </button>
  );

  const menu = (
    <ViewMenu mode={calendarMode} onPick={switchMode} onToday={goToday} compact={compact} />
  );

  // Compact splits the two: the arrows step whatever the title says, so they
  // read as part of it, and the mode button becomes its own control.
  if (compact) {
    return (
      <div className="flex items-center gap-xs">
        <div className="flex items-center bg-fill-strong rounded-lg p-0.5">
          {arrow(-1)}
          {arrow(1)}
        </div>
        <div className="flex items-center bg-fill-strong rounded-lg px-0.5">{menu}</div>
      </div>
    );
  }

  return (
    <div className="flex items-center bg-fill-strong rounded-lg p-xs">
      {arrow(-1)}
      {menu}
      {arrow(1)}
    </div>
  );
}
