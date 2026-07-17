import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { HABIT_COLORS } from '../habitColors';
import type { ColorKey, Habit, HabitKind, Schedule } from '../../types';
import { ColorPicker, inputClass, labelClass, SegmentedControl, SubmitButton } from './shared';

type FreqType = 'daily' | 'weekdays' | 'interval';

// Display Monday-first; values are JS getDay() (0=Sun)
const WEEKDAY_OPTIONS = [
  { day: 1, label: 'M' }, { day: 2, label: 'T' }, { day: 3, label: 'W' },
  { day: 4, label: 'T' }, { day: 5, label: 'F' }, { day: 6, label: 'S' }, { day: 0, label: 'S' },
];

export default function HabitForm({ edit, onDone }: { edit?: Habit; onDone: () => void }) {
  const { addHabit, updateHabit } = useApp();
  const sched = edit?.schedule;
  const [name, setName] = useState(edit?.name ?? '');
  const [color, setColor] = useState<ColorKey>(edit?.colorKey ?? 'primary');
  const [kind, setKind] = useState<HabitKind>(edit?.kind ?? 'yesno');
  const [target, setTarget] = useState(edit && edit.kind === 'measurable' ? String(edit.target) : '');
  const [unit, setUnit] = useState(edit?.unit ?? '');
  const [freqType, setFreqType] = useState<FreqType>(
    sched?.type === 'weekdays' ? 'weekdays' : sched?.type === 'interval' || sched?.type === 'chore' ? 'interval' : 'daily'
  );
  const [weekdays, setWeekdays] = useState<number[]>(sched?.type === 'weekdays' ? sched.days : [1, 2, 3, 4, 5]);
  const [every, setEvery] = useState(sched?.type === 'interval' || sched?.type === 'chore' ? String(sched.every) : '3');
  const [choreMode, setChoreMode] = useState(sched?.type === 'chore');
  const [reminder, setReminder] = useState(edit?.reminder ?? false);

  function toggleWeekday(day: number) {
    setWeekdays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  }

  function buildSchedule(): Schedule | null {
    if (freqType === 'daily') return { type: 'daily' };
    if (freqType === 'weekdays') {
      if (weekdays.length === 0) return null;
      return { type: 'weekdays', days: weekdays };
    }
    const n = parseInt(every, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return choreMode ? { type: 'chore', every: n } : { type: 'interval', every: n };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const schedule = buildSchedule();
    if (!schedule) return;
    const parsedTarget = parseInt(target, 10);
    const fields = {
      name: name.trim(),
      colorKey: color,
      kind,
      unit: kind === 'measurable' ? unit.trim() : '',
      target: kind === 'measurable' && Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : 1,
      schedule,
      reminder,
    };
    if (edit) updateHabit(edit.id, fields);
    else addHabit(fields);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-md">
      <div>
        <label className={labelClass}>Habit Name</label>
        <input
          className={inputClass}
          placeholder="e.g. Pushups, Take out trash"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div>
        <label className={labelClass}>Type</label>
        <SegmentedControl
          options={[{ value: 'yesno', label: 'Yes / No' }, { value: 'measurable', label: 'Measurable' }]}
          value={kind}
          onChange={setKind}
        />
      </div>

      {kind === 'measurable' && (
        <div className="flex gap-sm">
          <div className="flex-1">
            <label className={labelClass}>Daily Target</label>
            <input
              type="number"
              min="1"
              className={inputClass}
              placeholder="e.g. 30"
              value={target}
              onChange={e => setTarget(e.target.value)}
              style={{ colorScheme: 'dark' }}
            />
          </div>
          <div className="flex-1">
            <label className={labelClass}>Unit</label>
            <input
              className={inputClass}
              placeholder="e.g. pushups, glasses"
              value={unit}
              onChange={e => setUnit(e.target.value)}
            />
          </div>
        </div>
      )}

      <div>
        <label className={labelClass}>Frequency</label>
        <SegmentedControl
          options={[
            { value: 'daily', label: 'Daily' },
            { value: 'weekdays', label: 'Days of Week' },
            { value: 'interval', label: 'Every N Days' },
          ]}
          value={freqType}
          onChange={setFreqType}
        />

        {freqType === 'weekdays' && (
          <div className="flex gap-xs mt-sm">
            {WEEKDAY_OPTIONS.map(({ day, label }, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleWeekday(day)}
                className={`flex-1 h-8 rounded-lg text-label-md font-bold transition-all ${
                  weekdays.includes(day)
                    ? 'bg-primary text-on-primary'
                    : 'bg-white/10 text-outline-variant hover:bg-white/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {freqType === 'interval' && (
          <div className="mt-sm space-y-sm">
            <div className="flex items-center gap-sm">
              <span className="text-body-sm text-outline-variant">Every</span>
              <input
                type="number"
                min="1"
                className={`${inputClass} w-20 text-center`}
                value={every}
                onChange={e => setEvery(e.target.value)}
                style={{ colorScheme: 'dark', width: '5rem' }}
              />
              <span className="text-body-sm text-outline-variant">days</span>
            </div>
            <label className="flex items-start gap-sm cursor-pointer p-sm rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
              <input
                type="checkbox"
                checked={choreMode}
                onChange={e => setChoreMode(e.target.checked)}
                className="mt-0.5 accent-blue-600"
              />
              <span>
                <span className="block text-body-sm text-inverse-on-surface font-medium">Chore mode</span>
                <span className="block text-[11px] text-outline-variant">
                  Count from the last time it was done — if you miss a day, the next one
                  shifts back instead of coming due early.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>

      <div>
        <label className={labelClass}>Color</label>
        <ColorPicker value={color} onChange={setColor} colors={HABIT_COLORS} />
      </div>

      <label className="flex items-center gap-sm cursor-pointer p-sm rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
        <input
          type="checkbox"
          checked={reminder}
          onChange={e => setReminder(e.target.checked)}
          className="accent-blue-600"
        />
        <span className="text-body-sm text-inverse-on-surface">Remind me on days it's due</span>
      </label>

      <SubmitButton label={edit ? 'Save Changes' : 'Add Habit'} />
    </form>
  );
}
