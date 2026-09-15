import { useState } from 'react';
import { Bell, Pencil, Plus, Trash2 } from 'lucide-react';
import { REMINDER_PRESETS, reminderLabel } from '../../reminders';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { inputClass, labelClass, Select } from './shared';

const PRESETS: readonly number[] = REMINDER_PRESETS;

type Unit = 'minutes' | 'hours' | 'days' | 'weeks';
const UNIT_MINUTES: Record<Unit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
};

/**
 * Add/edit one reminder. Presets cover the common cases; "Custom" is there so
 * the list doesn't have to guess every lead time anyone might want.
 */
function ReminderDialog({
  initial,
  taken,
  onSave,
  onClose,
}: {
  initial: number | null;
  taken: number[];
  onSave: (minutes: number) => void;
  onClose: () => void;
}) {
  const isPreset = initial != null && PRESETS.includes(initial);
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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[min(22rem,calc(100%-2rem))] max-h-[80vh] overflow-y-auto scrollbar-hide"
      >
        <DialogTitle>{initial == null ? 'Add notification' : 'Edit notification'}</DialogTitle>

        {!custom ? (
          <div className="space-y-xs">
            {PRESETS.map((minutes) => {
              // already-used lead times would silently collapse into one
              const used = taken.includes(minutes) && minutes !== initial;
              return (
                <button
                  key={minutes}
                  type="button"
                  disabled={used}
                  onClick={() => save(minutes)}
                  className={`w-full py-sm px-sm text-left text-sm transition-colors ${
                    used ? 'text-ink-muted cursor-default' : 'text-ink bg-subtle hover:bg-subtle-strong'
                  }`}
                >
                  {reminderLabel(minutes)}
                  {used && <span className="text-xs ml-xs">already added</span>}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCustom(true)}
              className="w-full py-sm px-sm text-left text-sm text-accent bg-subtle hover:bg-subtle-strong transition-colors"
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
                  onChange={(e) => setAmount(e.target.value)}
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
                className="px-md py-sm text-sm text-ink-muted hover:bg-subtle transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={saveCustom}
                className="flex-1 py-sm bg-accent text-on-accent font-semibold text-sm hover:bg-accent-hover active:scale-95 transition-all"
              >
                {initial == null ? 'Add' : 'Save'}
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-sm py-sm text-center text-sm text-ink-muted hover:bg-subtle transition-colors"
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
export default function RemindersField({ value, onChange }: { value: number[]; onChange: (next: number[]) => void }) {
  // null = closed; 'new' = adding; a number = editing that reminder
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const sorted = [...value].sort((a, b) => a - b);

  function save(minutes: number) {
    const without = editing === 'new' ? value : value.filter((m) => m !== editing);
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
          className="flex items-center gap-0.5 text-xs font-semibold text-accent hover:bg-subtle-strong px-xs py-0.5 transition-colors"
        >
          <Plus size="0.875rem" />
          Add
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-ink-muted">No notifications for this event.</p>
      ) : (
        <div className="space-y-xs">
          {sorted.map((minutes) => (
            <div key={minutes} className="flex items-center gap-sm py-xs px-sm bg-subtle">
              <Bell size="0.9375rem" className="text-ink-muted flex-shrink-0" />
              <span className="text-sm text-ink flex-1 min-w-0 truncate">{reminderLabel(minutes)}</span>
              <button
                type="button"
                title="Edit"
                onClick={() => setEditing(minutes)}
                className="text-ink-muted hover:text-ink transition-colors flex-shrink-0"
              >
                <Pencil size="0.875rem" />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => onChange(value.filter((m) => m !== minutes))}
                className="text-ink-muted hover:text-danger transition-colors flex-shrink-0"
              >
                <Trash2 size="0.875rem" />
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
