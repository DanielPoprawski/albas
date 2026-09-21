import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn, samePatch } from '@/lib/utils';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { ModalChrome } from './ui/modal-chrome';
import { Segmented } from './ui/segmented';
import { Dot } from './ui/tag';
import { StarButton } from './ui/star';
import { Switch } from './ui/switch';
import type { AddType, Routine } from '../types';
import { useApp } from '../context/AppContext';
import { newCategory, nextColor } from '../categoryLogic';
import { colorHex, PALETTE_COMPACT } from '../colors';
import {
  buildCreate,
  buildRecurrence,
  draftFromRecurrence,
  splitLocation,
  type EventRepeat,
  type RecurrenceDraft,
} from '../createItem';
import { REMINDER_QUICK, reminderLabel } from '../reminders';
import { addDays, addMinutes, fmt, nowFloor15, shortDate } from '../dates';
import { movedEnd } from '../eventLogic';
import { isRepeating } from '../todoLogic';
import { ROUTINE_OPTIONS } from './habits/habitModel';
import { stripMatch, type NlDateMatch } from '../nlDate';
import { useIsCoarsePointer } from '../useMedia';
import DateField from './forms/DateField';
import { NlDateSuggestion, useNlSuggestion } from './forms/NlDateSuggestion';
import RepeatField, {
  buildRepeat,
  draftFromRepeat,
  repeatError,
  WeekdayPicker,
  type RepeatDraft,
} from './forms/RepeatField';
import { ColorPicker, ColorPopover, Select } from './forms/shared';
import { useModalDismiss } from './ui/useModalDismiss';
import { useSpringHeight } from './ui/useSpringHeight';
import {
  FIELD_ROW,
  fieldLabel,
  PLACEHOLDERS,
  REPEAT_OPTIONS,
  SECTIONS,
  type FieldKey,
  type Props,
} from './addModal/catalog';
import { FieldRow, SectionGroup } from './addModal/parts';

const REPEAT_LABELS: Record<EventRepeat, string> = {
  Never: "Doesn't repeat",
  Daily: 'Daily',
  Weekdays: 'Every weekday (Mon–Fri)',
  Weekly: 'Weekly',
  Monthly: 'Monthly',
  Yearly: 'Yearly',
  Custom: 'Custom…',
};

/**
 * What `commit()` did. A dismiss (scrim, ×, Escape, Android back) closes on
 * anything but `invalid`; the primary button additionally refuses `empty`.
 */
type CommitResult = 'saved' | 'unchanged' | 'empty' | 'invalid';

/** The footer's delete choices: a ghost button that stays red under the pointer. */
const DANGER = 'text-danger hover:text-danger';

/**
 * One modal, two modes. **Create** builds a new event, task or habit out of
 * the chip rows; **edit** (`editTodo` / `editEvent`) seeds those same rows
 * from the stored item, saves back over it, and puts Delete in the footer.
 * Leaving either way saves — only Cancel throws the draft away.
 */
