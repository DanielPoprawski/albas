import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { ModalChrome } from '../ui/modal-chrome';
import { Segmented } from '../ui/segmented';
import { Dot } from '../ui/tag';
import { StarButton } from '../ui/star';
import { Switch } from '../ui/switch';
import type { AddType, Recurrence } from '../../types';
import { useApp } from '../../context/AppContext';
import { newCategory } from '../../categoryLogic';
import { colorHex, PALETTE_COMPACT } from '../../colors';
import { buildCreate, type EventRepeat } from '../../createItem';
import { REMINDER_QUICK, reminderLabel } from '../../reminders';
import { addMinutes, fmt, nowFloor15, rotateWeek } from '../../dates';
import { movedEnd } from '../../eventLogic';
import { stripMatch, type NlDateMatch } from '../../nlDate';
import DateField from '../forms/DateField';
import { NlDateSuggestion, useNlSuggestion } from '../forms/NlDateSuggestion';
import RepeatField, { buildRepeat, draftFromRepeat, repeatError, type RepeatDraft } from '../forms/RepeatField';
import { ColorPicker, Select } from '../forms/shared';
import { useModalDismiss } from '../ui/useModalDismiss';
import { useSpringHeight } from '../ui/useSpringHeight';
import { FIELD_ROW, PLACEHOLDERS, REPEAT_OPTIONS, SCOPE_FOR, SECTIONS, type FieldKey, type Props } from './catalog';
import { FieldRow, SectionGroup } from './parts';

const REPEAT_LABELS: Record<EventRepeat, string> = {
  Never: "Doesn't repeat",
  Daily: 'Daily',
  Weekdays: 'Every weekday (Mon–Fri)',
  Weekly: 'Weekly',
  Monthly: 'Monthly',
  Yearly: 'Yearly',
  Custom: 'Custom…',
};

const WEEKDAY_OPTIONS = [
  { day: 0, label: 'S' },
  { day: 1, label: 'M' },
  { day: 2, label: 'T' },
  { day: 3, label: 'W' },
  { day: 4, label: 'T' },
  { day: 5, label: 'F' },
  { day: 6, label: 'S' },
];

