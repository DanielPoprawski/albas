import { cn } from '@/lib/utils';
import { rotateWeek } from '../../dates';
import type { FirstDayOfWeek, Repeat, RepeatUnit } from '../../types';
import DateField from './DateField';
import { CheckboxRow, inputClass, Select } from './shared';

/**
 * The repeat rule as the form holds it: every branch's inputs live side by
 * side (numbers as raw text so a half-typed field doesn't snap back), and
 * `buildRepeat` folds the active one into a `Repeat` on commit. `custom` is
 * whether the "Every N unit" inputs show; the presets set N to 1.
 */
export interface RepeatDraft {
  choice: 'none' | 'every' | 'timesPer';
  n: string;
  unit: RepeatUnit;
  /** Weekdays for a weekly rule; empty = the start date's weekday. */
  days: number[];
  fromDone: boolean;
  custom: boolean;
  times: string;
  per: 'week' | 'month';
  until: string;
}

type Preset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'timesPer';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'none', label: "Doesn't repeat" },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Every weekday (Mon–Fri)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom…' },
  { value: 'timesPer', label: 'Times per week / month…' },
];

const WEEKDAYS = [1, 2, 3, 4, 5];
const isWeekdays = (days: number[]) => days.length === 5 && WEEKDAYS.every((d) => days.includes(d));

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

const DEFAULTS: RepeatDraft = {
  choice: 'none',
  n: '1',
  unit: 'day',
  days: [],
  fromDone: false,
  custom: false,
  times: '3',
  per: 'week',
  until: '',
};

/** A draft that mirrors a stored rule; the other branches hold their defaults. */
export function draftFromRepeat(repeat: Repeat | undefined): RepeatDraft {
  switch (repeat?.type) {
    case 'every':
      return {
        ...DEFAULTS,
        choice: 'every',
        n: String(repeat.n),
        unit: repeat.unit,
        days: repeat.days ?? [],
        fromDone: !!repeat.fromDone,
        custom: repeat.n > 1,
        until: repeat.until ?? '',
      };
    case 'timesPer':
      return {
        ...DEFAULTS,
        choice: 'timesPer',
        times: String(repeat.times),
        per: repeat.per,
        until: repeat.until ?? '',
      };
    default:
      return DEFAULTS;
  }
}

/** The Select's reading of a draft. */
function presetOf(d: RepeatDraft): Preset {
  if (d.choice !== 'every') return d.choice;
  if (d.custom) return 'custom';
  if (d.unit === 'week') return isWeekdays(d.days) ? 'weekdays' : 'weekly';
  return d.unit === 'day' ? 'daily' : d.unit === 'month' ? 'monthly' : 'yearly';
}

/** What picking a preset sets, leaving `until` and `fromDone` alone. */
function applyPreset(d: RepeatDraft, p: Preset): RepeatDraft {
  switch (p) {
    case 'none':
    case 'timesPer':
      return { ...d, choice: p };
    case 'custom':
      return { ...d, choice: 'every', custom: true };
    case 'daily':
      return { ...d, choice: 'every', custom: false, n: '1', unit: 'day', days: [] };
    case 'weekdays':
      return { ...d, choice: 'every', custom: false, n: '1', unit: 'week', days: WEEKDAYS };
    case 'weekly':
      return { ...d, choice: 'every', custom: false, n: '1', unit: 'week', days: [] };
    case 'monthly':
      return { ...d, choice: 'every', custom: false, n: '1', unit: 'month', days: [] };
    case 'yearly':
      return { ...d, choice: 'every', custom: false, n: '1', unit: 'year', days: [] };
  }
}

