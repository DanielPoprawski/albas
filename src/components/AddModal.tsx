import { useRef, useEffect, useState, useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { ModalChrome } from './ui/modal-chrome';
import { Segmented } from './ui/segmented';
import { Dot } from './ui/tag';
import { Switch } from './ui/switch';
import type { AddType, CalendarEvent, CategoryScope, Todo } from '../types';
import { useApp } from '../context/AppContext';
import { colorHex, DEFAULT_COLOR, PALETTE_COMPACT } from '../colors';
import { buildCreate, type EventRepeat, type HabitFreq, type Priority } from '../createItem';
import { addDays, addMinutes, diffDays, fmt, nowFloor15 } from '../dates';
import { describeWhen, stripMatch, useNlDate, type NlDateMatch } from '../nlDate';
import TodoForm from './forms/TodoForm';
import EventForm from './forms/EventForm';
import DateField from './forms/DateField';
import type { CommitResult } from './forms/shared';
import { useModalDismiss } from './ui/useModalDismiss';

type FieldKey =
  | 'allday'
  | 'repeat'
  | 'reminder'
  | 'location'
  | 'color'
  | 'desc'
  | 'due'
  | 'priority'
  | 'category'
  | 'target';

const CATALOG: Record<AddType, Array<{ key: FieldKey; label: string }>> = {
  event: [
    { key: 'allday', label: 'All-day' },
    { key: 'repeat', label: 'Repeat' },
    { key: 'reminder', label: 'Reminder' },
    { key: 'location', label: 'Location' },
    { key: 'category', label: 'Category' },
    { key: 'color', label: 'Color' },
    { key: 'desc', label: 'Description' },
  ],
  task: [
    { key: 'due', label: 'Due date' },
    { key: 'priority', label: 'Priority' },
    { key: 'category', label: 'List' },
    { key: 'reminder', label: 'Reminder' },
    { key: 'desc', label: 'Description' },
  ],
  habit: [
    { key: 'target', label: 'Daily target' },
    { key: 'category', label: 'Category' },
    { key: 'reminder', label: 'Reminder' },
    { key: 'color', label: 'Color' },
    { key: 'desc', label: 'Description' },
  ],
};

const PLACEHOLDERS: Record<AddType, string> = {
  event: 'Team sync, dentist, flight…',
  task: 'What needs doing?',
  habit: 'Read, run, meditate…',
};

/** Which `categoriesFor()` scope each Add-modal type's category chip offers. */
const SCOPE_FOR: Record<AddType, CategoryScope> = { event: 'calendar', task: 'tasks', habit: 'habits' };

const PALETTE = PALETTE_COMPACT;

/** One optional field's row, revealed with the `rowIn` keyframes (App.css). */
const FIELD_ROW = 'flex items-center gap-2.5 animate-[rowIn_0.2s_ease_both] motion-reduce:animate-none';

interface Props {
  onClose: () => void;
  /** Edit an existing to-do (task/habit/chore) — mounts the full TodoForm. */
  editTodo?: Todo;
  /** Edit an existing event — mounts the full EventForm. */
  editEvent?: CalendarEvent;
  /** Start date of the occurrence that was clicked (recurring-event deletes). */
  editEventDate?: string | null;
  /** Pre-fill the date fields, e.g. when adding from a calendar day. */
  defaultDate?: string | null;
  /** Pre-fill the start time (`HH:MM`), e.g. when adding from an hour slot. */
  defaultStartTime?: string;
  /** Pre-fill the title, e.g. what a quick-add line already holds. */
  defaultTitle?: string;
  defaultType?: AddType;
  /** Pre-fill (and switch on) the task's List by category id, e.g. from a category header. */
  defaultCategory?: string;
  /** Optional observer. The modal persists by itself either way. */
  onSubmit?: (data: SubmitData) => void;
  snappiness?: number;
}

export interface SubmitData {
  type: AddType;
  title: string;
  fields: Record<string, any>;
}

/** Reminder chip label → lead time in minutes before the start. */
const REMINDER_MINUTES: Record<string, number> = {
  'At time': 0,
  '10 min': 10,
  '1 hour': 60,
  '1 day': 1440,
};

const REPEAT_OPTIONS: EventRepeat[] = ['Never', 'Daily', 'Weekly', 'Monthly'];
const FREQ_OPTIONS: HabitFreq[] = ['Daily', 'Weekdays', 'Weekly'];
const PRIORITY_OPTIONS: Priority[] = ['Low', 'Normal', 'High'];

/**
 * Two modes behind one prop surface:
 * - **create** — the redesigned chip UI, wired straight to addEvent/addTodo.
 * - **edit** — the existing EventForm/TodoForm inside the same chrome. They
 *   already own update, delete, and the recurring "this / all / from here"
 *   choices, none of which the chip UI has controls for.
 */
export default function AddModal(props: Props) {
  if (props.editTodo || props.editEvent) return <EditModal {...props} />;
  return <CreateModal {...props} />;
}

/** One optional field: caps label, control, and the "×" that removes it. */
function FieldRow({
  label,
  onRemove,
  align = 'center',
  children,
}: {
  label: string;
  onRemove: () => void;
  /** `start` for a control taller than one line (chips, textarea). */
  align?: 'center' | 'start';
  children: ReactNode;
}) {
  const top = align === 'start';
  return (
    <div className={cn(FIELD_ROW, top && 'items-start')}>
      <span className={cn('micro-label w-[4.625rem] shrink-0', top && 'pt-[0.3125rem]')}>{label}</span>
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className={cn(
          'flex size-[1.375rem] shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-icon-idle transition-colors hover:text-ink',
          top && 'mt-1',
        )}
      >
        <X size="0.6875rem" strokeWidth={2.4} />
      </button>
    </div>
  );
}

/** A square colour swatch; the selected one carries an ink outline. */
function Swatch({
  hex,
  selected,
  onClick,
  className,
}: {
  hex: string;
  selected: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={hex}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'shrink-0 border-0 cursor-pointer outline-2 outline-offset-2 transition-[outline-color]',
        selected ? 'outline-ink' : 'outline-transparent',
        className,
      )}
      // dynamic: the swatch is the colour it offers
      style={{ background: hex }}
    />
  );
}

