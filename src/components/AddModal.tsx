import { useRef, useEffect, useState, useCallback } from 'react';
import type { AddType, CalendarEvent, Recurrence, Repeat, Todo } from '../types';
import { useApp } from '../context/AppContext';
import { DEFAULT_COLOR, TODO_CATEGORIES } from '../colors';
import { fmt } from '../dates';
import TodoForm from './forms/TodoForm';
import EventForm from './forms/EventForm';

type FieldKey = 'allday' | 'repeat' | 'reminder' | 'location' | 'color' | 'desc' | 'due' | 'priority' | 'category' | 'target';

const CATALOG: Record<AddType, Array<{ key: FieldKey; label: string }>> = {
  event: [
    { key: 'allday', label: 'All-day' },
    { key: 'repeat', label: 'Repeat' },
    { key: 'reminder', label: 'Reminder' },
    { key: 'location', label: 'Location' },
    { key: 'color', label: 'Color' },
    { key: 'desc', label: 'Description' }
  ],
  task: [
    { key: 'due', label: 'Due date' },
    { key: 'priority', label: 'Priority' },
    { key: 'category', label: 'List' },
    { key: 'reminder', label: 'Reminder' },
    { key: 'desc', label: 'Description' }
  ],
  habit: [
    { key: 'target', label: 'Daily target' },
    { key: 'reminder', label: 'Reminder' },
    { key: 'color', label: 'Color' },
    { key: 'desc', label: 'Description' }
  ]
};

const PLACEHOLDERS: Record<AddType, string> = {
  event: 'Team sync, dentist, flight…',
  task: 'What needs doing?',
  habit: 'Read, run, meditate…'
};

// Suggestions, not an enumeration — `Todo.category` is free text. The list and
// its colours live in `src/colors.ts` so the Add modal and the To-Do sidebar
// cannot disagree about what colour "Work" is; they used to.
const CATEGORIES = TODO_CATEGORIES.map(c => ({ label: c.label, color: c.hex }));

const PALETTE = ['#a855f7', '#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#6b7280'];

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
  defaultType?: AddType;
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
  '1 day': 1440
};

const REPEAT_OPTIONS = ['Never', 'Daily', 'Weekly', 'Monthly'] as const;

/** Now, rounded down to a quarter hour. */
function nowFloor15(): string {
  const d = new Date();
  d.setMinutes(Math.floor(d.getMinutes() / 15), 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `hh:mm` plus N minutes, clamped to 23:59. */
function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

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

function EditModal({ onClose, editTodo, editEvent, editEventDate, defaultDate }: Props) {
  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center', padding: '6vh 32px 32px 32px',
        background: 'var(--t-scrim)', backdropFilter: 'blur(3px)', zIndex: 50
      }}
    >
      <div
        style={{
          width: '470px', maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto',
          background: 'var(--t-surface)', border: '1px solid var(--t-border)',
          boxShadow: 'var(--shadow-modal)',
          animation: 'modalIn .22s cubic-bezier(.2,.8,.3,1) both'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '18px 20px 0 20px' }}>
          <div style={{ fontFamily: 'var(--t-font-heading)', fontSize: '16px', fontWeight: 600, letterSpacing: '-.01em' }}>
            {editEvent ? 'Edit event' : 'Edit to-do'}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: '26px', height: '26px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: 'transparent', border: 'none',
              color: 'var(--t-ink-muted)', cursor: 'pointer'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
          </button>
        </div>
        <div style={{ padding: '18px 20px 20px 20px' }}>
          {editTodo
            ? <TodoForm edit={editTodo} defaultDate={defaultDate} onDone={onClose} />
            : <EventForm edit={editEvent} occurrenceDate={editEventDate} defaultDate={defaultDate} onDone={onClose} />}
        </div>
      </div>
    </div>
  );
}