function count(text: string): number | null {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** `null` when the active branch is invalid (N below 1). `exdates` survive an edit to the rest of the series. */
export function buildRepeat(d: RepeatDraft, exdates?: string[]): Repeat | null {
  const until = d.until || null;
  switch (d.choice) {
    case 'none':
      return { type: 'none' };
    case 'every': {
      const n = count(d.n);
      if (n === null) return null;
      return {
        type: 'every',
        n,
        unit: d.unit,
        ...(d.unit === 'week' && d.days.length ? { days: [...d.days].sort() } : {}),
        ...(d.fromDone ? { fromDone: true } : {}),
        until,
        ...(exdates?.length ? { exdates } : {}),
      };
    }
    case 'timesPer': {
      const times = count(d.times);
      if (times === null) return null;
      return { type: 'timesPer', times, per: d.per, until };
    }
  }
}

/** What `buildRepeat` returning null means for this draft, in the user's words; null when it is valid. */
export function repeatError(d: RepeatDraft): string | null {
  return buildRepeat(d) ? null : 'Enter a number of 1 or more.';
}

/** The seven weekday toggles, in the user's week order. */
export function WeekdayPicker({
  value,
  onChange,
  firstDayOfWeek,
  className,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  firstDayOfWeek: FirstDayOfWeek;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-xs', className)}>
      {rotateWeek(WEEKDAY_OPTIONS, firstDayOfWeek).map(({ day, label }) => {
        const active = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? value.filter((d) => d !== day) : [...value, day])}
            className={cn(
              'flex-1 h-8 max-md:h-10 text-meta font-bold transition-all cursor-pointer',
              active ? 'bg-accent text-on-accent' : 'bg-subtle-strong text-ink-muted hover:bg-line-strong',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The repeat rule builder: a Select of presets, then the inputs the chosen
 * rule needs. Controlled — the owning form keeps the draft and turns it into
 * a `Repeat` with `buildRepeat` when it commits.
 */
export default function RepeatField({
  value,
  onChange,
  firstDayOfWeek,
}: {
  value: RepeatDraft;
  onChange: (draft: RepeatDraft) => void;
  firstDayOfWeek: FirstDayOfWeek;
}) {
  const patch = (p: Partial<RepeatDraft>) => onChange({ ...value, ...p });
  const n = count(value.n) ?? 1;

  return (
    <div className="flex flex-col gap-sm">
      <Select options={PRESETS} value={presetOf(value)} onChange={(p) => onChange(applyPreset(value, p))} />

      {value.choice === 'every' && value.custom && (
        <div className="flex items-center gap-sm">
          <span className="text-sm text-ink-muted">Every</span>
          <input
            type="number"
            min="1"
            aria-label="Repeat interval"
            className={`${inputClass} text-center w-[4.5rem]`}
            value={value.n}
            onChange={(e) => patch({ n: e.target.value })}
          />
          <Select
            className="flex-1"
            options={[
              { value: 'day', label: n === 1 ? 'day' : 'days' },
              { value: 'week', label: n === 1 ? 'week' : 'weeks' },
              { value: 'month', label: n === 1 ? 'month' : 'months' },
              { value: 'year', label: n === 1 ? 'year' : 'years' },
            ]}
            value={value.unit}
            onChange={(unit) => patch({ unit })}
          />
        </div>
      )}

      {value.choice === 'every' && value.unit === 'week' && (
        <WeekdayPicker value={value.days} onChange={(days) => patch({ days })} firstDayOfWeek={firstDayOfWeek} />
      )}

      {value.choice === 'every' && (
        <CheckboxRow
          checked={value.fromDone}
          onChange={(fromDone) => patch({ fromDone })}
          label="Count from the last time it was done"
          hint="Chore-style: skipping a day pushes the next one back. Off = fixed schedule, due again whether or not the last one happened."
        />
      )}

      {value.choice === 'timesPer' && (
        <div className="flex items-center gap-sm">
          <input
            type="number"
            min="1"
            aria-label="Times per period"
            className={`${inputClass} text-center w-[4.5rem]`}
            value={value.times}
            onChange={(e) => patch({ times: e.target.value })}
          />
          <span className="text-sm text-ink-muted">times per</span>
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

      {value.choice !== 'none' && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <span>until</span>
          <DateField
            value={value.until}
            onChange={(until) => patch({ until })}
            allowEmpty
            placeholder="forever"
            className="w-40"
            aria-label="Repeat until"
          />
        </div>
      )}
    </div>
  );
}
