import { rotateWeek } from '../../dates';
import type { FirstDayOfWeek } from '../../types';
import type { Repeat, RepeatUnit } from '../../types';
import { CheckboxRow, inputClass, Select } from './shared';

/**
 * The repeat rule as the form holds it: every branch's inputs live side by
 * side (numbers as raw text so a half-typed field doesn't snap back), and
 * `buildRepeat` folds the active one into a `Repeat` on commit.
 */
export type RepeatChoice = 'once' | 'daily' | 'weekdays' | 'every' | 'timesPer';

export interface RepeatDraft {
  choice: RepeatChoice;
  weekdays: number[];
  everyN: string;
  everyUnit: RepeatUnit;
  fromDone: boolean;
  times: string;
  per: 'week' | 'month';
}

export const REPEAT_OPTIONS: { value: RepeatChoice; label: string }[] = [
  { value: 'once', label: "Doesn't repeat" },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Days of the week' },
  { value: 'every', label: 'Every N days / weeks / months' },
  { value: 'timesPer', label: 'N times per week / month' },
];

// Sunday-first (matching getDay()); rotated into the user's display order
const WEEKDAY_OPTIONS = [
  { day: 0, label: 'S' },
  { day: 1, label: 'M' },
  { day: 2, label: 'T' },
  { day: 3, label: 'W' },
  { day: 4, label: 'T' },
  { day: 5, label: 'F' },
  { day: 6, label: 'S' },
];

const DEFAULTS: Omit<RepeatDraft, 'choice'> = {
  weekdays: [1, 2, 3, 4, 5],
  everyN: '3',
  everyUnit: 'day',
  fromDone: false,
  times: '3',
  per: 'week',
};

/** A draft that mirrors an existing rule; the other branches hold their defaults. */
export function draftFromRepeat(repeat: Repeat | undefined): RepeatDraft {
  const base: RepeatDraft = { choice: repeat?.type ?? 'once', ...DEFAULTS };
  switch (repeat?.type) {
    case 'weekdays':
      return { ...base, weekdays: repeat.days };
    case 'every':
      return { ...base, everyN: String(repeat.n), everyUnit: repeat.unit, fromDone: repeat.fromDone };
    case 'timesPer':
      return { ...base, times: String(repeat.times), per: repeat.per };
    default:
      return base;
  }
}

/** `null` when the active branch is invalid (no weekday picked, N below 1). */
export function buildRepeat(d: RepeatDraft): Repeat | null {
  switch (d.choice) {
    case 'once':
      return { type: 'once' };
    case 'daily':
      return { type: 'daily' };
    case 'weekdays':
      return d.weekdays.length === 0 ? null : { type: 'weekdays', days: d.weekdays };
    case 'every': {
      const n = parseInt(d.everyN, 10);
      if (!Number.isFinite(n) || n < 1) return null;
      return { type: 'every', n, unit: d.everyUnit, fromDone: d.fromDone };
    }
    case 'timesPer': {
      const n = parseInt(d.times, 10);
      if (!Number.isFinite(n) || n < 1) return null;
      return { type: 'timesPer', times: n, per: d.per };
    }
  }
}

/** What `buildRepeat` returning null means for this draft, in the user's words. */
export function repeatError(d: RepeatDraft): string {
  return d.choice === 'weekdays' ? 'Pick at least one day of the week.' : 'Enter a number of 1 or more.';
}

/**
 * The repeat rule builder: a Select for the kind of rule, then the inputs
 * that rule needs. Controlled — the owning form keeps the draft and turns it
 * into a `Repeat` with `buildRepeat` when it commits.
 */
export default function RepeatField({
  value,
  onChange,
  firstDayOfWeek,
  /** Leave out "Doesn't repeat" (a habit always repeats). */
  repeatingOnly = false,
}: {
  value: RepeatDraft;
  onChange: (draft: RepeatDraft) => void;
  firstDayOfWeek: FirstDayOfWeek;
  repeatingOnly?: boolean;
}) {
  const patch = (p: Partial<RepeatDraft>) => onChange({ ...value, ...p });
  const options = repeatingOnly ? REPEAT_OPTIONS.filter((o) => o.value !== 'once') : REPEAT_OPTIONS;
  const everyN = parseInt(value.everyN, 10);

  function toggleWeekday(day: number) {
    patch({
      weekdays: value.weekdays.includes(day) ? value.weekdays.filter((d) => d !== day) : [...value.weekdays, day],
    });
  }

  return (
    <div>
      <Select options={options} value={value.choice} onChange={(choice) => patch({ choice })} />

      {value.choice === 'weekdays' && (
        <div className="flex gap-xs mt-sm">
          {rotateWeek(WEEKDAY_OPTIONS, firstDayOfWeek).map(({ day, label }) => (
            <button
              key={day}
              type="button"
              aria-pressed={value.weekdays.includes(day)}
              onClick={() => toggleWeekday(day)}
              className={`flex-1 h-8 text-meta font-bold transition-all ${
                value.weekdays.includes(day)
                  ? 'bg-accent text-on-accent'
                  : 'bg-subtle-strong text-ink-muted hover:bg-line-strong'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {value.choice === 'every' && (
        <div className="mt-sm space-y-sm">
          <div className="flex items-center gap-sm">
            <span className="text-body-sm text-ink-muted">Every</span>
            <input
              type="number"
              min="1"
              className={`${inputClass} text-center w-[4.5rem]`}
              value={value.everyN}
              onChange={(e) => patch({ everyN: e.target.value })}
            />
            <Select
              className="flex-1"
              options={[
                { value: 'day', label: everyN === 1 ? 'day' : 'days' },
                { value: 'week', label: everyN === 1 ? 'week' : 'weeks' },
                { value: 'month', label: everyN === 1 ? 'month' : 'months' },
              ]}
              value={value.everyUnit}
              onChange={(everyUnit) => patch({ everyUnit })}
            />
          </div>
          <CheckboxRow
            checked={value.fromDone}
            onChange={(fromDone) => patch({ fromDone })}
            label="Count from the last time it was done"
            hint="Chore-style: skipping a day pushes the next one back. Off = fixed schedule, due again whether or not the last one happened."
          />
        </div>
      )}

      {value.choice === 'timesPer' && (
        <div className="flex items-center gap-sm mt-sm">
          <input
            type="number"
            min="1"
            className={`${inputClass} text-center w-[4.5rem]`}
            value={value.times}
            onChange={(e) => patch({ times: e.target.value })}
          />
          <span className="text-body-sm text-ink-muted">times per</span>
          <Select
            className="flex-1"
            options={[
              { value: 'week', label: 'week' },
              { value: 'month', label: 'month' },
            ]}
            value={value.per}
            onChange={(per) => patch({ per })}
          />
        </div>
      )}
    </div>
  );
}
