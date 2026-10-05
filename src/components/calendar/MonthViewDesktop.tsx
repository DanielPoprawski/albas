import { goToday, isThisMonth, stepMonth } from '../../calendarNav';
import { useApp } from '../../context/AppContext';
import { rotateWeek, weekdayAt } from '../../dates';
import { SearchPalette } from '../search/SearchPalette';
import { Button, IconButton } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { MonthYearPopover } from './MonthYearPopover';
import type { MonthLayoutProps } from './monthModel';
import { BarsOverlay, MonthCell } from './monthParts';

// Sunday-first to match getDay(); rotated into display order via rotateWeek
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A desktop cell has room for two chips and a bottom-pinned stack. */
export const PILL_CAP = 2;

export function MonthViewDesktop({ weeks, onEdit, onToggle, onDayClick, onShowDay }: MonthLayoutProps) {
  const { firstDayOfWeek, currentMonth, setCurrentMonth, setSelectedDate, showRightPanel, toggleRightPanel } = useApp();

  const nav = { setCurrentMonth, setSelectedDate };

  return (
    // Fills whatever the sidebars leave, so the cells take the window's shape.
    <Card className="flex-1 min-h-0 overflow-hidden flex flex-col">
      {/* Calendar header: Today + month navigation on the left, search
          centred (adding is a click on a day — the "+ Add" button that used
          to sit here duplicated that). The third column toggles the companion panel
          so the search stays centred on the sheet. */}
      <div className="grid grid-cols-[auto_minmax(12.5rem,1fr)_auto] items-center gap-4 px-4 py-3 border-b border-line flex-shrink-0 bg-surface">
        <div className="flex items-center gap-xs">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={isThisMonth(currentMonth)}
            onClick={() => goToday(nav)}
          >
            Today
          </Button>
          <IconButton variant="accent2" aria-label="Previous month" onClick={() => stepMonth(nav, -1)}>
            <Icon name="chevron_left" size="0.875rem" />
          </IconButton>
          <MonthYearPopover month={currentMonth} onPick={setCurrentMonth} />
          <IconButton variant="accent2" aria-label="Next month" onClick={() => stepMonth(nav, 1)}>
            <Icon name="chevron_right" size="0.875rem" />
          </IconButton>
        </div>

        <SearchPalette scope="calendar" className="w-full max-w-[35rem] justify-self-center" />

        <div className="flex items-center justify-end min-w-[4.5rem]">
          <IconButton
            variant="accent2"
            aria-label={showRightPanel ? 'Hide side panel' : 'Show side panel'}
            title={showRightPanel ? 'Hide side panel' : 'Show side panel'}
            onClick={toggleRightPanel}
          >
            <Icon name={showRightPanel ? 'right_panel_close' : 'right_panel_open'} size="0.875rem" />
          </IconButton>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b flex-shrink-0 border-line bg-subtle">
        {rotateWeek(WEEKDAYS, firstDayOfWeek).map((day, i) => {
          // weekend follows the actual weekday, not the column index — under a
          // Sunday start, columns 5 and 6 are Friday and Saturday
          const dayNum = weekdayAt(i, firstDayOfWeek);
          const isWeekendCol = dayNum === 0 || dayNum === 6;
          return (
            <div
              key={i}
              className={`py-xs px-1.5 text-center text-xs font-bold uppercase tracking-wider ${
                isWeekendCol ? 'text-ink' : 'text-ink-muted'
              }`}
            >
              {day}
            </div>
          );
        })}
      </div>

      {/* Week rows */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-hide">
        {weeks.map((week) => (
          <div key={week.key} className="flex-1 relative min-h-[5.75rem]">
            {/* Day cells */}
            <div className="grid grid-cols-7 h-full">
              {week.days.map((cell, colIdx) => (
                <MonthCell
                  key={cell.dateStr}
                  cell={cell}
                  week={week}
                  variant="desktop"
                  className={colIdx === 6 ? 'border-b border-line' : 'border-r border-b border-line'}
                  onDayClick={onDayClick}
                  onShowDay={onShowDay}
                  onEdit={onEdit}
                  onToggle={onToggle}
                />
              ))}
            </div>

            <BarsOverlay week={week} variant="desktop" onEdit={onEdit} />
          </div>
        ))}
      </div>
    </Card>
  );
}
