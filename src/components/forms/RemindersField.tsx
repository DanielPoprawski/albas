import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { inputClass, labelClass, Select } from './shared';

/** Lead times offered as one tap. Stored as minutes before the event starts. */
const PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'At start time' },
  { minutes: 5, label: '5 minutes before' },
  { minutes: 10, label: '10 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 10080, label: '1 week before' },
];

type Unit = 'minutes' | 'hours' | 'days' | 'weeks';
const UNIT_MINUTES: Record<Unit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
};

/** Minutes-before as words, picking the largest unit that divides evenly. */
export function reminderLabel(minutes: number): string {
  if (minutes === 0) return 'At start time';
  const preset = PRESETS.find(p => p.minutes === minutes);
  if (preset) return preset.label;

  const units: [Unit, number][] = [['weeks', 10080], ['days', 1440], ['hours', 60], ['minutes', 1]];
  for (const [unit, size] of units) {
    if (minutes % size === 0) {
      const n = minutes / size;
      return `${n} ${n === 1 ? unit.slice(0, -1) : unit} before`;
    }
  }
  return `${minutes} minutes before`;
}

/**
 * Add/edit one reminder. Presets cover the common cases; "Custom" is there so
 * the list doesn't have to guess every lead time anyone might want.
 */
function ReminderDialog({ initial, taken, onSave, onClose }: {
  initial: number | null;
  taken: number[];
  onSave: (minutes: number) => void;
  onClose: () => void;
}) {
  const isPreset = initial != null && PRESETS.some(p => p.minutes === initial);
  const [custom, setCustom] = useState(initial != null && !isPreset);
  const [amount, setAmount] = useState(() => {
    if (initial == null || isPreset) return '15';
    for (const u of ['weeks', 'days', 'hours'] as Unit[]) {
      if (initial % UNIT_MINUTES[u] === 0) return String(initial / UNIT_MINUTES[u]);
    }
    return String(initial);
  });
  const [unit, setUnit] = useState<Unit>(() => {
    if (initial == null || isPreset) return 'minutes';
    for (const u of ['weeks', 'days', 'hours'] as Unit[]) {
      if (initial % UNIT_MINUTES[u] === 0) return u;
    }
    return 'minutes';
  });

  function save(minutes: number) {
    onSave(minutes);
    onClose();
  }

  function saveCustom() {
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n < 0) return;
    save(n * UNIT_MINUTES[unit]);
  }

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="block rounded-2xl p-md w-full max-w-[min(22rem,calc(100%-2rem))] max-h-[80vh] overflow-y-auto scrollbar-hide border-line shadow-2xl"
      >
        <DialogTitle className="text-body-md font-bold text-txt mb-md">
          {initial == null ? 'Add notification' : 'Edit notification'}
        </DialogTitle>

        {!custom ? (
          <div className="space-y-xs">
            {PRESETS.map(({ minutes, label }) => {
              // already-used lead times would silently collapse into one
              const used = taken.includes(minutes) && minutes !== initial;
              return (
                <button
                  key={minutes}
                  type="button"
                  disabled={used}
                  onClick={() => save(minutes)}
                  className={`w-full py-sm px-sm rounded-lg text-left text-body-sm transition-colors ${
                    used
                      ? 'text-txt-faint cursor-default'
                      : 'text-txt bg-fill hover:bg-fill-strong'
                  }`}
                >
                  {label}
                  {used && <span className="text-[10px] ml-xs">already added</span>}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCustom(true)}
              className="w-full py-sm px-sm rounded-lg text-left text-body-sm text-primary-fixed-dim bg-fill hover:bg-fill-strong transition-colors"
            >
              Custom…
            </button>
          </div>
        ) : (
          <div className="space-y-md">
            <div>
              <label className={labelClass}>How far in advance</label>
              <div className="flex gap-sm">
                <input
                  type="number"
                  min="0"
                  autoFocus
                  className={`${inputClass} w-24 text-center`}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
                <Select
                  className="flex-1"
                  options={[
                    { value: 'minutes', label: 'minutes before' },
                    { value: 'hours', label: 'hours before' },
                    { value: 'days', label: 'days before' },
                    { value: 'weeks', label: 'weeks before' },
                  ]}
                  value={unit}
                  onChange={setUnit}
                />
              </div>
            </div>
            <div className="flex gap-sm">
              <button
                type="button"
                onClick={() => setCustom(false)}
                className="px-md py-sm rounded-lg text-body-sm text-txt-muted hover:bg-fill transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={saveCustom}
                className="flex-1 py-sm bg-primary text-on-primary rounded-lg font-semibold text-body-sm hover:bg-primary/90 active:scale-95 transition-all"
              >
                {initial == null ? 'Add' : 'Save'}
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-sm py-sm rounded-lg text-center text-body-sm text-txt-muted hover:bg-fill transition-colors"
        >
          Cancel
        </button>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The event's reminders as a list you edit, rather than a row of preset
 * toggles: the presets could only ever offer four lead times, and there was no
 * way to see at a glance which ones an event actually had.
 */
export default function RemindersField({ value, onChange }: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  // null = closed; 'new' = adding; a number = editing that reminder
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const sorted = [...value].sort((a, b) => a - b);

  function save(minutes: number) {
    const without = editing === 'new' ? value : value.filter(m => m !== editing);
    if (without.includes(minutes)) return; // no duplicates
    onChange([...without, minutes].sort((a, b) => a - b));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-xs">
        <label className={`${labelClass} mb-0`}>Notifications</label>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="flex items-center gap-0.5 text-label-md font-semibold text-primary-fixed-dim hover:bg-fill-strong rounded px-xs py-0.5 transition-colors"
        >
          <span className="material-symbols-outlined block" style={{ fontSize: 16 }}>add</span>
          Add
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-[11px] text-txt-muted">No notifications for this event.</p>
      ) : (
        <div className="space-y-xs">
          {sorted.map(minutes => (
            <div
              key={minutes}
              className="flex items-center gap-sm py-xs px-sm rounded-lg bg-fill"
            >
              <span className="material-symbols-outlined block text-txt-faint flex-shrink-0" style={{ fontSize: 16 }}>
                notifications
              </span>
              <span className="text-body-sm text-txt flex-1 min-w-0 truncate">
                {reminderLabel(minutes)}
              </span>
              <button
                type="button"
                title="Edit"
                onClick={() => setEditing(minutes)}
                className="text-txt-muted hover:text-txt transition-colors flex-shrink-0"
              >
                <span className="material-symbols-outlined block" style={{ fontSize: 16 }}>edit</span>
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => onChange(value.filter(m => m !== minutes))}
                className="text-txt-muted hover:text-danger transition-colors flex-shrink-0"
              >
                <span className="material-symbols-outlined block" style={{ fontSize: 16 }}>delete</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {editing != null && (
        <ReminderDialog
          initial={editing === 'new' ? null : editing}
          taken={value}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
