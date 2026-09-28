import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import type { Occurrence } from '../../seedLogic';
import type { Seed } from '../../types';
import AddModal from '../AddModal';
import MonthViewDesktop, { PILL_CAP as DESKTOP_PILL_CAP } from './MonthViewDesktop';
import MonthViewMobile, { MIN_WEEKS as MOBILE_MIN_WEEKS, PILL_CAP as MOBILE_PILL_CAP } from './MonthViewMobile';
import { occToggleDate, useMonthModel } from './monthModel';

/**
 * Month grid shell: derives the model, owns the edit/add modals, and hands the
 * rest to a layout. The two layouts diverge enough in density and interaction
 * that branching inside one component was the bulk of its complexity — but they
 * share every derived value, so the split is presentational only.
 */
interface MonthViewProps {
  isMobile?: boolean;
}

export default function MonthView({ isMobile = false }: MonthViewProps) {
  const { setSelectedDate, setCalendarMode, toggleDone } = useApp();
  const [editing, setEditing] = useState<{ seed: Seed; date: string } | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);

  const weeks = useMonthModel(
    isMobile ? { pillCap: MOBILE_PILL_CAP, minWeeks: MOBILE_MIN_WEEKS } : { pillCap: DESKTOP_PILL_CAP },
  );

  const layoutProps = {
    weeks,
    // Shared seeds are read-only: clicking one opens nothing.
    onEdit: (o: Occurrence) => {
      if (o.seed.sharedBy) return;
      setEditing({ seed: o.seed, date: o.startDate });
    },
    onToggle: (o: Occurrence) => toggleDone(o.seed.id, occToggleDate(o, fmt(new Date()))),
    // Clicking a day adds to it, on every device — the phone's day view is a
    // mode in the nav picker, not a tap away from the grid. A cell names a day
    // and no hour, so it starts an all-day seed; the hour grids (WeekView,
    // DayView) start a timed one.
    onDayClick: (dateStr: string) => {
      setSelectedDate(dateStr);
      setAddDate(dateStr);
    },
    // "+N more": the day view is where the whole day fits.
    onShowDay: (dateStr: string) => {
      setSelectedDate(dateStr);
      setCalendarMode('day');
    },
  };

  return (
    <>
      {isMobile ? <MonthViewMobile {...layoutProps} /> : <MonthViewDesktop {...layoutProps} />}

      {editing && <AddModal edit={editing.seed} editDate={editing.date} onClose={() => setEditing(null)} />}
      {addDate && <AddModal defaultDate={addDate} defaultAllDay onClose={() => setAddDate(null)} />}
    </>
  );
}
