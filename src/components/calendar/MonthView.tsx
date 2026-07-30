import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import AddModal from '../AddModal';
import MonthViewDesktop, { PILL_CAP as DESKTOP_PILL_CAP } from './MonthViewDesktop';
import MonthViewMobile, { MIN_WEEKS as MOBILE_MIN_WEEKS, PILL_CAP as MOBILE_PILL_CAP } from './MonthViewMobile';
import { useMonthModel } from './monthModel';
import type { Occurrence } from '../../eventLogic';
import type { CalendarEvent, Todo } from '../../types';

export { getCalendarDays } from './monthModel';

/**
 * Month grid shell: derives the model, owns the edit/add modals, and hands the
 * rest to a layout. The two layouts diverge enough in density and interaction
 * that branching inside one component was the bulk of its complexity — but they
 * share every derived value, so the split is presentational only.
 */
export default function MonthView({ isMobile = false }: { isMobile?: boolean }) {
  const { setSelectedDate, setCalendarMode } = useApp();
  const [editEvent, setEditEvent] = useState<{ event: CalendarEvent; date: string } | null>(null);
  const [editTodo, setEditTodo] = useState<Todo | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);

  const weeks = useMonthModel(
    isMobile ? MOBILE_PILL_CAP : DESKTOP_PILL_CAP,
    isMobile ? MOBILE_MIN_WEEKS : 0,
  );

  const layoutProps = {
    weeks,
    onEditEvent: (o: Occurrence) => setEditEvent({ event: o.event, date: o.startDate }),
    onEditTodo: setEditTodo,
    // A phone tile is too small to be a useful agenda, so tapping drills into
    // that day. Desktop has the room, so clicking goes straight to "add here".
    onDayClick: (dateStr: string) => {
      setSelectedDate(dateStr);
      if (isMobile) setCalendarMode('day');
      else setAddDate(dateStr);
    },
  };

  return (
    <>
      {isMobile ? <MonthViewMobile {...layoutProps} /> : <MonthViewDesktop {...layoutProps} />}

      {editEvent && <AddModal editEvent={editEvent.event} editEventDate={editEvent.date} onClose={() => setEditEvent(null)} />}
      {editTodo && <AddModal editTodo={editTodo} onClose={() => setEditTodo(null)} />}
      {addDate && <AddModal defaultDate={addDate} defaultType="event" onClose={() => setAddDate(null)} />}
    </>
  );
}