/**
 * Leaving an edit saves it. Every dismissal — scrim, ×, Escape, Android
 * back — runs the form's `commit()` first and only stays open when the
 * form has something it cannot save (an end before its start). An untouched
 * form is a no-op, so idly opening and closing never writes a row.
 */
function EditModal({ onClose, editTodo, editEvent, editEventDate, defaultDate }: Props) {
  const commitRef = useRef<(() => CommitResult) | null>(null);
  const dismiss = () => {
    const result = commitRef.current?.() ?? 'empty';
    if (result !== 'invalid') onClose();
  };
  useModalDismiss(dismiss);

  return (
    <ModalChrome title={editEvent ? 'Edit event' : 'Edit to-do'} onClose={dismiss}>
      <div className="px-5 pt-[1.125rem] pb-5">
        {editTodo ? (
          <TodoForm edit={editTodo} defaultDate={defaultDate} onDone={onClose} commitRef={commitRef} />
        ) : (
          <EventForm
            edit={editEvent}
            occurrenceDate={editEventDate}
            defaultDate={defaultDate}
            onDone={onClose}
            commitRef={commitRef}
          />
        )}
      </div>
    </ModalChrome>
  );
}

function CreateModal({
  onClose,
  defaultDate,
  defaultStartTime,
  defaultTitle,
  defaultType,
  defaultCategory,
  onSubmit,
  snappiness = 1,
}: Props) {
  const { addEvent, addTodo, selectedDate, categoriesFor, addCategory } = useApp();
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
  const [freq, setFreq] = useState<HabitFreq>('Daily');
  const [repeat, setRepeat] = useState<EventRepeat>('Never');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [category, setCategory] = useState(defaultCategory ?? '');
  const [target, setTarget] = useState(1);
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  // Whether the user has actually clicked a swatch in the Color field — an
  // event's color follows its category (below) only until this happens.
  const [colorTouched, setColorTouched] = useState(false);
  const [reminders, setReminders] = useState<Record<string, boolean>>({ '10 min': true });
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState<string>(PALETTE[0]);

  const catOptions = categoriesFor(SCOPE_FOR[type]);
  const categoryFieldLabel = CATALOG[type].find((c) => c.key === 'category')?.label ?? 'Category';

  function createCategory() {
    const name = newCatName.trim();
    if (!name) return;
    const created = addCategory({ name, colorKey: newCatColor, scopes: [SCOPE_FOR[type]], sort: catOptions.length });
    setCategory(created.id);
    setNewCatOpen(false);
    setNewCatName('');
  }

  // Natural-language date suggestion (Phase H). `dateTouched` tracks whether
  // the user has hand-edited any date/time field or already used Apply — a
  // suggestion only auto-applies on submit when nothing has, so it never
  // silently overrides a date the user actually chose.
  const suggestion = useNlDate(title);
  const suggestionKey = suggestion ? `${suggestion.matched.index}:${suggestion.matched.text}` : null;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const dismissed = suggestionKey !== null && suggestionKey === dismissedKey;
  const showSuggestion = suggestion != null && !dismissed;
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
  const rafRef = useRef<number | null>(null);
  const heightRef = useRef<number | null>(null);
  const velocityRef = useRef<number>(0);
  const targetHeightRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const roRef = useRef<ResizeObserver | null>(null);

  // Spring physics integration
  const tick = useCallback(() => {
    if (rafRef.current) return;

    const k = 190 * snappiness;
    const d = 2 * Math.sqrt(k) * 0.92;
    lastTimeRef.current = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.032, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;

      if (heightRef.current == null || targetHeightRef.current == null) return;

      const err = targetHeightRef.current - heightRef.current;
      velocityRef.current += (k * err - d * velocityRef.current) * dt;
      heightRef.current += velocityRef.current * dt;

      if (cardRef.current) {
        cardRef.current.style.height = Math.round(heightRef.current) + 'px';
      }

      // Stop when settled
      if (Math.abs(targetHeightRef.current - heightRef.current) < 0.4 && Math.abs(velocityRef.current) < 6) {
        heightRef.current = targetHeightRef.current;
        velocityRef.current = 0;
        rafRef.current = null;
        if (cardRef.current) {
          cardRef.current.style.height = Math.round(targetHeightRef.current) + 'px';
        }
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
  }, [snappiness]);

  // Measure content height and start spring animation
  const measure = useCallback(() => {
    if (!innerRef.current || !cardRef.current) return;

    const target = Math.min(innerRef.current.scrollHeight, Math.round(window.innerHeight * 0.88));
    if (target === targetHeightRef.current) return;

    targetHeightRef.current = target;

    if (heightRef.current == null) {
      heightRef.current = target;
      velocityRef.current = 0;
      if (cardRef.current) {
        cardRef.current.style.height = Math.round(target) + 'px';
      }
      return;
    }

    // Respect prefers-reduced-motion: snap instantly instead of animating
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      heightRef.current = target;
      velocityRef.current = 0;
      if (cardRef.current) {
        cardRef.current.style.height = Math.round(target) + 'px';
      }
      return;
    }

    tick();
  }, [tick]);

  // Set up ResizeObserver to measure on content change
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;

    roRef.current = new ResizeObserver(() => measure());
    if (innerRef.current) {
      roRef.current.observe(innerRef.current);
    }

    measure();

    return () => {
      if (roRef.current) {
        roRef.current.disconnect();
      }
    };
  }, [measure]);

  // Re-measure on content changes
  useEffect(() => {
    measure();
  }, [type, on, allDay, showSuggestion, measure]);

  // Leaving with a title saves it — same as the edit modal. Only the Cancel
  // button is an explicit "throw this away".
  const dismiss = () => {
    if (canSubmit) handleSubmit();
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

  const handleTypeChange = (newType: AddType) => {
    setType(newType);
  };

  const canSubmit = title.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;

    // An undismissed suggestion the user never hand-edited a date field for
    // (nor already applied) gets folded in here — computed rather than read
    // back from state, since `setState` inside this same call wouldn't be
    // visible until the next render.
    const applied = !dateTouched && suggestion && !dismissed ? computeApplied(suggestion) : null;
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
          .filter((r) => reminders[r])
          .map((r) => REMINDER_MINUTES[r])
          .sort((a, b) => a - b)
      : [];

    const payload = buildCreate(
      type,
      name,
      {
        startDate: sStartDate,
        startTime: type === 'event' ? sStartTime : null,
        endDate: sEndDate,
        endTime: sEndTime,
        allDay: has('allday') ? allDay : false,
        dueDate: type === 'task' ? (has('due') ? sDueDate || null : null) : sDueDate,
        location: has('location') ? location : '',
        description: has('desc') ? description : '',
        repeat: has('repeat') ? repeat : 'Never',
        freq,
        priority: has('priority') ? priority : 'Normal',
        category: has('category') ? category : '',
        target: has('target') ? target : 1,
        // A category's colour wins over the default, but never over a colour
        // the user actually picked in the Color field.
        color: has('color') && (type !== 'event' || colorTouched) ? color : undefined,
        reminderMins,
      },
      catOptions,
    );
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
        freq,
        repeat,
        priority,
        category,
        target,
        color,
        reminders,
      },
    });
    onClose();
  };

  const currentOn = on[type];
  const availableChips = CATALOG[type].filter((c) => !currentOn.has(c.key));

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
            <Button onClick={handleSubmit} disabled={!canSubmit}>
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
        {/* Title input */}
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
          className="w-full border-0 border-b-2 border-line bg-transparent pt-1 pb-2 text-lg font-medium text-ink transition-colors duration-150 placeholder:text-ink-muted focus:border-accent"
        />

        {/* Natural-language date suggestion (Phase H) — appears the moment
            a date/time phrase is recognised in the title, disappears the
            moment it's applied (the phrase is stripped) or dismissed. */}
        {suggestion && !dismissed && (
          <div className={cn(FIELD_ROW, 'justify-between -mt-2')}>
            <span className="text-sm text-ink-muted truncate">
              {'→ '}
              <span className="text-accent font-semibold">{describeWhen(suggestion)}</span>
              {' — from “'}
              {suggestion.matched.text}
              {'”'}
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => applySuggestion(suggestion)}
                className="text-sm font-semibold text-accent hover:underline"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => setDismissedKey(suggestionKey)}
                aria-label="Dismiss date suggestion"
                className="flex items-center text-ink-muted hover:text-ink"
              >
                <X size="0.6875rem" strokeWidth={2.4} />
              </button>
            </span>
          </div>
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
                  if (next && startDate && endDate) {
                    const shift = diffDays(startDate, next);
                    if (shift !== 0) setEndDate(addDays(endDate, shift));
                  }
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

        {/* Habit repeats */}
        {type === 'habit' && (
          <div className="flex flex-col gap-[0.4375rem]">
            <span className="micro-label">Repeats</span>
            <Segmented
              fill
              aria-label="Repeats"
              options={FREQ_OPTIONS.map((f) => ({ value: f, label: f }))}
              value={freq}
              onChange={setFreq}
            />
          </div>
        )}

        {/* Optional fields - All-day */}
        {currentOn.has('allday') && type === 'event' && (
          <FieldRow label="All-day" onRemove={() => removeOn('allday')}>
            <Switch checked={allDay} onCheckedChange={setAllDay} aria-label="All-day" />
            <div className="flex-1" />
          </FieldRow>
        )}

        {/* Optional fields - Repeat (events) */}
        {currentOn.has('repeat') && type === 'event' && (
          <FieldRow label="Repeat" onRemove={() => removeOn('repeat')}>
            <Segmented
              fill
              aria-label="Repeat"
              className="flex-1"
              options={REPEAT_OPTIONS.map((r) => ({ value: r, label: r }))}
              value={repeat}
              onChange={setRepeat}
            />
          </FieldRow>
        )}

        {/* Optional fields - Due date */}
        {currentOn.has('due') && type === 'task' && (
          <FieldRow label="Due" onRemove={() => removeOn('due')}>
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
        )}

        {/* Optional fields - Priority */}
        {currentOn.has('priority') && type === 'task' && (
          <FieldRow label="Priority" onRemove={() => removeOn('priority')}>
            <Segmented
              fill
              aria-label="Priority"
              className="flex-1"
              options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
              value={priority}
              onChange={setPriority}
            />
          </FieldRow>
        )}

        {/* Optional fields - Category/List */}
        {currentOn.has('category') && (
          <FieldRow label={categoryFieldLabel} align="start" onRemove={() => removeOn('category')}>
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
                <div className={cn(FIELD_ROW, 'gap-1.5')}>
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
                    className="field-input flex-1"
                  />
                  {PALETTE.map((c) => (
                    <Swatch
                      key={c}
                      hex={c}
                      selected={newCatColor === c}
                      onClick={() => setNewCatColor(c)}
                      className="size-[1.125rem] outline-offset-1"
                    />
                  ))}
                  <Button size="sm" onClick={createCategory} disabled={!newCatName.trim()} className="shrink-0">
                    Add
                  </Button>
                </div>
              )}
            </div>
          </FieldRow>
        )}

        {/* Optional fields - Daily target */}
        {currentOn.has('target') && type === 'habit' && (
          <FieldRow label="Target" onRemove={() => removeOn('target')}>
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
        )}

        {/* Optional fields - Reminder */}
        {currentOn.has('reminder') && (
          <FieldRow label="Remind" align="start" onRemove={() => removeOn('reminder')}>
            <div className="flex-1 flex flex-wrap gap-1.5">
              {['At time', '10 min', '1 hour', '1 day'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setReminders((prev) => {
                      const next = { ...prev };
                      if (next[r]) delete next[r];
                      else next[r] = true;
                      return next;
                    });
                  }}
                  className="chip border-solid"
                  data-selected={reminders[r] || undefined}
                >
                  {r}
                </button>
              ))}
            </div>
          </FieldRow>
        )}

        {/* Optional fields - Color */}
        {currentOn.has('color') && (
          <FieldRow label="Color" onRemove={() => removeOn('color')}>
            <div className="flex-1 flex flex-wrap gap-[0.4375rem]">
              {PALETTE.map((c) => (
                <Swatch
                  key={c}
                  hex={c}
                  selected={color === c}
                  onClick={() => {
                    setColor(c);
                    setColorTouched(true);
                  }}
                  className="size-5"
                />
              ))}
            </div>
          </FieldRow>
        )}

        {/* Optional fields - Location */}
        {currentOn.has('location') && type === 'event' && (
          <FieldRow label="Where" onRemove={() => removeOn('location')}>
            <input
              placeholder="Room, address or link"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="field-input flex-1"
            />
          </FieldRow>
        )}

        {/* Optional fields - Description */}
        {currentOn.has('desc') && (
          <FieldRow label="Notes" align="start" onRemove={() => removeOn('desc')}>
            <textarea
              placeholder="Details, links…"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="field-input flex-1 resize-y leading-normal"
            />
          </FieldRow>
        )}

        {/* Add field chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-[2px] pb-4">
          {availableChips.map((chip) => (
            <button key={chip.key} type="button" onClick={() => addOn(chip.key)} className="chip">
              <span className="text-sm leading-none">+</span>
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    </ModalChrome>
  );
}
