import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { HABIT_COLORS } from '../habitColors';
import type { ColorKey, Period } from '../../types';
import { ColorPicker, inputClass, labelClass, SubmitButton } from './shared';

export default function PeriodForm({ edit, onDone }: { edit?: Period; onDone: () => void }) {
  const { addPeriod, updatePeriod, habits, selectedDate } = useApp();
  const [name, setName] = useState(edit?.name ?? '');
  const [color, setColor] = useState<ColorKey>(edit?.colorKey ?? 'primary');
  const [startDate, setStartDate] = useState(edit?.startDate ?? selectedDate ?? '');
  const [endDate, setEndDate] = useState(edit?.endDate ?? '');
  const [notes, setNotes] = useState(edit?.notes ?? '');
  const [habitIds, setHabitIds] = useState<string[]>(edit?.habitIds ?? []);
  const [error, setError] = useState('');

  function toggleHabitId(id: string) {
    setHabitIds(prev => prev.includes(id) ? prev.filter(h => h !== id) : [...prev, id]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !startDate || !endDate) return;
    if (endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    const fields = {
      name: name.trim(),
      colorKey: color,
      startDate,
      endDate,
      notes: notes.trim(),
      habitIds,
    };
    if (edit) updatePeriod(edit.id, fields);
    else addPeriod(fields);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-md">
      <div>
        <label className={labelClass}>Name</label>
        <input
          className={inputClass}
          placeholder="e.g. 12-week gym program, Cutting diet"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex gap-sm">
        <div className="flex-1">
          <label className={labelClass}>Starts</label>
          <input
            type="date"
            className={inputClass}
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            style={{ colorScheme: 'dark' }}
          />
        </div>
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
      </div>

      <div>
        <label className={labelClass}>Notes (optional)</label>
        <textarea
          className={`${inputClass} resize-none`}
          rows={2}
          placeholder="Goals, program details…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      {habits.length > 0 && (
        <div>
          <label className={labelClass}>Linked Habits</label>
          <div className="space-y-xs">
            {habits.map(h => (
              <label
                key={h.id}
                className="flex items-center gap-sm cursor-pointer p-xs rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={habitIds.includes(h.id)}
                  onChange={() => toggleHabitId(h.id)}
                  className="accent-blue-600"
                />
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: HABIT_COLORS[h.colorKey].hex }}
                />
                <span className="text-body-sm text-inverse-on-surface">{h.name}</span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-outline-variant mt-xs">
            Linked habits count toward this period's progress.
          </p>
        </div>
      )}

      <div>
        <label className={labelClass}>Color</label>
        <ColorPicker value={color} onChange={setColor} colors={HABIT_COLORS} />
      </div>

      {error && <p className="text-body-sm text-tertiary-fixed-dim">{error}</p>}

      <SubmitButton label={edit ? 'Save Changes' : 'Add Period'} />
    </form>
  );
}
