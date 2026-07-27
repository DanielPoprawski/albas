import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DEFAULT_COLOR } from '../../colors';
import { addDays, shortDate } from '../../dates';
import type { CalendarEvent, Recurrence } from '../../types';
import { CheckboxRow, ColorPicker, EditActions, inputClass, labelClass, SegmentedControl, Select, SubmitButton } from './shared';

type RecType = Recurrence['type'];

/** How the event ends: not at all (point/single day), later the same day, or on another day. */
type EndMode = 'none' | 'time' | 'date';

const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 10, label: '10 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 1440, label: '1 day' },
  { minutes: 10080, label: '1 week' },
];

function initialEndMode(edit?: CalendarEvent): EndMode {
  if (!edit) return 'time';
  if (edit.endDate !== edit.startDate) return 'date';
  return edit.endTime ? 'time' : 'none';
}

export default function EventForm({ edit, occurrenceDate, defaultDate, onDone }: {
  edit?: CalendarEvent;
  /** Start date of the specific occurrence being edited (for "just this event" deletes). */
  occurrenceDate?: string | null;
  defaultDate?: string | null;
  onDone: () => void;
}) {
  const { addEvent, updateEvent, deleteEvent, selectedDate } = useApp();
  const initialDate = edit?.startDate ?? defaultDate ?? selectedDate ?? '';
  const [title, setTitle] = useState(edit?.title ?? '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [color, setColor] = useState(edit?.colorKey ?? DEFAULT_COLOR);
  const [allDay, setAllDay] = useState(edit?.allDay ?? false);
  const [startDate, setStartDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(edit?.startTime ?? '09:00');
  const [endMode, setEndMode] = useState<EndMode>(initialEndMode(edit));
  const [endDate, setEndDate] = useState(edit && edit.endDate !== edit.startDate ? edit.endDate : '');
  const [endTime, setEndTime] = useState(edit?.endTime ?? '10:00');
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

  // all-day events have no times, so "ends at a time" stops making sense
  const endOptions: { value: EndMode; label: string }[] = allDay
    ? [
        { value: 'none', label: 'Same day' },
        { value: 'date', label: 'On another day' },
      ]
    : [
        { value: 'none', label: 'No end time' },
        { value: 'time', label: 'At a time (same day)' },
        { value: 'date', label: 'On another day' },
      ];

  function changeAllDay(v: boolean) {
    setAllDay(v);
    if (v && endMode === 'time') setEndMode('none');
  }

  function toggleReminder(minutes: number) {
    setReminders(prev =>
      prev.includes(minutes) ? prev.filter(m => m !== minutes) : [...prev, minutes].sort((a, b) => a - b)
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startDate) return;

    let effEndDate = startDate;
    let effEndTime: string | null = null;
    if (endMode === 'time') {
      if (endTime <= startTime) {
        setError('End time must be after the start time.');
        return;
      }
      effEndTime = endTime;
    } else if (endMode === 'date') {
      if (!endDate || endDate < startDate) {
        setError('End date must be on or after the start date.');
        return;
      }
      effEndDate = endDate;
      effEndTime = allDay ? null : endTime || null;
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
        <label className={labelClass}>Description (optional)</label>
        <textarea
          className={`${inputClass} resize-none`}
          rows={2}
          placeholder="Details, location, links…"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      <div className="flex gap-sm">
        <div className="flex-1">
          <label className={labelClass}>Day</label>
          <input
            type="date"
            className={inputClass}
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            style={{ colorScheme: 'dark' }}
          />
        </div>
        {!allDay && (
          <div className="w-28">
            <label className={labelClass}>Time</label>
            <input
              type="time"
              className={inputClass}
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              style={{ colorScheme: 'dark' }}
            />
          </div>
        )}
      </div>

      <CheckboxRow checked={allDay} onChange={changeAllDay} label="All-day" />

      <div>
        <label className={labelClass}>Ends</label>
        <div className="flex gap-sm">
          <Select className="flex-1" options={endOptions} value={endMode} onChange={setEndMode} />
          {endMode === 'time' && (
            <input
              type="time"
              className={`${inputClass} w-28`}
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              style={{ colorScheme: 'dark', width: '7rem' }}
            />
          )}
          {endMode === 'date' && (
            <>
              <input
                type="date"
                className={`${inputClass} w-36`}
                value={endDate}
                min={startDate || undefined}
                onChange={e => setEndDate(e.target.value)}
                style={{ colorScheme: 'dark', width: '9.5rem' }}
              />
              {!allDay && (
                <input
                  type="time"
                  className={`${inputClass} w-24`}
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  style={{ colorScheme: 'dark', width: '6.5rem' }}
                />
              )}
            </>
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
              style={{ colorScheme: 'dark', width: '4rem' }}
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
              style={{ colorScheme: 'dark', width: '10rem' }}
            />
          </div>
        )}
      </div>

      <div>
        <label className={labelClass}>Notifications</label>
        <div className="flex gap-xs">
          {REMINDER_PRESETS.map(({ minutes, label }) => (
            <button
              key={minutes}
              type="button"
              onClick={() => toggleReminder(minutes)}
              className={`flex-1 py-xs rounded-lg text-label-md font-semibold transition-all ${
                reminders.includes(minutes)
                  ? 'bg-primary text-on-primary'
                  : 'bg-fill-strong text-txt-muted hover:bg-fill-stronger'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-txt-muted mt-xs">Pick any combination — e.g. 1 week and 1 day before.</p>
      </div>

      <div>
        <label className={labelClass}>Color</label>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      {error && <p className="text-body-sm text-danger">{error}</p>}

      {edit ? (
        <EditActions saveLabel="Save Changes" onDelete={handleDelete} />
      ) : (
        <SubmitButton label="Add Event" />
      )}

      {confirmDelete && edit && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim"
          style={{ backdropFilter: 'blur(2px)' }}
          onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(false); }}
        >
          <div
            className="rounded-2xl p-md w-full max-w-[20rem] mx-md shadow-2xl border border-line bg-elevated"
            
          >
            <h3 className="text-body-md font-bold text-txt mb-xs">Delete recurring event</h3>
            <p className="text-body-sm text-txt-muted mb-md">
              “{edit.title}” repeats. What should be deleted?
            </p>
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
          </div>
        </div>
      )}
    </form>
  );
}