export default function AddModal({
  onClose,
  editTodo,
  editEvent,
  editEventDate,
  defaultDate,
  defaultStartTime,
  defaultTitle,
  defaultType,
  defaultCategory,
  defaultAllDay,
  onSubmit,
  snappiness = 1,
}: Props) {
  const {
    addEvent,
    addTodo,
    updateEvent,
    updateTodo,
    deleteEvent,
    deleteTodo,
    selectedDate,
    todos,
    categories,
    categoriesFor,
    addCategory,
    firstDayOfWeek,
  } = useApp();
  const ev = editEvent;
  const td = editTodo;
  const edit = !!(ev || td);
  const initialDate = defaultDate ?? selectedDate ?? fmt(new Date());
  const initialStart = defaultStartTime ?? nowFloor15();
  // An event's Where is the `Location: …` paragraph `buildCreate` folded into
  // its description; a to-do keeps its notes in a column of their own.
  const stored = ev ? splitLocation(ev.description) : { location: '', notes: td?.notes ?? '' };

  const [type, setType] = useState<AddType>(
    ev ? 'event' : td ? (isRepeating(td) ? 'habit' : 'task') : (defaultType ?? 'event'),
  );
  const [title, setTitle] = useState(ev?.title ?? td?.name ?? defaultTitle ?? '');
  // In edit mode a section starts expanded when one of its keys holds
  // anything but a default; creating keeps the old "nothing but what you
  // asked for" rule.
  const [on, setOn] = useState<Record<AddType, Set<FieldKey>>>(() => {
    const empty: Record<AddType, Set<FieldKey>> = { event: new Set(), task: new Set(), habit: new Set() };
    if (ev) {
      const keys: FieldKey[] = [];
      if (ev.allDay) keys.push('allday');
      if (ev.recurrence.type !== 'none') keys.push('repeat');
      if (ev.category) keys.push('category');
      if (ev.reminders.length) keys.push('reminder');
      if (stored.location) keys.push('location');
      if (stored.notes) keys.push('desc');
      return { ...empty, event: new Set(keys) };
    }
    if (td) {
      const keys: FieldKey[] = [];
      if (td.dueDate) keys.push('due');
      if (td.reminder || td.time) keys.push('reminder');
      if (td.notes) keys.push('desc');
      if (!isRepeating(td)) {
        if (td.category) keys.push('category');
        return { ...empty, task: new Set(keys) };
      }
      if (td.schedule.type !== 'daily' || td.target > 1) keys.push('repeat', 'target');
      if (td.routine) keys.push('routine');
      return { ...empty, habit: new Set(keys) };
    }
    return {
      ...empty,
      event: new Set<FieldKey>(defaultAllDay ? ['allday'] : []),
      task: new Set<FieldKey>(defaultCategory ? ['category'] : []),
    };
  });
  const [allDay, setAllDay] = useState(ev?.allDay ?? defaultAllDay ?? false);
  const [startDate, setStartDate] = useState(ev?.startDate ?? initialDate);
  const [startTime, setStartTime] = useState(ev?.startTime ?? initialStart);
  const [endDate, setEndDate] = useState(ev?.endDate ?? initialDate);
  const [endTime, setEndTime] = useState(ev?.endTime ?? addMinutes(initialStart, 60));
  const [dueDate, setDueDate] = useState(td?.dueDate ?? initialDate);
  /** A to-do's optional time of day; '' = none. */
  const [todoTime, setTodoTime] = useState(td?.time ?? '');
  const [location, setLocation] = useState(stored.location);
  const [description, setDescription] = useState(stored.notes);
  const [schedule, setSchedule] = useState<RepeatDraft>(() => draftFromRepeat(td?.schedule ?? { type: 'daily' }));
  const [rec, setRec] = useState<RecurrenceDraft>(() => draftFromRecurrence(ev?.recurrence ?? { type: 'none' }));
  const [important, setImportant] = useState(td?.important ?? false);
  /** A habit's own colour; a new one takes the first palette hue no habit uses yet. */
  const [color, setColor] = useState(() => td?.colorKey ?? nextColor(todos.filter(isRepeating)));
  const [colorOpen, setColorOpen] = useState(false);
  const [routine, setRoutine] = useState<Routine>(td?.routine ?? '');
  const [category, setCategory] = useState(ev?.category ?? td?.category ?? defaultCategory ?? '');
  const [target, setTarget] = useState(td?.target ?? 1);
  const [unit, setUnit] = useState(td?.unit ?? '');
  /** Event lead times (minutes) switched on; 10 minutes to begin with. */
  const [reminders, setReminders] = useState<Record<number, boolean>>(() =>
    ev ? Object.fromEntries(ev.reminders.map((m) => [m, true])) : { 10: true },
  );
  /** A to-do only knows on/off, and a revealed Notify row means "yes" by default. */
  const [todoReminder, setTodoReminder] = useState(td?.reminder ?? true);
  const [customRemOpen, setCustomRemOpen] = useState(false);
  const [customRemAmount, setCustomRemAmount] = useState('15');
  const [customRemUnit, setCustomRemUnit] = useState<'minutes' | 'hours' | 'days' | 'weeks'>('minutes');
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState<string>(PALETTE_COMPACT[0]);
  const [error, setError] = useState('');
  /** The delete confirmation, which replaces the footer's normal contents. */
  const [confirm, setConfirm] = useState(false);

  const coarse = useIsCoarsePointer();
  const catOptions = categoriesFor(type === 'event' ? 'calendar' : 'tasks');

  function createCategory() {
    const name = newCatName.trim();
    if (!name) return;
    const created = addCategory(newCategory(name, newCatColor, categories));
    setCategory(created.id);
    setNewCatOpen(false);
    setNewCatName('');
  }

  // Natural-language date suggestion. `dateTouched` tracks whether the user
  // has hand-edited any date/time field or already used Apply — a suggestion
  // only auto-applies on submit when nothing has, so it never silently
  // overrides a date the user actually chose.
  const { suggestion, dismiss: dismissSuggestion } = useNlSuggestion(title);
  const [dateTouched, setDateTouched] = useState(false);

  /** Pure: what Apply (or an auto-apply on submit) would change, without touching state. */
  function computeApplied(match: NlDateMatch) {
    const newTitle = stripMatch(title, match.matched);
    if (type === 'event') {
      const newStart = match.start.date;
      return {
        title: newTitle,
        startDate: newStart,
        endDate: match.end?.date ?? newStart,
        startTime: match.start.time ?? startTime,
        endTime: match.end?.time ?? (match.start.time ? addMinutes(match.start.time, 60) : endTime),
        dueDate,
        todoTime,
        setsDue: false,
      };
    }
    // task and habit both drive the due/start day and its time of day.
    return {
      title: newTitle,
      startDate,
      endDate,
      startTime,
      endTime,
      dueDate: match.start.date,
      todoTime: match.start.time ?? todoTime,
      setsDue: true,
    };
  }

  function applySuggestion(match: NlDateMatch) {
    const next = computeApplied(match);
    setTitle(next.title);
    setStartDate(next.startDate);
    setEndDate(next.endDate);
    setStartTime(next.startTime);
    setEndTime(next.endTime);
    setDueDate(next.dueDate);
    setTodoTime(next.todoTime);
    if (next.setsDue) addOn('due');
    if (next.setsDue && match.start.time) addOn('reminder');
    setDateTouched(true);
  }

  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const measure = useSpringHeight(cardRef, innerRef, snappiness);
  // Re-measure as soon as a row set changes, ahead of the observer.
  useEffect(() => {
    measure();
  }, [type, on, allDay, suggestion, confirm, measure]);

  const currentOn = on[type];

  const addOn = (key: FieldKey) => {
    setOn((prev) => ({
      ...prev,
      [type]: new Set([...prev[type], key]),
    }));
  };

  const removeOn = (key: FieldKey) => {
    setOn((prev) => {
      const newSet = new Set(prev[type]);
      newSet.delete(key);
      return {
        ...prev,
        [type]: newSet,
      };
    });
  };

  // One field's checkbox in the desktop options pane.
  const toggleField = (key: FieldKey) => {
    if (currentOn.has(key)) {
      removeOn(key);
      return;
    }
    addOn(key);
    // A to-do's reminder wants a time of day; 9:00 unless one is already set.
    if (key === 'reminder' && type !== 'event' && !todoTime) setTodoTime('09:00');
    if (key === 'routine' && !routine) setRoutine('morning');
  };

  // The phone's section header: switches every field of the section on or off together.
  const sectionOpen = (keys: FieldKey[]) => keys.some((k) => currentOn.has(k));
  const toggleSection = (keys: FieldKey[]) => {
    const open = sectionOpen(keys);
    for (const k of keys) if (currentOn.has(k) === open) toggleField(k);
  };

  const patchRec = (p: Partial<RecurrenceDraft>) => setRec((prev) => ({ ...prev, ...p }));

  const handleTypeChange = (newType: AddType) => {
    setType(newType);
    setError('');
  };

  const canSubmit = title.trim().length > 0;

  /** Validates and persists. Pure of navigation: the caller decides what the result means for closing. */
  const commit = ({ lenient = false } = {}): CommitResult => {
    setError('');
    if (!canSubmit) return 'empty';

    // A habit's repeat rule (only while its section is open): an invalid draft
    // blocks an explicit save with a message, and blocks a dismiss too once
    // the habit exists — silently rewriting a stored rule is worse than
    // staying open. A brand-new one falls back to daily instead.
    let habitSchedule = buildRepeat(schedule);
    if (type === 'habit' && on.habit.has('repeat') && !habitSchedule) {
      if (!lenient || edit) {
        setError(repeatError(schedule));
        return 'invalid';
      }
      habitSchedule = { type: 'daily' };
    }

    // An undismissed suggestion the user never hand-edited a date field for
    // (nor already applied) gets folded in here — computed rather than read
    // back from state, since `setState` inside this same call wouldn't be
    // visible until the next render. Never on an edit: a stored item must not
    // reschedule itself just because its title reads like a date.
    const applied = !edit && !dateTouched && suggestion ? computeApplied(suggestion) : null;
    const sTitle = applied?.title ?? title;
    const sStartDate = applied?.startDate ?? startDate;
    const sEndDate = applied?.endDate ?? endDate;
    const sStartTime = applied?.startTime ?? startTime;
    const sEndTime = applied?.endTime ?? endTime;
    const sDueDate = applied?.dueDate ?? dueDate;
    const sTodoTime = applied?.todoTime ?? todoTime;

    const active = new Set(on[type]);
    if (applied?.setsDue) active.add('due');
    if (applied?.setsDue && suggestion?.start.time) active.add('reminder');
    const name = sTitle.trim();

    // A field only reaches the payload if its row is actually showing — an
    // unrevealed chip's state is a default, not a choice the user made. On an
    // edit that cuts both ways: collapsing a section clears what it held.
    const has = (k: FieldKey) => active.has(k);
    const isAllDay = has('allday') ? allDay : false;

    // An end before its start is a typo, not something to save quietly — this
    // is the one result that holds the modal open even on a dismiss.
    if (type === 'event') {
      const effEndDate = sEndDate || sStartDate;
      if (effEndDate < sStartDate) {
        setError('End date must be on or after the start date.');
        return 'invalid';
      }
      if (!isAllDay && effEndDate === sStartDate && sEndTime && sEndTime <= sStartTime) {
        setError('End time must be after the start time.');
        return 'invalid';
      }
    }

    const payload = buildCreate(type, name, {
      startDate: sStartDate,
      // A to-do's time of day is when it is reminded, so it lives with the Notify row.
      startTime: type === 'event' ? sStartTime : has('reminder') ? sTodoTime || null : null,
      endDate: sEndDate,
      endTime: sEndTime,
      allDay: isAllDay,
      dueDate: type === 'event' ? sDueDate : has('due') ? sDueDate || null : null,
      location: has('location') ? location : '',
      description: has('desc') ? description : '',
      eventRecurrence: has('repeat')
        ? buildRecurrence(rec, ev && ev.recurrence.type !== 'none' ? ev.recurrence.exdates : undefined)
        : { type: 'none' },
      schedule: has('repeat') ? (habitSchedule ?? undefined) : undefined,
      important,
      category: has('category') ? category : '',
      target: has('target') ? target : 1,
      unit: has('target') ? unit : '',
      colorKey: type === 'habit' ? color : undefined,
      routine: has('routine') ? routine : '',
      reminderMins:
        type === 'event' && has('reminder')
          ? Object.keys(reminders)
              .map(Number)
              .filter((m) => reminders[m])
              .sort((a, b) => a - b)
          : [],
      reminder: type !== 'event' && has('reminder') ? todoReminder : false,
    });

    // No `colorKey` on an event or task update: their colours belong to
    // categories, and the row the modal was opened on carries its painted
    // category colour, which must not be written back as if the user had
    // chosen it. A habit's colour is its own.
    if (payload.kind === 'event') {
      const { colorKey: _colorKey, ...fields } = payload.event;
      if (ev) {
        if (samePatch(fields, ev)) return 'unchanged';
        updateEvent(ev.id, fields);
      } else {
        addEvent(payload.event);
      }
    } else {
      const { colorKey: _colorKey, ...unpainted } = payload.todo;
      const fields = type === 'habit' ? payload.todo : unpainted;
      if (td) {
        if (samePatch(fields, td)) return 'unchanged';
        updateTodo(td.id, fields);
      } else {
        addTodo(payload.todo);
      }
    }

    onSubmit?.({
      type,
      title: name,
      fields: {
        allDay: isAllDay,
        startDate: sStartDate,
        startTime: sStartTime,
        endDate: sEndDate,
        endTime: sEndTime,
        dueDate: sDueDate,
        todoTime: sTodoTime,
        location,
        description,
        schedule: habitSchedule,
        repeat: rec.repeat,
        important,
        category,
        target,
        unit,
        reminders,
      },
    });
    return 'saved';
  };

  const submit = () => {
    const result = commit();
    if (result === 'saved' || result === 'unchanged') onClose();
  };

  // Leaving with a title saves it. Only Cancel is an explicit "throw this
  // away" — and a dismiss while the delete confirmation shows is still just a
  // dismiss: it saves and closes, it does not delete.
  const dismiss = () => {
    if (commit({ lenient: true }) !== 'invalid') onClose();
  };
  useModalDismiss(dismiss);

  const recurring = !!ev && ev.recurrence.type !== 'none';
  const hasHistory = type === 'habit' && !!td && Object.keys(td.completions).length > 0;

  function deleteItem() {
    if (ev) deleteEvent(ev.id);
    else if (td) deleteTodo(td.id);
    onClose();
  }

  function deleteJustThis() {
    if (!ev || ev.recurrence.type === 'none' || !editEventDate) return;
    const r = ev.recurrence;
    updateEvent(ev.id, { recurrence: { ...r, exdates: [...(r.exdates ?? []), editEventDate] } });
    onClose();
  }

  function deleteFuture() {
    if (!ev || ev.recurrence.type === 'none' || !editEventDate) return;
    const newUntil = addDays(editEventDate, -1);
    if (newUntil < ev.startDate) {
      deleteEvent(ev.id); // cutting off before the first occurrence = delete all
    } else {
      updateEvent(ev.id, { recurrence: { ...ev.recurrence, until: newUntil } });
    }
    onClose();
  }

  // One row per optional field; a section shows the rows of its keys. The
  // × on a row switches that one field off.
  const rows: Record<FieldKey, ReactNode> = {
    // Phone only: on the desktop the options checkbox is the all-day switch itself.
    allday: currentOn.has('allday') && type === 'event' && (
      <div className="hidden max-md:contents">
        <FieldRow label={fieldLabel('allday', type)} onRemove={() => removeOn('allday')}>
          <Switch checked={allDay} onCheckedChange={setAllDay} aria-label="All-day" />
          <div className="flex-1" />
        </FieldRow>
      </div>
    ),
    repeat: currentOn.has('repeat') && (
      <FieldRow label={fieldLabel('repeat', type)} align="start" onRemove={() => removeOn('repeat')}>
        {type === 'habit' ? (
          <div className="flex-1">
            <RepeatField value={schedule} onChange={setSchedule} firstDayOfWeek={firstDayOfWeek} repeatingOnly />
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-2">
            <Select
              options={REPEAT_OPTIONS.map((opt) => ({
                value: opt,
                label: REPEAT_LABELS[opt],
              }))}
              value={rec.repeat}
              onChange={(repeat) => patchRec({ repeat })}
            />
            {(rec.repeat === 'Weekly' || (rec.repeat === 'Custom' && rec.unit === 'weekly')) && (
              <WeekdayPicker
                value={rec.weekdays}
                onChange={(weekdays) => patchRec({ weekdays })}
                firstDayOfWeek={firstDayOfWeek}
              />
            )}
            {rec.repeat === 'Custom' && (
              <div className="flex items-center gap-2 flex-wrap text-sm text-ink-muted">
                <span>Every</span>
                <input
                  type="number"
                  min="1"
                  aria-label="Repeat interval"
                  className="field-input w-16 text-center"
                  value={rec.interval}
                  onChange={(e) => patchRec({ interval: e.target.value })}
                />
                <Select
                  options={[
                    { value: 'daily', label: 'day(s)' },
                    { value: 'weekly', label: 'week(s)' },
                    { value: 'monthly', label: 'month(s)' },
                    { value: 'yearly', label: 'year(s)' },
                  ]}
                  value={rec.unit}
                  onChange={(unit) => patchRec({ unit })}
                />
              </div>
            )}
            {rec.repeat !== 'Never' && (
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <span>until</span>
                <DateField
                  value={rec.until}
                  onChange={(until) => patchRec({ until })}
                  allowEmpty
                  placeholder="forever"
                  className="w-40"
                  aria-label="Repeat until"
                />
              </div>
            )}
          </div>
        )}
      </FieldRow>
    ),
    due: currentOn.has('due') && type !== 'event' && (
      <FieldRow label={fieldLabel('due', type)} onRemove={() => removeOn('due')}>
        <DateField
          className="flex-1"
          aria-label={type === 'task' ? 'Due date' : 'Start date'}
          value={dueDate}
          onChange={(next) => {
            setDueDate(next);
            setDateTouched(true);
          }}
        />
      </FieldRow>
    ),
    category: currentOn.has('category') && (
      <FieldRow label={fieldLabel('category', type)} align="start" onRemove={() => removeOn('category')}>
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {catOptions.map((cat) => {
              const hex = colorHex(cat.colorKey);
              const selected = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className="chip border-solid"
                  data-selected={selected || undefined}
                  // dynamic: a selected chip is outlined in its own category colour
                  style={selected ? { borderColor: hex } : undefined}
                >
                  <Dot accent={hex} size={7} />
                  {cat.name}
                </button>
              );
            })}
            <button type="button" onClick={() => setNewCatOpen((v) => !v)} className="chip">
              New…
            </button>
          </div>
          {newCatOpen && (
            <div className={cn(FIELD_ROW, 'flex-col items-stretch gap-1.5')}>
              <input
                autoFocus
                placeholder="Category name"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    createCategory();
                  }
                }}
                className="field-input"
              />
              <ColorPicker value={newCatColor} onChange={setNewCatColor} />
              <Button size="sm" onClick={createCategory} disabled={!newCatName.trim()} className="self-start">
                Add
              </Button>
            </div>
          )}
        </div>
      </FieldRow>
    ),
    routine: currentOn.has('routine') && type === 'habit' && (
      <FieldRow label={fieldLabel('routine', type)} onRemove={() => removeOn('routine')}>
        <Segmented aria-label="Routine" options={ROUTINE_OPTIONS} value={routine} onChange={setRoutine} />
      </FieldRow>
    ),
    target: currentOn.has('target') && type === 'habit' && (
      <FieldRow label={fieldLabel('target', type)} onRemove={() => removeOn('target')}>
        <div className="flex items-center border border-line">
          <button
            type="button"
            aria-label="Decrease target"
            onClick={() => setTarget(Math.max(1, target - 1))}
            className="size-[1.875rem] max-md:size-10 bg-surface border-0 border-r border-line text-ink-secondary text-base cursor-pointer transition-colors hover:bg-subtle hover:text-accent"
          >
            −
          </button>
          <span className="min-w-[4.625rem] text-center text-sm font-medium">
            {target} {target === 1 ? 'time / day' : 'times / day'}
          </span>
          <button
            type="button"
            aria-label="Increase target"
            onClick={() => setTarget(Math.min(12, target + 1))}
            className="size-[1.875rem] max-md:size-10 bg-surface border-0 border-l border-line text-ink-secondary text-base cursor-pointer transition-colors hover:bg-subtle hover:text-accent"
          >
            +
          </button>
        </div>
        {target > 1 && (
          <input
            placeholder="unit (pages, glasses…)"
            aria-label="Unit"
            className="field-input w-32"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        )}
        <div className="flex-1" />
      </FieldRow>
    ),
    reminder: currentOn.has('reminder') && (
      <FieldRow
        label={fieldLabel('reminder', type)}
        align={type === 'event' ? 'start' : 'center'}
        onRemove={() => removeOn('reminder')}
      >
        {type !== 'event' ? (
          <>
            <Switch checked={todoReminder} onCheckedChange={setTodoReminder} aria-label="Remind me on due days" />
            <span className="text-sm text-ink-secondary">on due days at</span>
            <input
              type="time"
              aria-label="Reminder time"
              className="field-input w-auto"
              value={todoTime}
              onChange={(e) => {
                setTodoTime(e.target.value);
                setDateTouched(true);
              }}
            />
            <div className="flex-1" />
          </>
        ) : (
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {Array.from(new Set([...REMINDER_QUICK, ...Object.keys(reminders).map(Number)]))
                .sort((a, b) => a - b)
                .map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setReminders((prev) => {
                        const next = { ...prev };
                        if (next[m]) delete next[m];
                        else next[m] = true;
                        return next;
                      });
                    }}
                    className="chip border-solid"
                    data-selected={reminders[m] || undefined}
                  >
                    {reminderLabel(m, 'short')}
                  </button>
                ))}
              <button
                type="button"
                onClick={() => setCustomRemOpen((v) => !v)}
                className="chip"
                data-selected={customRemOpen || undefined}
              >
                + Custom…
              </button>
            </div>
            {customRemOpen && (
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <input
                  type="number"
                  min="1"
                  aria-label="Reminder lead time"
                  className="field-input w-16 text-center"
                  value={customRemAmount}
                  onChange={(e) => setCustomRemAmount(e.target.value)}
                  placeholder="15"
                />
                <Select
                  options={[
                    { value: 'minutes', label: 'minutes before' },
                    { value: 'hours', label: 'hours before' },
                    { value: 'days', label: 'days before' },
                    { value: 'weeks', label: 'weeks before' },
                  ]}
                  value={customRemUnit}
                  onChange={setCustomRemUnit}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const n = parseInt(customRemAmount, 10);
                    if (!Number.isFinite(n) || n <= 0) return;
                    const mult =
                      customRemUnit === 'weeks'
                        ? 10080
                        : customRemUnit === 'days'
                          ? 1440
                          : customRemUnit === 'hours'
                            ? 60
                            : 1;
                    setReminders((prev) => ({ ...prev, [n * mult]: true }));
                    setCustomRemOpen(false);
                  }}
                >
                  Add
                </Button>
              </div>
            )}
          </div>
        )}
      </FieldRow>
    ),
    location: currentOn.has('location') && type === 'event' && (
      <FieldRow label={fieldLabel('location', type)} onRemove={() => removeOn('location')}>
        <input
          placeholder="Room, address or link"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="field-input flex-1"
        />
      </FieldRow>
    ),
    desc: currentOn.has('desc') && (
      <FieldRow label={fieldLabel('desc', type)} align="start" onRemove={() => removeOn('desc')}>
        <textarea
          placeholder="Details, links…"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="field-input flex-1 resize-y leading-normal"
        />
      </FieldRow>
    ),
  };

  const typeOptions = [
    { value: 'event', label: 'Event' },
    { value: 'task', label: 'Task' },
    { value: 'habit', label: 'Habit' },
  ] as const;

  // Delete asks inside the footer rather than in a second dialog stacked on
  // this one; a recurring event is the only case with more than one answer.
  const footer = confirm ? (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-muted">
        {recurring ? 'This event repeats.' : hasHistory ? 'Delete habit and its history?' : 'Delete?'}
      </span>
      {recurring ? (
        <>
          {editEventDate && (
            <>
              <Button variant="ghost" className={DANGER} onClick={deleteJustThis}>
                Just this · {shortDate(editEventDate)}
              </Button>
              <Button variant="ghost" className={DANGER} onClick={deleteFuture}>
                This and future
              </Button>
            </>
          )}
          <Button variant="ghost" className={DANGER} onClick={deleteItem}>
            All
          </Button>
        </>
      ) : (
        <Button variant="ghost" className={DANGER} onClick={deleteItem}>
          Delete
        </Button>
      )}
      <Button variant="ghost" onClick={() => setConfirm(false)}>
        Keep
      </Button>
    </div>
  ) : (
    <>
      {edit ? (
        <Button variant="ghost" className={DANGER} onClick={() => setConfirm(true)}>
          Delete
        </Button>
      ) : (
        <span className="text-xs text-icon-idle max-md:hidden">{canSubmit ? 'Enter to save' : ''}</span>
      )}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!canSubmit}>
          {edit ? 'Save' : `Add ${type}`}
        </Button>
      </div>
    </>
  );

  return (
    <ModalChrome
      title={`${edit ? 'Edit' : 'New'} ${type}`}
      onClose={dismiss}
      cardRef={cardRef}
      innerRef={innerRef}
      footer={footer}
    >
      {/* Two panes on the desktop: the item's concrete details on the left, the options menu on the right.
          Below `md` the aside is gone and the sections' own headers do that job. */}
      <div className="flex max-md:flex-col">
        <div className="min-w-0 flex-1">
          {/* Type segmented control — create only: an existing row is what it is. */}
          {!edit && (
            <div className="px-5 pt-[0.875rem]">
              <Segmented fill aria-label="Type" options={[...typeOptions]} value={type} onChange={handleTypeChange} />
            </div>
          )}

          {/* Body */}
          <div className="flex flex-col gap-[0.875rem] px-5 pt-[1.125rem] pb-1">
            {/* Title input, with the star beside it for tasks and the colour swatch for habits */}
            <div className="flex items-center gap-2">
              {type === 'habit' && (
                <ColorPopover
                  open={colorOpen}
                  onOpenChange={setColorOpen}
                  value={color}
                  onChange={(hex) => {
                    setColor(hex);
                    setColorOpen(false);
                  }}
                >
                  <button
                    type="button"
                    aria-label="Colour"
                    title="Colour"
                    onClick={() => setColorOpen((v) => !v)}
                    className="icon-btn shrink-0"
                  >
                    <Dot accent={color} size={14} />
                  </button>
                </ColorPopover>
              )}
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
                // A touch keyboard covering half the sheet, or an edit whose text
                // is already what the user wants, is not worth stealing focus for.
                autoFocus={!edit && !coarse}
                placeholder={PLACEHOLDERS[type]}
                className="w-full min-w-0 flex-1 border-0 border-b-2 border-line bg-transparent pt-1 pb-2 text-lg font-medium text-ink transition-colors duration-150 placeholder:text-ink-muted focus:border-accent"
              />
              {type === 'task' && (
                <StarButton important={important} onToggle={() => setImportant((v) => !v)} size="1.25rem" />
              )}
            </div>

            {/* Appears the moment a date/time phrase is recognised in the title,
            disappears the moment it's applied (the phrase is stripped) or dismissed. */}
            {suggestion && (
              <NlDateSuggestion
                suggestion={suggestion}
                onApply={() => applySuggestion(suggestion)}
                onDismiss={dismissSuggestion}
                className={cn(FIELD_ROW, '-mt-2')}
              />
            )}

            {/* Event date/time block */}
            {type === 'event' && (
              <div className={cn(FIELD_ROW, 'flex-col items-stretch gap-2 p-3 bg-page border border-line')}>
                <div className="flex flex-wrap items-center gap-[0.625rem]">
                  <span className="micro-label w-[2.875rem] shrink-0">Starts</span>
                  <DateField
                    className="flex-1 min-w-[8rem]"
                    aria-label="Start date"
                    value={startDate}
                    onChange={(next) => {
                      // Moving the start drags the end with it, keeping the gap.
                      if (next && startDate && endDate) setEndDate(movedEnd(startDate, next, endDate));
                      setStartDate(next);
                      setDateTouched(true);
                    }}
                  />
                  {!allDay && (
                    <input
                      type="time"
                      aria-label="Start time"
                      className="field-input w-auto"
                      value={startTime}
                      onChange={(e) => {
                        setStartTime(e.target.value);
                        setDateTouched(true);
                      }}
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-[0.625rem]">
                  <span className="micro-label w-[2.875rem] shrink-0">Ends</span>
                  <DateField
                    className="flex-1 min-w-[8rem]"
                    aria-label="End date"
                    value={endDate}
                    onChange={(next) => {
                      setEndDate(next);
                      setDateTouched(true);
                    }}
                  />
                  {!allDay && (
                    <input
                      type="time"
                      aria-label="End time"
                      className="field-input w-auto"
                      value={endTime}
                      onChange={(e) => {
                        setEndTime(e.target.value);
                        setDateTouched(true);
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Optional fields, grouped under collapsible headers */}
            {SECTIONS[type].map((sec) => (
              <SectionGroup
                key={sec.id}
                title={sec.title}
                expanded={sectionOpen(sec.keys)}
                onToggle={() => toggleSection(sec.keys)}
              >
                {sec.keys.map((k) => (
                  <Fragment key={k}>{rows[k]}</Fragment>
                ))}
              </SectionGroup>
            ))}

            {error && <p className="form-message text-danger">{error}</p>}
          </div>
        </div>

        <aside className="w-[14rem] shrink-0 border-l border-line px-5 pt-[1.125rem] pb-4 max-md:hidden">
          <div className="micro-label pb-2">Options</div>
          {SECTIONS[type]
            .flatMap((s) => s.keys)
            .map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-2.5 py-1.5 text-sm text-ink">
                <Checkbox
                  checked={currentOn.has(k)}
                  onCheckedChange={() => {
                    toggleField(k);
                    // This checkbox is the all-day switch; its row only exists on the phone.
                    if (k === 'allday') setAllDay(!currentOn.has('allday'));
                  }}
                />
                {fieldLabel(k, type)}
              </label>
            ))}
        </aside>
      </div>
    </ModalChrome>
  );
}
