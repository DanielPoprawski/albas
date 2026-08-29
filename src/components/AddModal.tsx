import { useRef, useEffect, useState, useCallback } from 'react';
import type { AddType } from '../types';

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

const CATEGORIES = [
  { label: 'Work', color: '#3b82f6' },
  { label: 'Personal', color: '#a855f7' },
  { label: 'Shopping', color: '#f59e0b' },
  { label: 'Health', color: '#22c55e' },
  { label: 'Finance', color: '#14b8a6' }
];

const PALETTE = ['#a855f7', '#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#6b7280'];

interface Props {
  onClose: () => void;
  onSubmit?: (data: SubmitData) => void;
  snappiness?: number;
}

export interface SubmitData {
  type: AddType;
  title: string;
  fields: Record<string, any>;
}

export default function AddModal({ onClose, onSubmit, snappiness = 1 }: Props) {
  const [type, setType] = useState<AddType>('event');
  const [title, setTitle] = useState('');
  const [on, setOn] = useState<Record<AddType, Set<FieldKey>>>({
    event: new Set(),
    task: new Set(),
    habit: new Set()
  });
  const [allDay, setAllDay] = useState(false);
  const [freq, setFreq] = useState('Daily');
  const [repeat, setRepeat] = useState('Daily');
  const [priority, setPriority] = useState('Normal');
  const [category, setCategory] = useState('Personal');
  const [target, setTarget] = useState(1);
  const [color, setColor] = useState('#a855f7');
  const [reminders, setReminders] = useState<Record<string, boolean>>({ '10 min': true });

  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const heightRef = useRef<number | null>(null);
  const velocityRef = useRef<number>(0);
  const targetHeightRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const roRef = useRef<ResizeObserver | null>(null);

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

    tick();
  }, []);

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

  // Respect prefers-reduced-motion
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced && cardRef.current) {
      cardRef.current.style.transition = 'none';
    }
  }, []);

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

    const fields: Record<string, any> = {
      allDay,
      freq,
      repeat,
      priority,
      category,
      target,
      color,
      reminders
    };

    onSubmit?.({
      type,
      title,
      fields
    });
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
        background: 'rgba(26, 32, 44, .38)',
        backdropFilter: 'blur(3px)',
        zIndex: 50
      }}
    >
      <div
        ref={cardRef}
        style={{
          width: '470px',
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          boxShadow: '0 30px 70px rgba(15, 23, 42, .22)',
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
            <div style={{ fontFamily: 'Sora, sans-serif', fontSize: '16px', fontWeight: 600, letterSpacing: '-.01em' }}>
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
                color: '#9ca3af',
                cursor: 'pointer',
                transition: 'all .15s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f3f4f6';
                e.currentTarget.style.color = '#1a202c';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#9ca3af';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M5 5l14 14M19 5L5 19" />
              </svg>
            </button>
          </div>

          {/* Type segmented control */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', margin: '14px 20px 0 20px', border: '1px solid #e5e7eb', background: '#f8fafb' }}>
            {(['event', 'task', 'habit'] as const).map(t => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                style={{
                  padding: '9px 4px',
                  fontSize: '13px',
                  fontWeight: type === t ? 600 : 500,
                  fontFamily: 'Outfit, sans-serif',
                  color: type === t ? '#ffffff' : '#6b7280',
                  background: type === t ? '#a855f7' : 'transparent',
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
              placeholder={PLACEHOLDERS[type]}
              style={{
                width: '100%',
                fontSize: '18px',
                fontWeight: 500,
                color: '#1a202c',
                background: 'transparent',
                border: 'none',
                borderBottom: '2px solid #e5e7eb',
                padding: '4px 0 8px 0',
                outline: 'none',
                transition: 'border-color .15s'
              }}
              onFocus={(e) => e.currentTarget.style.borderBottomColor = '#a855f7'}
              onBlur={(e) => e.currentTarget.style.borderBottomColor = '#e5e7eb'}
            />

            {/* Event date/time block */}
            {type === 'event' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '12px',
                  background: '#f8fafb',
                  border: '1px solid #e5e7eb',
                  animation: 'rowIn .2s ease both'
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '46px 1fr auto', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>Starts</span>
                  <input
                    type="date"
                    defaultValue="2026-08-12"
                    style={{
                      width: '100%',
                      fontSize: '13px',
                      color: '#1a202c',
                      background: '#ffffff',
                      border: '1px solid #e5e7eb',
                      padding: '7px 9px',
                      outline: 'none',
                      transition: 'border-color .15s'
                    }}
                    onFocus={(e) => e.currentTarget.style.borderColor = '#a855f7'}
                    onBlur={(e) => e.currentTarget.style.borderColor = '#e5e7eb'}
                  />
                  {!allDay && (
                    <input
                      type="time"
                      defaultValue="12:00"
                      style={{
                        fontSize: '13px',
                        color: '#1a202c',
                        background: '#ffffff',
                        border: '1px solid #e5e7eb',
                        padding: '7px 9px',
                        outline: 'none',
                        transition: 'border-color .15s'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = '#a855f7'}
                      onBlur={(e) => e.currentTarget.style.borderColor = '#e5e7eb'}
                    />
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '46px 1fr auto', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>Ends</span>
                  <input
                    type="date"
                    defaultValue="2026-08-12"
                    style={{
                      width: '100%',
                      fontSize: '13px',
                      color: '#1a202c',
                      background: '#ffffff',
                      border: '1px solid #e5e7eb',
                      padding: '7px 9px',
                      outline: 'none',
                      transition: 'border-color .15s'
                    }}
                    onFocus={(e) => e.currentTarget.style.borderColor = '#a855f7'}
                    onBlur={(e) => e.currentTarget.style.borderColor = '#e5e7eb'}
                  />
                  {!allDay && (
                    <input
                      type="time"
                      defaultValue="13:00"
                      style={{
                        fontSize: '13px',
                        color: '#1a202c',
                        background: '#ffffff',
                        border: '1px solid #e5e7eb',
                        padding: '7px 9px',
                        outline: 'none',
                        transition: 'border-color .15s'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = '#a855f7'}
                      onBlur={(e) => e.currentTarget.style.borderColor = '#e5e7eb'}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Habit repeats */}
            {type === 'habit' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>Repeats</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', border: '1px solid #e5e7eb', background: '#f8fafb' }}>
                  {['Daily', 'Weekly', 'Monthly', 'Yearly'].map(f => (
                    <button
                      key={f}
                      onClick={() => setFreq(f)}
                      style={{
                        padding: '9px 4px',
                        fontSize: '13px',
                        fontWeight: freq === f ? 600 : 500,
                        fontFamily: 'Outfit, sans-serif',
                        color: freq === f ? '#ffffff' : '#6b7280',
                        background: freq === f ? '#a855f7' : 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all .15s'
                      }}
                    >
                      {f === 'Weekly' ? 'Week' : f === 'Monthly' ? 'Month' : f === 'Yearly' ? 'Year' : f}
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
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>All-day</span>
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
                    background: allDay ? '#a855f7' : '#e5e7eb'
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '3px',
                      left: allDay ? '19px' : '3px',
                      width: '14px',
                      height: '14px',
                      background: '#ffffff',
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
                    color: '#c3c8d0',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#1a202c'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#c3c8d0'}
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
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>Due</span>
                <input
                  type="date"
                  defaultValue="2026-08-12"
                  style={{
                    flex: 1,
                    fontSize: '13px',
                    color: '#1a202c',
                    background: '#ffffff',
                    border: '1px solid #e5e7eb',
                    padding: '7px 9px',
                    outline: 'none',
                    transition: 'border-color .15s'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#a855f7'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#e5e7eb'}
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
                    color: '#c3c8d0',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#1a202c'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#c3c8d0'}
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
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>Priority</span>
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', border: '1px solid #e5e7eb', background: '#f8fafb' }}>
                  {['Low', 'Normal', 'High'].map(p => (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      style={{
                        padding: '9px 4px',
                        fontSize: '13px',
                        fontWeight: priority === p ? 600 : 500,
                        fontFamily: 'Outfit, sans-serif',
                        color: priority === p ? '#ffffff' : '#6b7280',
                        background: priority === p ? '#a855f7' : 'transparent',
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
                    color: '#c3c8d0',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#1a202c'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#c3c8d0'}
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
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>List</span>
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
                        color: category === cat.label ? '#1a202c' : '#6b7280',
                        background: category === cat.label ? '#faf5ff' : '#ffffff',
                        border: `1px solid ${category === cat.label ? cat.color : '#e5e7eb'}`
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
                    color: '#c3c8d0',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#1a202c'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#c3c8d0'}
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
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>Target</span>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e5e7eb' }}>
                  <button
                    onClick={() => setTarget(Math.max(1, target - 1))}
                    style={{
                      width: '30px',
                      height: '30px',
                      background: '#ffffff',
                      border: 'none',
                      borderRight: '1px solid #e5e7eb',
                      color: '#6b7280',
                      fontSize: '15px',
                      cursor: 'pointer',
                      transition: 'all .15s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f3f4f6';
                      e.currentTarget.style.color = '#a855f7';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#ffffff';
                      e.currentTarget.style.color = '#6b7280';
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
                      background: '#ffffff',
                      border: 'none',
                      borderLeft: '1px solid #e5e7eb',
                      color: '#6b7280',
                      fontSize: '15px',
                      cursor: 'pointer',
                      transition: 'all .15s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f3f4f6';
                      e.currentTarget.style.color = '#a855f7';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#ffffff';
                      e.currentTarget.style.color = '#6b7280';
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
                    color: '#c3c8d0',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#1a202c'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#c3c8d0'}
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
                <span style={{ width: '74px', flexShrink: 0, paddingTop: '6px', fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>Remind</span>
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
                        color: reminders[r] ? '#1a202c' : '#6b7280',
                        background: reminders[r] ? '#faf5ff' : '#ffffff',
                        border: `1px solid ${reminders[r] ? '#a855f7' : '#e5e7eb'}`
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
                    color: '#c3c8d0',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#1a202c'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#c3c8d0'}
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
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>Color</span>
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
                        outline: color === c ? '2px solid #1a202c' : '2px solid transparent',
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
                    color: '#c3c8d0',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#1a202c'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#c3c8d0'}
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
                <span style={{ width: '74px', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>Where</span>
                <input
                  placeholder="Room, address or link"
                  style={{
                    flex: 1,
                    fontSize: '13px',
                    color: '#1a202c',
                    background: '#ffffff',
                    border: '1px solid #e5e7eb',
                    padding: '8px 9px',
                    outline: 'none',
                    transition: 'border-color .15s'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#a855f7'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#e5e7eb'}
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
                    color: '#c3c8d0',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#1a202c'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#c3c8d0'}
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
                <span style={{ width: '74px', flexShrink: 0, paddingTop: '8px', fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.5px' }}>Notes</span>
                <textarea
                  placeholder="Details, links…"
                  rows={3}
                  style={{
                    flex: 1,
                    fontSize: '13px',
                    lineHeight: '1.5',
                    color: '#1a202c',
                    background: '#ffffff',
                    border: '1px solid #e5e7eb',
                    padding: '8px 9px',
                    outline: 'none',
                    resize: 'vertical',
                    transition: 'border-color .15s'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#a855f7'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#e5e7eb'}
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
                    color: '#c3c8d0',
                    cursor: 'pointer',
                    transition: 'color .15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#1a202c'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#c3c8d0'}
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
                    color: '#6b7280',
                    background: 'transparent',
                    border: '1px dashed #d1d5db',
                    cursor: 'pointer',
                    transition: 'all .15s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#a855f7';
                    e.currentTarget.style.borderColor = '#a855f7';
                    e.currentTarget.style.background = '#faf5ff';
                    e.currentTarget.style.borderStyle = 'solid';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#6b7280';
                    e.currentTarget.style.borderColor = '#d1d5db';
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
          <div style={{ position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '13px 20px', borderTop: '1px solid #f1f5f9', background: '#ffffff' }}>
            <span style={{ fontSize: '11px', color: '#c3c8d0' }}>{canSubmit ? 'Enter to save' : ''}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '9px 14px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#6b7280',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'color .15s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#1a202c'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}
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
                  color: canSubmit ? '#ffffff' : '#9ca3af',
                  background: canSubmit ? '#a855f7' : '#e5e7eb',
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

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: translateY(10px) scale(.985); }
          to { opacity: 1; transform: none; }
        }
        @keyframes rowIn {
          from { opacity: 0; transform: translateY(-4px); max-height: 0; }
          to { opacity: 1; transform: none; max-height: 240px; }
        }
      `}</style>
    </div>
  );
}
