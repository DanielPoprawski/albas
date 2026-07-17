import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { HABIT_COLORS } from '../habitColors';
import type { CalendarEvent, ColorKey, Recurrence } from '../../types';
import { ColorPicker, inputClass, labelClass, SegmentedControl, SubmitButton } from './shared';

type RecType = Recurrence['type'];

const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 10, label: '10 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 1440, label: '1 day' },
  { minutes: 10080, label: '1 week' },
];

export default function EventForm({ edit, onDone }: { edit?: CalendarEvent; onDone: () => void }) {
  const { addEvent, updateEvent, selectedDate } = useApp();
  const defaultDate = edit?.startDate ?? selectedDate ?? '';
  const [title, setTitle] = useState(edit?.title ?? '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [color, setColor] = useState<ColorKey>(edit?.colorKey ?? 'primary');
  const [allDay, setAllDay] = useState(edit?.allDay ?? false);
  const [startDate, setStartDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState(edit?.startTime ?? '09:00');
  const [endDate, setEndDate] = useState(edit?.endDate ?? defaultDate);
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

  function toggleReminder(minutes: number) {
    setReminders(prev =>
      prev.includes(minutes) ? prev.filter(m => m !== minutes) : [...prev, minutes].sort((a, b) => a - b)
    );
  }

  // keep end >= start as the user moves the start date
  function changeStartDate(v: string) {
    setStartDate(v);
    if (!endDate || endDate < v) setEndDate(v);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startDate) return;
    const effEndDate = endDate || startDate;
    if (effEndDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    if (!allDay && effEndDate === startDate && endTime <= startTime) {
      setError('End time must be after the start time.');
      return;
    }
    const n = parseInt(interval, 10);
    const recurrence: Recurrence =
      recType === 'none'
        ? { type: 'none' }
        : { type: recType, interval: Number.isFinite(n) && n > 0 ? n : 1, until: until || null };
    const fields = {
      title: title.trim(),
      description: description.trim(),
      colorKey: color,
      allDay,
      startDate,
      startTime: allDay ? null : startTime,
      endDate: effEndDate,
      endTime: allDay ? null : endTime,
      recurrence,
      reminders,
    };
    if (edit) updateEvent(edit.id, fields);
    else addEvent(fields);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-md">
      <div>
        <label className={labelClass}>Title</label>
        <input
          className={inputClass}
          placeholder="e.g. Team sync, Dentist"
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

      <label className="flex items-center gap-sm cursor-pointer p-sm rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
        <input
          type="checkbox"
          checked={allDay}
          onChange={e => setAllDay(e.target.checked)}
          className="accent-blue-600"
        />
        <span className="text-body-sm text-inverse-on-surface">All-day</span>
      </label>

      <div className="flex gap-sm">
        <div className="flex-1">
          <label className={labelClass}>Starts</label>
          <input
            type="date"
            className={inputClass}
            value={startDate}
            onChange={e => changeStartDate(e.target.value)}
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

      <div className="flex gap-sm">
        <div className="flex-1">
          <label className={labelClass}>Ends</label>
          <input
            type="date"
            className={inputClass}
            value={endDate}
            min={startDate || undefined}
            onChange={e => setEndDate(e.target.value)}
            style={{ colorScheme: 'dark' }}
          />
        </div>
        {!allDay && (
          <div className="w-28">
            <label className={labelClass}>Time</label>
            <input
              type="time"
              className={inputClass}
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              style={{ colorScheme: 'dark' }}
            />
          </div>
        )}
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
            <span className="text-body-sm text-outline-variant">Every</span>
            <input
              type="number"
              min="1"
              className={`${inputClass} text-center`}
              value={interval}
              onChange={e => setInterval_(e.target.value)}
              style={{ colorScheme: 'dark', width: '4rem' }}
            />
            <span className="text-body-sm text-outline-variant">
              {recType === 'daily' ? 'day(s)' : recType === 'weekly' ? 'week(s)' : 'month(s)'}
            </span>
            <span className="text-body-sm text-outline-variant ml-sm">until</span>
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
        <label className={labelClass}>Remind me before</label>
        <div className="flex gap-xs">
          {REMINDER_PRESETS.map(({ minutes, label }) => (
            <button
              key={minutes}
              type="button"
              onClick={() => toggleReminder(minutes)}
              className={`flex-1 py-xs rounded-lg text-label-md font-semibold transition-all ${
                reminders.includes(minutes)
                  ? 'bg-primary text-on-primary'
                  : 'bg-white/10 text-outline-variant hover:bg-white/20'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelClass}>Color</label>
        <ColorPicker value={color} onChange={setColor} colors={HABIT_COLORS} />
      </div>

      {error && <p className="text-body-sm text-tertiary-fixed-dim">{error}</p>}

      <SubmitButton label={edit ? 'Save Changes' : 'Add Event'} />
    </form>
  );
}
