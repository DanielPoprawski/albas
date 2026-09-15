import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DEFAULT_COLOR } from '../../colors';
import { addDays, addMinutes, fmt, nowFloor15, shortDate } from '../../dates';
import { movedEnd } from '../../eventLogic';
import { samePatch } from '@/lib/utils';
import { stripMatch } from '../../nlDate';
import { GENERAL } from '../../todoLogic';
import { NlDateSuggestion, useNlSuggestion } from './NlDateSuggestion';
import type { CalendarEvent, Recurrence } from '../../types';
import {
  CheckboxRow,
  EditActions,
  inputClass,
  labelClass,
  Select,
  SegmentedControl,
  SubmitButton,
  type CommitRef,
  type CommitResult,
} from './shared';
import DateField from './DateField';
import RemindersField from './RemindersField';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';

type RecType = Recurrence['type'];

export default function EventForm({
  edit,
  occurrenceDate,
  defaultDate,
  onDone,
  commitRef,
}: {
  edit?: CalendarEvent;
  /** Start date of the specific occurrence being edited (for "just this event" deletes). */
  occurrenceDate?: string | null;
  defaultDate?: string | null;
  onDone: () => void;
  /** Lets the modal commit on dismiss (scrim, Escape, back) without a submit. */
  commitRef?: CommitRef;
}) {
  const { addEvent, updateEvent, deleteEvent, selectedDate, categoriesFor } = useApp();
  const categoryOptions = [
    { value: '', label: GENERAL },
    ...categoriesFor('calendar').map((c) => ({ value: c.id, label: c.name })),
  ];
  const initialDate = edit?.startDate ?? defaultDate ?? selectedDate ?? fmt(new Date());
  // A new event defaults to "now for an hour": today, the current quarter hour,
  // ending sixty minutes later. Nearly every event is entered near its own time,
  // so that's fewer fields to touch than a fixed 09:00.
  const initialStartTime = edit?.startTime ?? nowFloor15();

  const [title, setTitle] = useState(edit?.title ?? '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [category, setCategory] = useState(edit?.category ?? '');
  const [allDay, setAllDay] = useState(edit?.allDay ?? false);
  const [startDate, setStartDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endDate, setEndDate] = useState(edit?.endDate ?? initialDate);
  const [endTime, setEndTime] = useState(edit?.endTime ?? addMinutes(initialStartTime, 60));
  const [recType, setRecType] = useState<RecType>(edit?.recurrence.type ?? 'none');
  const [interval, setInterval_] = useState(
    edit && edit.recurrence.type !== 'none' ? String(edit.recurrence.interval) : '1',
  );
  const [until, setUntil] = useState(edit && edit.recurrence.type !== 'none' ? (edit.recurrence.until ?? '') : '');
  const [reminders, setReminders] = useState<number[]>(edit?.reminders ?? []);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Natural-language date suggestion. Apply-only — an edit form never
  // auto-applies on submit, so a title that happens to contain a date-shaped
  // phrase never silently reschedules an existing event.
  const { suggestion, dismiss: dismissSuggestion } = useNlSuggestion(title);

  function applySuggestion() {
    if (!suggestion) return;
    setStartDate(suggestion.start.date);
    setEndDate(suggestion.end?.date ?? suggestion.start.date);
    if (suggestion.start.time) {
      setStartTime(suggestion.start.time);
      setEndTime(suggestion.end?.time ?? addMinutes(suggestion.start.time, 60));
    }
    setTitle((t) => stripMatch(t, suggestion.matched));
  }

  // Moving the start drags the end with it, keeping the gap — otherwise
  // rescheduling a meeting means editing both dates by hand.
  function changeStartDate(next: string) {
    if (next && startDate && endDate) setEndDate(movedEnd(startDate, next, endDate));
    setStartDate(next);
  }

  /** Validates and persists. Pure of navigation: the caller decides whether the result closes the modal. */
  function commit(): CommitResult {
    if (!title.trim() || !startDate) return 'empty';

    const effEndDate = endDate || startDate;
    if (effEndDate < startDate) {
      setError('End date must be on or after the start date.');
      return 'invalid';
    }
    const effEndTime = allDay ? null : endTime || null;
    if (!allDay && effEndDate === startDate && endTime && endTime <= startTime) {
      setError('End time must be after the start time.');
      return 'invalid';
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
    // No `colorKey`: see TodoForm — the category paints the row, and the
    // painted value must not be persisted as a choice.
    const fields = {
      title: title.trim(),
      description: description.trim(),
      allDay,
      startDate,
      startTime: allDay ? null : startTime,
      endDate: effEndDate,
      endTime: allDay ? null : effEndTime,
      recurrence,
      reminders,
      category,
    };
    if (edit) {
      if (samePatch(fields, edit)) return 'unchanged';
      updateEvent(edit.id, fields);
    } else {
      addEvent({ ...fields, colorKey: DEFAULT_COLOR });
    }
    return 'saved';
  }

  useEffect(() => {
    if (commitRef) commitRef.current = commit;
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = commit();
    if (result === 'saved' || result === 'unchanged') onDone();
    else if (result === 'empty') setError('Give the event a title first.');
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
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        {suggestion && (
          <NlDateSuggestion
            suggestion={suggestion}
            onApply={applySuggestion}
            onDismiss={dismissSuggestion}
            className="mt-xs"
          />
        )}
      </div>

      <div>
        <label className={labelClass}>Category</label>
        <Select options={categoryOptions} value={category} onChange={setCategory} />
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
            <DateField value={startDate} onChange={changeStartDate} aria-label="Start date" />
          </div>
          {!allDay && (
            <div className="w-32 flex-shrink-0">
              <label className={labelClass}>Time</label>
              <input
                type="time"
                className={inputClass}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex gap-sm">
          <div className="flex-1 min-w-0">
            <label className={labelClass}>Ends</label>
            <DateField value={endDate} onChange={setEndDate} aria-label="End date" />
          </div>
          {!allDay && (
            <div className="w-32 flex-shrink-0">
              <label className={labelClass}>Time</label>
              <input type="time" className={inputClass} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
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
            <span className="text-body-sm text-ink-muted">Every</span>
            <input
              type="number"
              min="1"
              className={`${inputClass} text-center w-16`}
              value={interval}
              onChange={(e) => setInterval_(e.target.value)}
            />
            <span className="text-body-sm text-ink-muted">
              {recType === 'daily' ? 'day(s)' : recType === 'weekly' ? 'week(s)' : 'month(s)'}
            </span>
            <span className="text-body-sm text-ink-muted ml-sm">until</span>
            <DateField
              value={until}
              onChange={setUntil}
              allowEmpty
              placeholder="forever"
              className="w-40"
              aria-label="Repeat until"
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
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {error && <p className="text-body-sm text-danger">{error}</p>}

      {edit ? <EditActions saveLabel="Done" onDelete={handleDelete} /> : <SubmitButton label="Add Event" />}

      {/* Nested inside the AddModal dialog. Radix stacks them: Escape closes
          only this one, and focus is trapped here until it goes away. */}
      {edit && (
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent
            showCloseButton={false}
            className="block rounded-2xl p-md w-full max-w-[min(20rem,calc(100%-2rem))] shadow-2xl border-line"
          >
            <DialogTitle className="text-body-md font-title font-normal text-ink mb-xs">
              Delete recurring event
            </DialogTitle>
            <DialogDescription className="text-body-sm text-ink-muted mb-md">
              “{edit.title}” repeats. What should be deleted?
            </DialogDescription>
            <div className="space-y-xs">
              {occurrenceDate && (
                <>
                  <button
                    type="button"
                    onClick={deleteJustThis}
                    className="w-full py-sm px-sm rounded-lg text-left text-body-sm font-medium text-ink bg-subtle hover:bg-subtle-strong transition-colors"
                  >
                    Just this event
                    <span className="text-ink-muted"> · {shortDate(occurrenceDate)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={deleteFuture}
                    className="w-full py-sm px-sm rounded-lg text-left text-body-sm font-medium text-ink bg-subtle hover:bg-subtle-strong transition-colors"
                  >
                    This and all future events
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={deleteAll}
                className="w-full py-sm px-sm text-left text-body-sm font-medium text-danger bg-subtle hover:bg-cat-red-tint transition-colors"
              >
                All events
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="w-full py-sm px-sm rounded-lg text-center text-body-sm text-ink-muted hover:bg-subtle transition-colors"
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
