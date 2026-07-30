import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DEFAULT_COLOR } from '../../colors';
import { rotateWeek } from '../../dates';
import type { Repeat, RepeatUnit, Todo, TodoKind } from '../../types';
import { CheckboxRow, ColorPicker, EditActions, inputClass, labelClass, SegmentedControl, Select, SubmitButton } from './shared';

/**
 * One form for everything that needs doing. The repeat rule is the whole
 * distinction: never = task, fixed cadence = habit, from-last-done = chore.
 */
type RepeatChoice = 'once' | 'daily' | 'weekdays' | 'every' | 'timesPer';

const REPEAT_OPTIONS: { value: RepeatChoice; label: string }[] = [
  { value: 'once', label: "Doesn't repeat" },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Days of the week' },
  { value: 'every', label: 'Every N days / weeks / months' },
  { value: 'timesPer', label: 'N times per week / month' },
];

// Sunday-first (matching getDay()); rotated into the user's display order
const WEEKDAY_OPTIONS = [
  { day: 0, label: 'S' }, { day: 1, label: 'M' }, { day: 2, label: 'T' }, { day: 3, label: 'W' },
  { day: 4, label: 'T' }, { day: 5, label: 'F' }, { day: 6, label: 'S' },
];

export default function TodoForm({ edit, defaultDate, onDone }: {
  edit?: Todo;
  defaultDate?: string | null;
  onDone: () => void;
}) {
  const { addTodo, updateTodo, deleteTodo, selectedDate, firstDayOfWeek, todos } = useApp();
  const sched = edit?.schedule;

  // Autocomplete source: categories exist only because a to-do uses one, so
  // the list is derived rather than stored.
  const knownCategories = [...new Set(todos.map(t => t.category).filter(Boolean))].sort();

  const [name, setName] = useState(edit?.name ?? '');
  const [category, setCategory] = useState(edit?.category ?? '');
  const [important, setImportant] = useState(edit?.important ?? false);
  const [color, setColor] = useState(edit?.colorKey ?? DEFAULT_COLOR);
  const [kind, setKind] = useState<TodoKind>(edit?.kind ?? 'yesno');
  const [target, setTarget] = useState(edit && edit.kind === 'measurable' ? String(edit.target) : '');
  const [unit, setUnit] = useState(edit?.unit ?? '');
  const [date, setDate] = useState(edit ? edit.dueDate ?? '' : defaultDate ?? selectedDate ?? '');
  const [time, setTime] = useState(edit?.time ?? '');
  const [repeat, setRepeat] = useState<RepeatChoice>(sched?.type ?? 'once');
  const [weekdays, setWeekdays] = useState<number[]>(sched?.type === 'weekdays' ? sched.days : [1, 2, 3, 4, 5]);
  const [everyN, setEveryN] = useState(sched?.type === 'every' ? String(sched.n) : '3');
  const [everyUnit, setEveryUnit] = useState<RepeatUnit>(sched?.type === 'every' ? sched.unit : 'day');
  const [fromDone, setFromDone] = useState(sched?.type === 'every' ? sched.fromDone : false);
  const [times, setTimes] = useState(sched?.type === 'timesPer' ? String(sched.times) : '3');
  const [per, setPer] = useState<'week' | 'month'>(sched?.type === 'timesPer' ? sched.per : 'week');
  const [reminder, setReminder] = useState(edit?.reminder ?? false);

  function toggleWeekday(day: number) {
    setWeekdays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  }

  function buildRepeat(): Repeat | null {
    switch (repeat) {
      case 'once': return { type: 'once' };
      case 'daily': return { type: 'daily' };
      case 'weekdays':
        return weekdays.length === 0 ? null : { type: 'weekdays', days: weekdays };
      case 'every': {
        const n = parseInt(everyN, 10);
        if (!Number.isFinite(n) || n < 1) return null;
        return { type: 'every', n, unit: everyUnit, fromDone };
      }
      case 'timesPer': {
        const n = parseInt(times, 10);
        if (!Number.isFinite(n) || n < 1) return null;
        return { type: 'timesPer', times: n, per };
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const schedule = buildRepeat();
    if (!schedule) return;
    const parsedTarget = parseInt(target, 10);
    const fields = {
      name: name.trim(),
      colorKey: color,
      kind,
      unit: kind === 'measurable' ? unit.trim() : '',
      target: kind === 'measurable' && Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : 1,
      schedule,
      dueDate: date || null,
      time: time || null,
      reminder,
      category: category.trim(),
      important,
    };
    if (edit) updateTodo(edit.id, fields);
    else addTodo(fields);
    onDone();
  }

  const repeating = repeat !== 'once';

  return (
    <form onSubmit={handleSubmit} className="space-y-md">
      <div>
        <label className={labelClass}>Name</label>
        <div className="flex gap-sm items-center">
          <input
            className={inputClass}
            placeholder="e.g. Client meeting prep, Pushups, Take out trash"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          {/* Star lives beside the name: it's a property of the to-do itself,
              not a scheduling detail, and this keeps it one tap from the top. */}
          <button
            type="button"
            onClick={() => setImportant(v => !v)}
            title={important ? 'Not important' : 'Mark important'}
            aria-pressed={important}
            className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
              important ? 'text-amber-400 bg-fill-strong' : 'text-txt-faint hover:text-txt hover:bg-fill'
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 20, fontVariationSettings: important ? "'FILL' 1" : "'FILL' 0" }}
            >
              star
            </span>
          </button>
        </div>
      </div>

      <div>
        <label className={labelClass}>Category</label>
        {/* Native datalist: free text that suggests what you've already used,
            with no list to manage and nothing to migrate when one goes unused. */}
        <input
          className={inputClass}
          list="todo-categories"
          placeholder="Optional — e.g. Work, Home"
          value={category}
          onChange={e => setCategory(e.target.value)}
        />
        <datalist id="todo-categories">
          {knownCategories.map(c => <option key={c} value={c} />)}
        </datalist>
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
            <label className={labelClass}>Target</label>
            <input
              type="number"
              min="1"
              className={inputClass}
              placeholder="e.g. 30"
              value={target}
              onChange={e => setTarget(e.target.value)}
              
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

      <div className="flex gap-sm">
        <div className="flex-1">
          <label className={labelClass}>{repeating ? 'Starts (optional)' : 'Day (optional)'}</label>
          <input
            type="date"
            className={inputClass}
            value={date}
            onChange={e => setDate(e.target.value)}
            
          />
        </div>
        <div className="w-28">
          <label className={labelClass}>Time</label>
          <input
            type="time"
            className={inputClass}
            value={time}
            onChange={e => setTime(e.target.value)}
            
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Repeat</label>
        <Select options={REPEAT_OPTIONS} value={repeat} onChange={setRepeat} />

        {repeat === 'weekdays' && (
          <div className="flex gap-xs mt-sm">
            {rotateWeek(WEEKDAY_OPTIONS, firstDayOfWeek).map(({ day, label }, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleWeekday(day)}
                className={`flex-1 h-8 rounded-lg text-label-md font-bold transition-all ${
                  weekdays.includes(day)
                    ? 'bg-primary text-on-primary'
                    : 'bg-fill-strong text-txt-muted hover:bg-fill-stronger'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {repeat === 'every' && (
          <div className="mt-sm space-y-sm">
            <div className="flex items-center gap-sm">
              <span className="text-body-sm text-txt-muted">Every</span>
              <input
                type="number"
                min="1"
                className={`${inputClass} text-center`}
                value={everyN}
                onChange={e => setEveryN(e.target.value)}
                style={{ width: '4.5rem' }}
              />
              <Select
                className="flex-1"
                options={[
                  { value: 'day', label: parseInt(everyN, 10) === 1 ? 'day' : 'days' },
                  { value: 'week', label: parseInt(everyN, 10) === 1 ? 'week' : 'weeks' },
                  { value: 'month', label: parseInt(everyN, 10) === 1 ? 'month' : 'months' },
                ]}
                value={everyUnit}
                onChange={setEveryUnit}
              />
            </div>
            <CheckboxRow
              checked={fromDone}
              onChange={setFromDone}
              label="Count from the last time it was done"
              hint="Chore-style: skipping a day pushes the next one back. Off = fixed schedule, due again whether or not the last one happened."
            />
          </div>
        )}

        {repeat === 'timesPer' && (
          <div className="flex items-center gap-sm mt-sm">
            <input
              type="number"
              min="1"
              className={`${inputClass} text-center`}
              value={times}
              onChange={e => setTimes(e.target.value)}
              style={{ width: '4.5rem' }}
            />
            <span className="text-body-sm text-txt-muted">times per</span>
            <Select
              className="flex-1"
              options={[{ value: 'week', label: 'week' }, { value: 'month', label: 'month' }]}
              value={per}
              onChange={setPer}
            />
          </div>
        )}
      </div>

      <div>
        <label className={labelClass}>Notifications</label>
        <CheckboxRow
          checked={reminder}
          onChange={setReminder}
          label="Remind me on days it's due"
        />
      </div>

      <div>
        <label className={labelClass}>Color</label>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      {edit ? (
        <EditActions saveLabel="Save Changes" onDelete={() => { deleteTodo(edit.id); onDone(); }} />
      ) : (
        <SubmitButton label="Add To-Do" />
      )}
    </form>
  );
}