function CreateModal({ onClose, defaultDate, defaultType, onSubmit, snappiness = 1 }: Props) {
  const { addEvent, addTodo, selectedDate } = useApp();
  const initialDate = defaultDate ?? selectedDate ?? fmt(new Date());
  const initialStart = nowFloor15();

  const [type, setType] = useState<AddType>(defaultType ?? 'event');
  const [title, setTitle] = useState('');
  const [on, setOn] = useState<Record<AddType, Set<FieldKey>>>({
    event: new Set(),
    task: new Set(),
    habit: new Set()
  });
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialDate);
  const [endTime, setEndTime] = useState(addMinutes(initialStart, 60));
  const [dueDate, setDueDate] = useState(initialDate);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [freq, setFreq] = useState('Daily');
  const [repeat, setRepeat] = useState<string>('Never');
  const [priority, setPriority] = useState('Normal');
  const [category, setCategory] = useState('Personal');
  const [target, setTarget] = useState(1);
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [reminders, setReminders] = useState<Record<string, boolean>>({ '10 min': true });

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
  }, [type, on, allDay, measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addOn = (key: FieldKey) => {
    setOn(prev => ({
      ...prev,
      [type]: new Set([...prev[type], key])
    }));
  };

  const removeOn = (key: FieldKey) => {
    setOn(prev => {
      const newSet = new Set(prev[type]);
      newSet.delete(key);
      return {
        ...prev,
        [type]: newSet
      };
    });
  };

  const handleTypeChange = (newType: AddType) => {
    setType(newType);
  };

  const canSubmit = title.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const active = on[type];
    const name = title.trim();

    // A field only reaches the payload if its row is actually showing — an
    // unrevealed chip's state is a default, not a choice the user made.
    const has = (k: FieldKey) => active.has(k);
    const notes = has('desc') ? description.trim() : '';
    const reminderMins = has('reminder')
      ? Object.keys(reminders).filter(r => reminders[r]).map(r => REMINDER_MINUTES[r]).sort((a, b) => a - b)
      : [];

    if (type === 'event') {
      const where = has('location') ? location.trim() : '';
      // CalendarEvent has no `location` column; the design's Where field folds
      // into the description rather than inventing a schema change.
      const desc = [where && `Location: ${where}`, notes].filter(Boolean).join('\n\n');
      const effAllDay = has('allday') ? allDay : false;
      const effEnd = endDate < startDate ? startDate : endDate;
      let recurrence: Recurrence = { type: 'none' };
      if (has('repeat')) {
        if (repeat === 'Daily') recurrence = { type: 'daily', interval: 1 };
        else if (repeat === 'Weekly') recurrence = { type: 'weekly', interval: 1 };
        else if (repeat === 'Monthly') recurrence = { type: 'monthly', interval: 1 };
      }
      addEvent({
        title: name,
        description: desc,
        colorKey: has('color') ? color : DEFAULT_COLOR,
        allDay: effAllDay,
        startDate,
        startTime: effAllDay ? null : startTime || null,
        endDate: effEnd,
        endTime: effAllDay ? null : endTime || null,
        recurrence,
        reminders: reminderMins
      });
    } else {
      const schedule: Repeat = type === 'task'
        ? { type: 'once' }
        : freq === 'Weekdays'
          ? { type: 'weekdays', days: [1, 2, 3, 4, 5] }
          : freq === 'Weekly'
            ? { type: 'every', n: 1, unit: 'week', fromDone: false }
            : { type: 'daily' };
      const effTarget = type === 'habit' && has('target') ? target : 1;
      addTodo({
        name,
        colorKey: has('color') ? color : DEFAULT_COLOR,
        kind: effTarget > 1 ? 'measurable' : 'yesno',
        unit: '',
        target: effTarget,
        schedule,
        // A task's due date is optional; a habit anchors on the day it starts.
        dueDate: type === 'task' ? (has('due') ? dueDate || null : null) : (defaultDate ?? initialDate),
        time: null,
        reminder: reminderMins.length > 0,
        category: has('category') ? category : '',
        important: type === 'task' && has('priority') && priority === 'High'
      });
    }

    onSubmit?.({
      type,
      title: name,
      fields: { allDay, startDate, startTime, endDate, endTime, dueDate, location, description, freq, repeat, priority, category, target, color, reminders }
    });
    onClose();
  };

  const currentOn = on[type];
  const availableChips = CATALOG[type].filter(c => !currentOn.has(c.key));

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '6vh 32px 32px 32px',
        background: 'var(--t-scrim)',
        backdropFilter: 'blur(3px)',
        zIndex: 50
      }}
    >
      <div
        ref={cardRef}
        style={{
          width: '470px',
          background: 'var(--t-surface)',
          border: '1px solid var(--t-border)',
          boxShadow: 'var(--shadow-modal)',
          animation: 'modalIn .22s cubic-bezier(.2,.8,.3,1) both',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div
          ref={innerRef}
          style={{
            maxHeight: '88vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '18px 20px 0 20px' }}>
            <div style={{ fontFamily: 'var(--t-font-heading)', fontSize: '16px', fontWeight: 600, letterSpacing: '-.01em' }}>
              {type === 'event' ? 'New event' : type === 'task' ? 'New task' : 'New habit'}
            </div>
            <button
              onClick={onClose}
              style={{
                width: '26px',
                height: '26px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                color: 'var(--t-ink-muted)',
                cursor: 'pointer',
                transition: 'all .15s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--t-fill)';
                e.currentTarget.style.color = 'var(--t-ink)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--t-ink-muted)';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M5 5l14 14M19 5L5 19" />
              </svg>
            </button>
          </div>

          {/* Type segmented control */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', margin: '14px 20px 0 20px', border: '1px solid var(--t-border)', background: 'var(--t-page)' }}>
            {(['event', 'task', 'habit'] as const).map(t => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                style={{
                  padding: '9px 4px',
                  fontSize: '13px',
                  fontWeight: type === t ? 600 : 500,
                  fontFamily: 'Outfit, sans-serif',
                  color: type === t ? 'var(--t-surface)' : 'var(--t-ink-secondary)',
                  background: type === t ? 'var(--t-accent)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all .15s'
                }}
              >
                {t === 'event' ? 'Event' : t === 'task' ? 'Task' : 'Habit'}
              </button>
            ))}
          </div>

          {/* Body */}
          <div style={{ padding: '18px 20px 4px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Title input */}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
              autoFocus
              placeholder={PLACEHOLDERS[type]}
              style={{
                width: '100%',
                fontSize: '18px',
                fontWeight: 500,
                color: 'var(--t-ink)',
                background: 'transparent',
                border: 'none',
                borderBottom: '2px solid var(--t-border)',
                padding: '4px 0 8px 0',
                outline: 'none',
                transition: 'border-color .15s'
              }}
              onFocus={(e) => e.currentTarget.style.borderBottomColor = 'var(--t-accent)'}
              onBlur={(e) => e.currentTarget.style.borderBottomColor = 'var(--t-border)'}
            />

            {/* Event date/time block */}
            {type === 'event' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '12px',
                  background: 'var(--t-page)',
                  border: '1px solid var(--t-border)',
                  animation: 'rowIn .2s ease both'
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '46px 1fr auto', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Starts</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      // Moving the start drags the end with it, keeping the gap.
                      const next = e.target.value;
                      if (next && startDate && endDate) {
                        const shift = Math.round((new Date(next).getTime() - new Date(startDate).getTime()) / 86400000);
                        if (shift !== 0) {
                          const d = new Date(endDate);
                          d.setDate(d.getDate() + shift);
                          setEndDate(fmt(d));
                        }
                      }
                      setStartDate(next);
                    }}
                    style={{
                      width: '100%',
                      fontSize: '13px',
                      color: 'var(--t-ink)',
                      background: 'var(--t-surface)',
                      border: '1px solid var(--t-border)',
                      padding: '7px 9px',
                      outline: 'none',
                      transition: 'border-color .15s'
                    }}
                    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--t-accent)'}
                    onBlur={(e) => e.currentTarget.style.borderColor = 'var(--t-border)'}
                  />
                  {!allDay && (
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      style={{
                        fontSize: '13px',
                        color: 'var(--t-ink)',
                        background: 'var(--t-surface)',
                        border: '1px solid var(--t-border)',
                        padding: '7px 9px',
                        outline: 'none',
                        transition: 'border-color .15s'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--t-accent)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--t-border)'}
                    />
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '46px 1fr auto', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Ends</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={{
                      width: '100%',
                      fontSize: '13px',
                      color: 'var(--t-ink)',
                      background: 'var(--t-surface)',
                      border: '1px solid var(--t-border)',
                      padding: '7px 9px',
                      outline: 'none',
                      transition: 'border-color .15s'
                    }}
                    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--t-accent)'}
                    onBlur={(e) => e.currentTarget.style.borderColor = 'var(--t-border)'}
                  />
                  {!allDay && (
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      style={{
                        fontSize: '13px',
                        color: 'var(--t-ink)',
                        background: 'var(--t-surface)',
                        border: '1px solid var(--t-border)',
                        padding: '7px 9px',
                        outline: 'none',
                        transition: 'border-color .15s'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--t-accent)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--t-border)'}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Habit repeats */}
            {type === 'habit' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Repeats</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', border: '1px solid var(--t-border)', background: 'var(--t-page)' }}>
                  {['Daily', 'Weekdays', 'Weekly'].map(f => (
                    <button
                      key={f}
                      onClick={() => setFreq(f)}
                      style={{
                        padding: '9px 4px',
                        fontSize: '13px',
                        fontWeight: freq === f ? 600 : 500,
                        fontFamily: 'Outfit, sans-serif',
                        color: freq === f ? 'var(--t-surface)' : 'var(--t-ink-secondary)',
                        background: freq === f ? 'var(--t-accent)' : 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all .15s'
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Optional fields - All-day */}
            {currentOn.has('allday') && type === 'event' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  animation: 'rowIn .2s ease both'
                }}
              >
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>All-day</span>
                <button
                  onClick={() => setAllDay(!allDay)}
                  style={{
                    position: 'relative',
                    width: '36px',
                    height: '20px',
                    padding: 0,
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background .18s',
                    background: allDay ? 'var(--t-accent)' : 'var(--t-border)'
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '3px',
                      left: allDay ? '19px' : '3px',
                      width: '14px',
                      height: '14px',
                      background: 'var(--t-surface)',
                      transition: 'left .18s cubic-bezier(.2,.8,.3,1)'
                    }}
                  />
                </button>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => removeOn('allday')}
                  style={{
                    width: '22px',
                    height: '22px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--t-icon-idle)',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t-ink)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--t-icon-idle)'}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              </div>
            )}

            {/* Optional fields - Repeat (events) */}
            {currentOn.has('repeat') && type === 'event' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', animation: 'rowIn .2s ease both' }}>
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Repeat</span>
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', border: '1px solid var(--t-border)', background: 'var(--t-page)' }}>
                  {REPEAT_OPTIONS.map(r => (
                    <button
                      key={r}
                      onClick={() => setRepeat(r)}
                      style={{
                        padding: '9px 4px',
                        fontSize: '13px',
                        fontWeight: repeat === r ? 600 : 500,
                        fontFamily: 'Outfit, sans-serif',
                        color: repeat === r ? 'var(--t-surface)' : 'var(--t-ink-secondary)',
                        background: repeat === r ? 'var(--t-accent)' : 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all .15s'
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => removeOn('repeat')}
                  style={{
                    width: '22px', height: '22px', flexShrink: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', background: 'transparent',
                    border: 'none', color: 'var(--t-icon-idle)', cursor: 'pointer', transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t-ink)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--t-icon-idle)'}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              </div>
            )}

            {/* Optional fields - Due date */}
            {currentOn.has('due') && type === 'task' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  animation: 'rowIn .2s ease both'
                }}
              >
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Due</span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  style={{
                    flex: 1,
                    fontSize: '13px',
                    color: 'var(--t-ink)',
                    background: 'var(--t-surface)',
                    border: '1px solid var(--t-border)',
                    padding: '7px 9px',
                    outline: 'none',
                    transition: 'border-color .15s'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = 'var(--t-accent)'}
                  onBlur={(e) => e.currentTarget.style.borderColor = 'var(--t-border)'}
                />
                <button
                  onClick={() => removeOn('due')}
                  style={{
                    width: '22px',
                    height: '22px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--t-icon-idle)',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t-ink)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--t-icon-idle)'}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              </div>
            )}

            {/* Optional fields - Priority */}
            {currentOn.has('priority') && type === 'task' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  animation: 'rowIn .2s ease both'
                }}
              >
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Priority</span>
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', border: '1px solid var(--t-border)', background: 'var(--t-page)' }}>
                  {['Low', 'Normal', 'High'].map(p => (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      style={{
                        padding: '9px 4px',
                        fontSize: '13px',
                        fontWeight: priority === p ? 600 : 500,
                        fontFamily: 'Outfit, sans-serif',
                        color: priority === p ? 'var(--t-surface)' : 'var(--t-ink-secondary)',
                        background: priority === p ? 'var(--t-accent)' : 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all .15s'
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => removeOn('priority')}
                  style={{
                    width: '22px',
                    height: '22px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--t-icon-idle)',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t-ink)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--t-icon-idle)'}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              </div>
            )}

            {/* Optional fields - Category/List */}
            {currentOn.has('category') && (type === 'task' || type === 'habit') && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  animation: 'rowIn .2s ease both'
                }}
              >
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>List</span>
                <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.label}
                      onClick={() => setCategory(cat.label)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 10px',
                        fontSize: '12px',
                        fontWeight: 500,
                        fontFamily: 'Outfit, sans-serif',
                        cursor: 'pointer',
                        transition: 'all .15s',
                        color: category === cat.label ? 'var(--t-ink)' : 'var(--t-ink-secondary)',
                        background: category === cat.label ? 'var(--t-accent-tint)' : 'var(--t-surface)',
                        border: `1px solid ${category === cat.label ? cat.color : 'var(--t-border)'}`
                      }}
                    >
                      <span style={{ width: '7px', height: '7px', flexShrink: 0, background: cat.color }} />
                      {cat.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => removeOn('category')}
                  style={{
                    width: '22px',
                    height: '22px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--t-icon-idle)',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t-ink)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--t-icon-idle)'}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              </div>
            )}

            {/* Optional fields - Daily target */}
            {currentOn.has('target') && type === 'habit' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  animation: 'rowIn .2s ease both'
                }}
              >
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Target</span>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--t-border)' }}>
                  <button
                    onClick={() => setTarget(Math.max(1, target - 1))}
                    style={{
                      width: '30px',
                      height: '30px',
                      background: 'var(--t-surface)',
                      border: 'none',
                      borderRight: '1px solid var(--t-border)',
                      color: 'var(--t-ink-secondary)',
                      fontSize: '15px',
                      cursor: 'pointer',
                      transition: 'all .15s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--t-fill)';
                      e.currentTarget.style.color = 'var(--t-accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'var(--t-surface)';
                      e.currentTarget.style.color = 'var(--t-ink-secondary)';
                    }}
                  >
                    −
                  </button>
                  <span style={{ minWidth: '74px', textAlign: 'center', fontSize: '13px', fontWeight: 500 }}>
                    {target} {target === 1 ? 'time / day' : 'times / day'}
                  </span>
                  <button
                    onClick={() => setTarget(Math.min(12, target + 1))}
                    style={{
                      width: '30px',
                      height: '30px',
                      background: 'var(--t-surface)',
                      border: 'none',
                      borderLeft: '1px solid var(--t-border)',
                      color: 'var(--t-ink-secondary)',
                      fontSize: '15px',
                      cursor: 'pointer',
                      transition: 'all .15s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--t-fill)';
                      e.currentTarget.style.color = 'var(--t-accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'var(--t-surface)';
                      e.currentTarget.style.color = 'var(--t-ink-secondary)';
                    }}
                  >
                    +
                  </button>
                </div>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => removeOn('target')}
                  style={{
                    width: '22px',
                    height: '22px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--t-icon-idle)',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t-ink)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--t-icon-idle)'}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              </div>
            )}

            {/* Optional fields - Reminder */}
            {currentOn.has('reminder') && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  animation: 'rowIn .2s ease both'
                }}
              >
                <span style={{ width: '74px', flexShrink: 0, paddingTop: '6px', fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Remind</span>
                <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {['At time', '10 min', '1 hour', '1 day'].map(r => (
                    <button
                      key={r}
                      onClick={() => {
                        setReminders(prev => {
                          const next = { ...prev };
                          if (next[r]) delete next[r];
                          else next[r] = true;
                          return next;
                        });
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 10px',
                        fontSize: '12px',
                        fontWeight: 500,
                        fontFamily: 'Outfit, sans-serif',
                        cursor: 'pointer',
                        transition: 'all .15s',
                        color: reminders[r] ? 'var(--t-ink)' : 'var(--t-ink-secondary)',
                        background: reminders[r] ? 'var(--t-accent-tint)' : 'var(--t-surface)',
                        border: `1px solid ${reminders[r] ? 'var(--t-accent)' : 'var(--t-border)'}`
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => removeOn('reminder')}
                  style={{
                    width: '22px',
                    height: '22px',
                    marginTop: '4px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--t-icon-idle)',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t-ink)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--t-icon-idle)'}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              </div>
            )}

            {/* Optional fields - Color */}
            {currentOn.has('color') && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  animation: 'rowIn .2s ease both'
                }}
              >
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Color</span>
                <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                  {PALETTE.map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      style={{
                        width: '20px',
                        height: '20px',
                        background: c,
                        border: 'none',
                        cursor: 'pointer',
                        outline: color === c ? '2px solid var(--t-ink)' : '2px solid transparent',
                        outlineOffset: '2px',
                        transition: 'outline-color .15s'
                      }}
                    />
                  ))}
                </div>
                <button
                  onClick={() => removeOn('color')}
                  style={{
                    width: '22px',
                    height: '22px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--t-icon-idle)',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t-ink)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--t-icon-idle)'}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              </div>
            )}

            {/* Optional fields - Location */}
            {currentOn.has('location') && type === 'event' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  animation: 'rowIn .2s ease both'
                }}
              >
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Where</span>
                <input
                  placeholder="Room, address or link"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  style={{
                    flex: 1,
                    fontSize: '13px',
                    color: 'var(--t-ink)',
                    background: 'var(--t-surface)',
                    border: '1px solid var(--t-border)',
                    padding: '8px 9px',
                    outline: 'none',
                    transition: 'border-color .15s'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = 'var(--t-accent)'}
                  onBlur={(e) => e.currentTarget.style.borderColor = 'var(--t-border)'}
                />
                <button
                  onClick={() => removeOn('location')}
                  style={{
                    width: '22px',
                    height: '22px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--t-icon-idle)',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t-ink)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--t-icon-idle)'}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              </div>
            )}

            {/* Optional fields - Description */}
            {currentOn.has('desc') && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  animation: 'rowIn .2s ease both'
                }}
              >
                <span style={{ width: '74px', flexShrink: 0, paddingTop: '8px', fontSize: '11px', fontWeight: 600, color: 'var(--t-ink-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Notes</span>
                <textarea
                  placeholder="Details, links…"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{
                    flex: 1,
                    fontSize: '13px',
                    lineHeight: '1.5',
                    color: 'var(--t-ink)',
                    background: 'var(--t-surface)',
                    border: '1px solid var(--t-border)',
                    padding: '8px 9px',
                    outline: 'none',
                    resize: 'vertical',
                    transition: 'border-color .15s'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = 'var(--t-accent)'}
                  onBlur={(e) => e.currentTarget.style.borderColor = 'var(--t-border)'}
                />
                <button
                  onClick={() => removeOn('desc')}
                  style={{
                    width: '22px',
                    height: '22px',
                    marginTop: '6px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--t-icon-idle)',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t-ink)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--t-icon-idle)'}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              </div>
            )}

            {/* Add field chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', padding: '2px 0 16px 0' }}>
              {availableChips.map(chip => (
                <button
                  key={chip.key}
                  onClick={() => addOn(chip.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--t-ink-secondary)',
                    background: 'transparent',
                    border: '1px dashed var(--t-border-strong)',
                    cursor: 'pointer',
                    transition: 'all .15s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--t-accent)';
                    e.currentTarget.style.borderColor = 'var(--t-accent)';
                    e.currentTarget.style.background = 'var(--t-accent-tint)';
                    e.currentTarget.style.borderStyle = 'solid';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--t-ink-secondary)';
                    e.currentTarget.style.borderColor = 'var(--t-border-strong)';
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderStyle = 'dashed';
                  }}
                >
                  <span style={{ fontSize: '13px', lineHeight: '1' }}>+</span>{chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{ position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '13px 20px', borderTop: '1px solid var(--t-border-subtle)', background: 'var(--t-surface)' }}>
            <span style={{ fontSize: '11px', color: 'var(--t-icon-idle)' }}>{canSubmit ? 'Enter to save' : ''}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '9px 14px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--t-ink-secondary)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'color .15s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--t-ink)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--t-ink-secondary)'}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                style={{
                  padding: '9px 18px',
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: 'Outfit, sans-serif',
                  color: canSubmit ? 'var(--t-surface)' : 'var(--t-ink-muted)',
                  background: canSubmit ? 'var(--t-accent)' : 'var(--t-border)',
                  border: 'none',
                  transition: 'all .15s',
                  cursor: canSubmit ? 'pointer' : 'not-allowed'
                }}
              >
                Add {type === 'event' ? 'event' : type === 'task' ? 'task' : 'habit'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* `modalIn` / `rowIn` live in App.css — a <style> tag here re-inserts
          the same two keyframes into the head on every mount. */}
    </div>
  );
}
