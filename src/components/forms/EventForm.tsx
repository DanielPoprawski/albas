import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DEFAULT_COLOR } from '../../colors';
import { addDays, diffDays, fmt, shortDate } from '../../dates';
import type { CalendarEvent, Recurrence } from '../../types';
import { CheckboxRow, ColorPicker, EditActions, inputClass, labelClass, SegmentedControl, SubmitButton } from './shared';
import RemindersField from './RemindersField';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';

type RecType = Recurrence['type'];

/** Now, rounded *down* to a quarter hour — the start you'd have typed anyway. */
function nowFloor15(): string {
  const d = new Date();
  d.setMinutes(Math.floor(d.getMinutes() / 15), 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `hh:mm` plus N minutes, clamped to 23:59 so an evening start can't wrap. */
function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function EventForm({ edit, occurrenceDate, defaultDate, onDone }: {
  edit?: CalendarEvent;
  /** Start date of the specific occurrence being edited (for "just this event" deletes). */
  occurrenceDate?: string | null;
  defaultDate?: string | null;
  onDone: () => void;
}) {
  const { addEvent, updateEvent, deleteEvent, selectedDate } = useApp();
  const initialDate = edit?.startDate ?? defaultDate ?? selectedDate ?? fmt(new Date());
  // A new event defaults to "now for an hour": today, the current quarter hour,
  // ending sixty minutes later. Nearly every event is entered near its own time,
  // so that's fewer fields to touch than a fixed 09:00.
  const initialStartTime = edit?.startTime ?? nowFloor15();

  const [title, setTitle] = useState(edit?.title ?? '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [color, setColor] = useState(edit?.colorKey ?? DEFAULT_COLOR);
  const [allDay, setAllDay] = useState(edit?.allDay ?? false);
  const [startDate, setStartDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endDate, setEndDate] = useState(edit?.endDate ?? initialDate);
  const [endTime, setEndTime] = useState(edit?.endTime ?? addMinutes(initialStartTime, 60));
  const [recType, setRecType] = useState<RecType>(edit?.recurrence.type ?? 'none');
  const [interval, setInterval_] = useState(
    edit && edit.recurrence.type !== 'none' ? String(edit.recurrence.interval) : '1'
  );
  const [until, setUntil] = useState(
    edit && edit.recurrence.type !== 'none' ? edit.recurrence.until ?? '' : ''
  );
  const [reminders, setReminders] = useState<number[]>(edit?.reminders ?? []);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Moving the start drags the end with it, keeping the gap — otherwise
  // rescheduling a meeting means editing both dates by hand.
  function changeStartDate(next: string) {
    if (next && startDate && endDate) {
      const shift = diffDays(startDate, next);
      if (shift !== 0) setEndDate(addDays(endDate, shift));
    }
    setStartDate(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startDate) return;

    const effEndDate = endDate || startDate;
    if (effEndDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    const effEndTime = allDay ? null : endTime || null;
    if (!allDay && effEndDate === startDate && endTime && endTime <= startTime) {
      setError('End time must be after the start time.');
      return;
    }

    const n = parseInt(interval, 10);
    // individually-deleted occurrences survive edits to the rest of the series
    const prevExdates = edit && edit.recurrence.type !== 'none' ? edit.recurrence.exdates : undefined;
    const recurrence: Recurrence =
      recType === 'none'
        ? { type: 'none' }
        : {
            type: recType,
            interval: Number.isFinite(n) && n > 0 ? n : 1,
            until: until || null,
            ...(prevExdates?.length ? { exdates: prevExdates } : {}),
          };
    const fields = {
      title: title.trim(),
      description: description.trim(),
      colorKey: color,
      allDay,
      startDate,
      startTime: allDay ? null : startTime,
      endDate: effEndDate,
      endTime: allDay ? null : effEndTime,
      recurrence,
      reminders,
    };
    if (edit) updateEvent(edit.id, fields);
    else addEvent(fields);
    onDone();
  }

  // Recurring events get a chooser; one-offs delete immediately.
  function handleDelete() {
    if (!edit) return;
    if (edit.recurrence.type === 'none') {
      deleteEvent(edit.id);
      onDone();
    } else {
      setConfirmDelete(true);
    }
  }

  function deleteJustThis() {
    if (!edit || edit.recurrence.type === 'none' || !occurrenceDate) return;
    const rec = edit.recurrence;
    updateEvent(edit.id, {
      recurrence: { ...rec, exdates: [...(rec.exdates ?? []), occurrenceDate] },
    });
    onDone();
  }

  function deleteFuture() {
    if (!edit || edit.recurrence.type === 'none' || !occurrenceDate) return;
    const newUntil = addDays(occurrenceDate, -1);
    if (newUntil < edit.startDate) {
      deleteEvent(edit.id); // cutting off before the first occurrence = delete all
    } else {
      updateEvent(edit.id, { recurrence: { ...edit.recurrence, until: newUntil } });
    }
    onDone();
  }

  function deleteAll() {
    if (!edit) return;
    deleteEvent(edit.id);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-md">
      <div>
        <label className={labelClass}>Title</label>
        <input
          className={inputClass}
          placeholder="e.g. Team sync, Dentist, 12-week program"
          value={title}
          onChange={e => setTitle(e.target.value)}
          autoFocus
        />
      </div>

      <div>
        <label className={labelClass}>Color</label>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      {/*
        Three rows: the all-day switch, then start and end, each as date on the
        left and time on the right. The old version had a "how does this end?"
        dropdown that you had to answer before you could type an end at all;
        every event has an end, so it just shows one. Checking all-day drops the
        whole time column rather than disabling it.
      */}
      <div className="space-y-sm">
        <CheckboxRow checked={allDay} onChange={setAllDay} label="All-day" />

        <div className="flex gap-sm">
          <div className="flex-1 min-w-0">
            <label className={labelClass}>Starts</label>
            <input
              type="date"
              className={inputClass}
              value={startDate}
              onChange={e => changeStartDate(e.target.value)}
            />
          </div>
          {!allDay && (
            <div className="w-32 flex-shrink-0">
              <label className={labelClass}>Time</label>
              <input
                type="time"
                className={inputClass}
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex gap-sm">
          <div className="flex-1 min-w-0">
            <label className={labelClass}>Ends</label>
            <input
              type="date"
              className={inputClass}
              value={endDate}
              min={startDate || undefined}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
          {!allDay && (
            <div className="w-32 flex-shrink-0">
              <label className={labelClass}>Time</label>
              <input
                type="time"
                className={inputClass}
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      <div>
        <label className={labelClass}>Repeats</label>
        <SegmentedControl
          options={[
            { value: 'none', label: 'Never' },
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
          ]}
          value={recType}
          onChange={setRecType}
        />
        {recType !== 'none' && (
          <div className="flex items-center gap-sm mt-sm flex-wrap">
            <span className="text-body-sm text-txt-muted">Every</span>
            <input
              type="number"
              min="1"
              className={`${inputClass} text-center`}
              value={interval}
              onChange={e => setInterval_(e.target.value)}
              style={{ width: '4rem' }}
            />
            <span className="text-body-sm text-txt-muted">
              {recType === 'daily' ? 'day(s)' : recType === 'weekly' ? 'week(s)' : 'month(s)'}
            </span>
            <span className="text-body-sm text-txt-muted ml-sm">until</span>
            <input
              type="date"
              className={inputClass}
              value={until}
              onChange={e => setUntil(e.target.value)}
              style={{ width: '10rem' }}
            />
          </div>
        )}
      </div>

      <RemindersField value={reminders} onChange={setReminders} />

      <div>
        <label className={labelClass}>Description (optional)</label>
        <textarea
          className={`${inputClass} resize-none`}
          rows={2}
          placeholder="Details, location, links…"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      {error && <p className="text-body-sm text-danger">{error}</p>}

      {edit ? (
        <EditActions saveLabel="Save Changes" onDelete={handleDelete} />
      ) : (
        <SubmitButton label="Add Event" />
      )}

      {/* Nested inside the AddModal dialog. Radix stacks them: Escape closes
          only this one, and focus is trapped here until it goes away. */}
      {edit && (
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent
            showCloseButton={false}
            className="block rounded-2xl p-md w-full max-w-[min(20rem,calc(100%-2rem))] shadow-2xl border-line"
          >
            <DialogTitle className="text-body-md font-bold text-txt mb-xs">
              Delete recurring event
            </DialogTitle>
            <DialogDescription className="text-body-sm text-txt-muted mb-md">
              “{edit.title}” repeats. What should be deleted?
            </DialogDescription>
            <div className="space-y-xs">
              {occurrenceDate && (
                <>
                  <button
                    type="button"
                    onClick={deleteJustThis}
                    className="w-full py-sm px-sm rounded-lg text-left text-body-sm font-medium text-txt bg-fill hover:bg-fill-strong transition-colors"
                  >
                    Just this event
                    <span className="text-txt-muted"> · {shortDate(occurrenceDate)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={deleteFuture}
                    className="w-full py-sm px-sm rounded-lg text-left text-body-sm font-medium text-txt bg-fill hover:bg-fill-strong transition-colors"
                  >
                    This and all future events
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={deleteAll}
                className="w-full py-sm px-sm rounded-lg text-left text-body-sm font-medium text-danger bg-fill hover:bg-tertiary-container/20 transition-colors"
              >
                All events
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="w-full py-sm px-sm rounded-lg text-center text-body-sm text-txt-muted hover:bg-fill transition-colors"
              >
                Cancel
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </form>
  );
}
