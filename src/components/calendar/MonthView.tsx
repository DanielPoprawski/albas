import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import AddModal from '../AddModal';
import MonthViewDesktop, { PILL_CAP as DESKTOP_PILL_CAP } from './MonthViewDesktop';
import MonthViewMobile, { MIN_WEEKS as MOBILE_MIN_WEEKS, PILL_CAP as MOBILE_PILL_CAP } from './MonthViewMobile';
import { useMonthModel } from './monthModel';
import type { Occurrence } from '../../eventLogic';
import type { CalendarEvent, Todo } from '../../types';

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
  const { setSelectedDate } = useApp();
  const [editEvent, setEditEvent] = useState<{ event: CalendarEvent; date: string } | null>(null);
  const [editTodo, setEditTodo] = useState<Todo | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);

  const weeks = useMonthModel(
    isMobile ? { pillCap: MOBILE_PILL_CAP, minWeeks: MOBILE_MIN_WEEKS } : { pillCap: DESKTOP_PILL_CAP },
  );

  const layoutProps = {
    weeks,
    // Shared events are read-only: clicking one opens nothing.
    onEditEvent: (o: Occurrence) => {
      if (o.event.sharedBy) return;
      setEditEvent({ event: o.event, date: o.startDate });
    },
    onEditTodo: setEditTodo,
    // Clicking a day adds to it, on every device — the phone's day view is a
    // mode in the nav picker, not a tap away from the grid.
    onDayClick: (dateStr: string) => {
      setSelectedDate(dateStr);
      setAddDate(dateStr);
    },
  };

  return (
    <>
      {isMobile ? <MonthViewMobile {...layoutProps} /> : <MonthViewDesktop {...layoutProps} />}

      {editEvent && (
        <AddModal editEvent={editEvent.event} editEventDate={editEvent.date} onClose={() => setEditEvent(null)} />
      )}
      {editTodo && <AddModal editTodo={editTodo} onClose={() => setEditTodo(null)} />}
      {addDate && <AddModal defaultDate={addDate} defaultType="event" onClose={() => setAddDate(null)} />}
    </>
  );
}