export function CreateModal({
  onClose,
  defaultDate,
  defaultStartTime,
  defaultTitle,
  defaultType,
  defaultCategory,
  onSubmit,
  snappiness = 1,
}: Props) {
  const { addEvent, addTodo, selectedDate, categories, categoriesFor, addCategory, firstDayOfWeek } = useApp();
  const initialDate = defaultDate ?? selectedDate ?? fmt(new Date());
  const initialStart = defaultStartTime ?? nowFloor15();

  const [type, setType] = useState<AddType>(defaultType ?? 'event');
  const [title, setTitle] = useState(defaultTitle ?? '');
  const [on, setOn] = useState<Record<AddType, Set<FieldKey>>>({
    event: new Set(),
    task: new Set<FieldKey>(defaultCategory ? ['category'] : []),
    habit: new Set(),
  });
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialDate);
  const [endTime, setEndTime] = useState(addMinutes(initialStart, 60));
  const [dueDate, setDueDate] = useState(initialDate);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [schedule, setSchedule] = useState<RepeatDraft>(() => draftFromRepeat({ type: 'daily' }));
  const [repeat, setRepeat] = useState<EventRepeat>('Never');
  const [eventUntil, setEventUntil] = useState('');
  const [eventInterval, setEventInterval] = useState('1');
  const [eventUnit, setEventUnit] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [eventWeekdays, setEventWeekdays] = useState<number[]>([]);
  const [important, setImportant] = useState(false);
  const [category, setCategory] = useState(defaultCategory ?? '');
  const [target, setTarget] = useState(1);
  /** Lead times (minutes) switched on; 10 minutes to begin with. */
  const [reminders, setReminders] = useState<Record<number, boolean>>({ 10: true });
  const [customRemOpen, setCustomRemOpen] = useState(false);
  const [customRemAmount, setCustomRemAmount] = useState('15');
  const [customRemUnit, setCustomRemUnit] = useState<'minutes' | 'hours' | 'days' | 'weeks'>('minutes');
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState<string>(PALETTE_COMPACT[0]);
  const [error, setError] = useState('');

  const catOptions = categoriesFor(SCOPE_FOR[type]);
  const categoryFieldLabel = type === 'task' ? 'List' : 'Category';

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
        setsDue: false,
      };
    }
    // task and habit both drive the (otherwise event-only-visible) due date.
    return {
      title: newTitle,
      startDate,
      endDate,
      startTime,
      endTime,
      dueDate: match.start.date,
      setsDue: type === 'task',
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
    if (next.setsDue) addOn('due');
    setDateTouched(true);
  }

  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const measure = useSpringHeight(cardRef, innerRef, snappiness);
  // Re-measure as soon as a row set changes, ahead of the observer.
  useEffect(() => {
    measure();
  }, [type, on, allDay, suggestion, measure]);

  // Leaving with a title saves it — same as the edit modal. Only the Cancel
  // button is an explicit "throw this away". A half-built repeat rule must
  // not hold the modal open here, so it falls back to daily.
  const dismiss = () => {
    if (canSubmit) handleSubmit({ lenient: true });
    else onClose();
  };
  useModalDismiss(dismiss);

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

  const sectionOpen = (keys: FieldKey[]) => keys.some((k) => on[type].has(k));
  const toggleSection = (keys: FieldKey[]) => {
    const open = sectionOpen(keys);
    for (const k of keys) {
      if (open) removeOn(k);
      else addOn(k);
    }
  };
  const collapseSectionOf = (key: FieldKey) => {
    const sec = SECTIONS[type].find((x) => x.keys.includes(key));
    for (const k of sec?.keys ?? [key]) removeOn(k);
  };

  const handleTypeChange = (newType: AddType) => {
    setType(newType);
    setError('');
  };

  const canSubmit = title.trim().length > 0;

  const handleSubmit = ({ lenient = false } = {}) => {
    if (!canSubmit) return;

    // A habit's repeat rule (only while its section is open): an invalid
    // draft blocks an explicit Add with a message, but a dismiss (scrim,
    // Escape, back) saves it as daily instead.
    let habitSchedule = buildRepeat(schedule);
    if (type === 'habit' && on.habit.has('repeat') && !habitSchedule) {
      if (!lenient) {
        setError(repeatError(schedule));
        return;
      }
      habitSchedule = { type: 'daily' };
    }

    // An undismissed suggestion the user never hand-edited a date field for
    // (nor already applied) gets folded in here — computed rather than read
    // back from state, since `setState` inside this same call wouldn't be
    // visible until the next render.
    const applied = !dateTouched && suggestion ? computeApplied(suggestion) : null;
    const sTitle = applied?.title ?? title;
    const sStartDate = applied?.startDate ?? startDate;
    const sEndDate = applied?.endDate ?? endDate;
    const sStartTime = applied?.startTime ?? startTime;
    const sEndTime = applied?.endTime ?? endTime;
    const sDueDate = applied?.dueDate ?? dueDate;

    const active = applied?.setsDue ? new Set([...on[type], 'due' as FieldKey]) : on[type];
    const name = sTitle.trim();

    // A field only reaches the payload if its row is actually showing — an
    // unrevealed chip's state is a default, not a choice the user made.
    const has = (k: FieldKey) => active.has(k);
    const reminderMins = has('reminder')
      ? Object.keys(reminders)
          .map(Number)
          .filter((m) => reminders[m])
          .sort((a, b) => a - b)
      : [];

    let eventRecurrence: Recurrence | undefined;
    if (type === 'event' && has('repeat')) {
      const n = parseInt(eventInterval, 10);
      const safeN = Number.isFinite(n) && n > 0 ? n : 1;
      const u = eventUntil || null;
      if (repeat === 'Never') eventRecurrence = { type: 'none' };
      else if (repeat === 'Daily') eventRecurrence = { type: 'daily', interval: 1, until: u };
      else if (repeat === 'Weekdays') eventRecurrence = { type: 'weekdays', until: u };
      else if (repeat === 'Weekly')
        eventRecurrence = {
          type: 'weekly',
          interval: 1,
          until: u,
          ...(eventWeekdays.length ? { days: eventWeekdays } : {}),
        };
      else if (repeat === 'Monthly') eventRecurrence = { type: 'monthly', interval: 1, until: u };
      else if (repeat === 'Yearly') eventRecurrence = { type: 'yearly', interval: 1, until: u };
      else if (repeat === 'Custom') {
        eventRecurrence = {
          type: eventUnit,
          interval: safeN,
          until: u,
          ...(eventUnit === 'weekly' && eventWeekdays.length ? { days: eventWeekdays } : {}),
        };
      }
    }

    const payload = buildCreate(type, name, {
      startDate: sStartDate,
      startTime: type === 'event' ? sStartTime : null,
      endDate: sEndDate,
      endTime: sEndTime,
      allDay: has('allday') ? allDay : false,
      dueDate: type === 'task' ? (has('due') ? sDueDate || null : null) : sDueDate,
      location: has('location') ? location : '',
      description: has('desc') ? description : '',
      repeat: has('repeat') ? repeat : 'Never',
      eventRecurrence,
      schedule: has('repeat') ? (habitSchedule ?? undefined) : undefined,
      important,
      category: has('category') ? category : '',
      target: has('target') ? target : 1,
      reminderMins,
    });
    if (payload.kind === 'event') addEvent(payload.event);
    else addTodo(payload.todo);

    onSubmit?.({
      type,
      title: name,
      fields: {
        allDay,
        startDate: sStartDate,
        startTime: sStartTime,
        endDate: sEndDate,
        endTime: sEndTime,
        dueDate: sDueDate,
        location,
        description,
        schedule: habitSchedule,
        repeat,
        important,
        category,
        target,
        reminders,
      },
    });
    onClose();
  };

  const currentOn = on[type];

  // One row per optional field; a section shows the rows of its keys. The
  // × on a row collapses the whole section, the same as its header.
  const rows: Record<FieldKey, ReactNode> = {
    allday: currentOn.has('allday') && type === 'event' && (
      <FieldRow label="All-day" onRemove={() => collapseSectionOf('allday')}>
        <Switch checked={allDay} onCheckedChange={setAllDay} aria-label="All-day" />
        <div className="flex-1" />
      </FieldRow>
    ),
    repeat: currentOn.has('repeat') && (
      <FieldRow label="Repeat" align="start" onRemove={() => collapseSectionOf('repeat')}>
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
              value={repeat}
              onChange={(val) => setRepeat(val as EventRepeat)}
            />
            {(repeat === 'Weekly' || (repeat === 'Custom' && eventUnit === 'weekly')) && (
              <div className="flex gap-xs">
                {rotateWeek(WEEKDAY_OPTIONS, firstDayOfWeek).map(({ day, label }) => {
                  const active = eventWeekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setEventWeekdays((prev) =>
                          prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
                        )
                      }
                      className={`flex-1 h-7 text-meta font-bold transition-all cursor-pointer ${
                        active ? 'bg-accent text-on-accent' : 'bg-subtle-strong text-ink-muted hover:bg-line-strong'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {repeat === 'Custom' && (
              <div className="flex items-center gap-2 flex-wrap text-sm text-ink-muted">
                <span>Every</span>
                <input
                  type="number"
                  min="1"
                  className="field-input w-16 text-center"
                  value={eventInterval}
                  onChange={(e) => setEventInterval(e.target.value)}
                />
                <Select
                  options={[
                    { value: 'daily', label: 'day(s)' },
                    { value: 'weekly', label: 'week(s)' },
                    { value: 'monthly', label: 'month(s)' },
                    { value: 'yearly', label: 'year(s)' },
                  ]}
                  value={eventUnit}
                  onChange={(u) => setEventUnit(u as any)}
                />
              </div>
            )}
            {repeat !== 'Never' && (
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <span>until</span>
                <DateField
                  value={eventUntil}
                  onChange={setEventUntil}
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
    due: currentOn.has('due') && type === 'task' && (
      <FieldRow label="Due" onRemove={() => collapseSectionOf('due')}>
        <DateField
          className="flex-1"
          aria-label="Due date"
          value={dueDate}
          onChange={(next) => {
            setDueDate(next);
            setDateTouched(true);
          }}
        />
      </FieldRow>
    ),
    category: currentOn.has('category') && (
      <FieldRow label={categoryFieldLabel} align="start" onRemove={() => collapseSectionOf('category')}>
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
    target: currentOn.has('target') && type === 'habit' && (
      <FieldRow label="Target" onRemove={() => collapseSectionOf('target')}>
        <div className="flex items-center border border-line">
          <button
            type="button"
            aria-label="Decrease target"
            onClick={() => setTarget(Math.max(1, target - 1))}
            className="size-[1.875rem] bg-surface border-0 border-r border-line text-ink-secondary text-base cursor-pointer transition-colors hover:bg-subtle hover:text-accent"
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
            className="size-[1.875rem] bg-surface border-0 border-l border-line text-ink-secondary text-base cursor-pointer transition-colors hover:bg-subtle hover:text-accent"
          >
            +
          </button>
        </div>
        <div className="flex-1" />
      </FieldRow>
    ),
    reminder: currentOn.has('reminder') && (
      <FieldRow label="Remind" align="start" onRemove={() => collapseSectionOf('reminder')}>
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
                onChange={(u) => setCustomRemUnit(u as 'minutes' | 'hours' | 'days' | 'weeks')}
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
                  const mins = n * mult;
                  setReminders((prev) => ({ ...prev, [mins]: true }));
                  setCustomRemOpen(false);
                }}
              >
                Add
              </Button>
            </div>
          )}
        </div>
      </FieldRow>
    ),
    location: currentOn.has('location') && type === 'event' && (
      <FieldRow label="Where" onRemove={() => collapseSectionOf('location')}>
        <input
          placeholder="Room, address or link"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="field-input flex-1"
        />
      </FieldRow>
    ),
    desc: currentOn.has('desc') && (
      <FieldRow label="Notes" align="start" onRemove={() => collapseSectionOf('desc')}>
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

  return (
    <ModalChrome
      title={type === 'event' ? 'New event' : type === 'task' ? 'New task' : 'New habit'}
      onClose={dismiss}
      cardRef={cardRef}
      innerRef={innerRef}
      footer={
        <>
          <span className="text-xs text-icon-idle">{canSubmit ? 'Enter to save' : ''}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => handleSubmit()} disabled={!canSubmit}>
              Add {type === 'event' ? 'event' : type === 'task' ? 'task' : 'habit'}
            </Button>
          </div>
        </>
      }
    >
      {/* Type segmented control */}
      <div className="px-5 pt-[0.875rem]">
        <Segmented fill aria-label="Type" options={[...typeOptions]} value={type} onChange={handleTypeChange} />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-[0.875rem] px-5 pt-[1.125rem] pb-1">
        {/* Title input, with the star beside it for tasks */}
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            autoFocus
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
    </ModalChrome>
  );
}
