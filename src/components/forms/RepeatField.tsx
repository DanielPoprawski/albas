import { cn } from '@/lib/utils';
import { monthPosition, parse, rotateWeek } from '../../dates';
import { NTH_WORDS } from '../../seedLogic';
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
  /** A monthly rule's shape: chosen days, the start's weekday nth in the month, or its last. */
  monthBy: 'day' | 'nth' | 'last';
  /** Days of the month for `monthBy: 'day'`; empty = the start date's day. */
  monthDays: number[];
  fromDone: boolean;
  custom: boolean;
  times: string;
  per: 'week' | 'month';
  until: string;
}

type Preset =
  | 'none'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'monthlyNth'
  | 'monthlyLast'
  | 'yearly'
  | 'custom'
  | 'timesPer';

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
  monthBy: 'day',
  monthDays: [],
  fromDone: false,
  custom: false,
  times: '3',
  per: 'week',
  until: '',
};

/** A draft that mirrors a stored rule; the other branches hold their defaults. */
export function draftFromRepeat(repeat: Repeat | undefined): RepeatDraft {
  switch (repeat?.type) {
    case 'every': {
      const days = repeat.days ?? [];
      const monthDays = repeat.monthDays ?? [];
      return {
        ...DEFAULTS,
        choice: 'every',
        n: String(repeat.n),
        unit: repeat.unit,
        days,
        monthBy: repeat.nth === -1 ? 'last' : repeat.nth ? 'nth' : 'day',
        monthDays,
        fromDone: !!repeat.fromDone,
        // anything a preset can't say reopens as Custom
        custom:
          repeat.n > 1 || monthDays.length > 0 || (repeat.unit === 'week' && days.length > 0 && !isWeekdays(days)),
        until: repeat.until ?? '',
      };
    }
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

/** The Select's reading of a draft. A 5th-week date has no "fifth", so its nth reads as last. */
function presetOf(d: RepeatDraft, date: string): Preset {
  if (d.choice !== 'every') return d.choice;
  if (d.custom) return 'custom';
  if (d.unit === 'week') return isWeekdays(d.days) ? 'weekdays' : 'weekly';
  if (d.unit === 'month') {
    if (d.monthBy === 'day') return 'monthly';
    return d.monthBy === 'last' || (date && monthPosition(date).nth > 4) ? 'monthlyLast' : 'monthlyNth';
  }
  return d.unit === 'day' ? 'daily' : 'yearly';
}

/** What picking a preset sets, leaving `until` and `fromDone` alone. */
function applyPreset(d: RepeatDraft, p: Preset): RepeatDraft {
  const every = (unit: RepeatUnit, extra: Partial<RepeatDraft> = {}): RepeatDraft => ({
    ...d,
    choice: 'every',
    custom: false,
    n: '1',
    unit,
    days: [],
    monthBy: 'day',
    monthDays: [],
    ...extra,
  });
  switch (p) {
    case 'none':
    case 'timesPer':
      return { ...d, choice: p };
    case 'custom':
      return { ...d, choice: 'every', custom: true };
    case 'daily':
      return every('day');
    case 'weekdays':
      return every('week', { days: WEEKDAYS });
    case 'weekly':
      return every('week');
    case 'monthly':
      return every('month');
    case 'monthlyNth':
      return every('month', { monthBy: 'nth' });
    case 'monthlyLast':
      return every('month', { monthBy: 'last' });
    case 'yearly':
      return every('year');
  }
}

/**
 * The Select's options, read off the start date ("Weekly on Friday",
 * "Monthly on the second Friday") when there is one, plain words otherwise.
 * Options the date can't support are hidden unless they are the current one.
 */
function presetOptions(date: string, doable: boolean, current: Preset): { value: Preset; label: string }[] {
  const d = date ? parse(date) : null;
  const pos = date ? monthPosition(date) : null;
  const weekday = d?.toLocaleDateString(undefined, { weekday: 'long' }) ?? 'weekday';
  const options: { value: Preset; label: string; show?: boolean }[] = [
    { value: 'none', label: "Doesn't repeat" },
    { value: 'daily', label: 'Daily' },
    { value: 'weekdays', label: 'Every weekday (Mon–Fri)' },
    { value: 'weekly', label: d ? `Weekly on ${weekday}` : 'Weekly' },
    { value: 'monthly', label: d ? `Monthly on day ${d.getDate()}` : 'Monthly' },
    {
      value: 'monthlyNth',
      label: `Monthly on the ${pos ? NTH_WORDS[pos.nth] : 'same'} ${weekday}`,
      show: !!pos && pos.nth <= 4,
    },
    { value: 'monthlyLast', label: `Monthly on the last ${weekday}`, show: !!pos?.last },
    {
      value: 'yearly',
      label: d ? `Annually on ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}` : 'Yearly',
    },
    { value: 'custom', label: 'Custom…' },
    { value: 'timesPer', label: 'Times per week / month…', show: doable },
  ];
  return options.filter((o) => (o.show ?? true) || o.value === current);
}

function count(text: string): number | null {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * `null` when the active branch is invalid (N below 1). `date` is the start
 * date the monthly `nth` is read off, so moving it keeps the rule consistent.
 * `exdates` survive an edit to the rest of the series.
 */
export function buildRepeat(d: RepeatDraft, date: string, exdates?: string[]): Repeat | null {
  const until = d.until || null;
  switch (d.choice) {
    case 'none':
      return { type: 'none' };
    case 'every': {
      const n = count(d.n);
      if (n === null) return null;
      const month: { monthDays?: number[]; nth?: number } = {};
      if (d.unit === 'month' && !d.fromDone) {
        if (d.monthBy === 'last') month.nth = -1;
        else if (d.monthBy === 'nth') {
          // a 5th-week date has no "fifth": it is the last
          if (date) month.nth = monthPosition(date).nth > 4 ? -1 : monthPosition(date).nth;
        } else if (d.monthDays.length) {
          // -1 (the last day) sorts after the 31st
          month.monthDays = [...d.monthDays].sort((a, b) => (a === -1 ? 32 : a) - (b === -1 ? 32 : b));
        }
      }
      return {
        type: 'every',
        n,
        unit: d.unit,
        ...(d.unit === 'week' && !d.fromDone && d.days.length ? { days: [...d.days].sort() } : {}),
        ...month,
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
  return buildRepeat(d, '') ? null : 'Enter a number of 1 or more.';
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

/** The 1–31 toggles plus "Last day". An empty value stands for `startDay`, so a toggle acts on that. */
function MonthDayPicker({
  value,
  startDay,
  onChange,
}: {
  value: number[];
  startDay: number;
  onChange: (days: number[]) => void;
}) {
  const days = value.length ? value : startDay ? [startDay] : [];
  const cell = (day: number, label: string, className?: string) => {
    const active = days.includes(day);
    return (
      <button
        key={day}
        type="button"
        aria-pressed={active}
        onClick={() => onChange(active ? days.filter((d) => d !== day) : [...days, day])}
        className={cn(
          'h-8 max-md:h-10 text-meta font-bold transition-all cursor-pointer',
          active ? 'bg-accent text-on-accent' : 'bg-subtle-strong text-ink-muted hover:bg-line-strong',
          className,
        )}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="grid grid-cols-7 gap-xs">
      {Array.from({ length: 31 }, (_, i) => cell(i + 1, String(i + 1)))}
      {cell(-1, 'Last day', 'col-span-4')}
    </div>
  );
}

/**
 * The repeat rule builder: a Select of presets, then the inputs the chosen
 * rule needs. Controlled — the owning form keeps the draft and turns it into
 * a `Repeat` with `buildRepeat` when it commits. `date` is the seed's start
 * date, which names the presets; `doable` gates the habit-only rules.
 */
export default function RepeatField({
  value,
  onChange,
  firstDayOfWeek,
  date,
  doable,
}: {
  value: RepeatDraft;
  onChange: (draft: RepeatDraft) => void;
  firstDayOfWeek: FirstDayOfWeek;
  date: string;
  doable: boolean;
}) {
  const patch = (p: Partial<RepeatDraft>) => onChange({ ...value, ...p });
  const n = count(value.n) ?? 1;
  const preset = presetOf(value, date);
  const pos = date ? monthPosition(date) : null;
  const weekday = date ? parse(date).toLocaleDateString(undefined, { weekday: 'long' }) : 'weekday';
  // a 5th-week date's nth is "last" — same reading as `presetOf`
  const monthBy = value.monthBy === 'nth' && pos && pos.nth > 4 ? 'last' : value.monthBy;

  return (
    <div className="flex flex-col gap-sm">
      <Select
        options={presetOptions(date, doable, preset)}
        value={preset}
        onChange={(p) => onChange(applyPreset(value, p))}
      />

      {preset === 'custom' && (
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

      {preset === 'custom' && value.unit === 'week' && !value.fromDone && (
        <WeekdayPicker value={value.days} onChange={(days) => patch({ days })} firstDayOfWeek={firstDayOfWeek} />
      )}

      {preset === 'custom' && value.unit === 'month' && !value.fromDone && (
        <>
          <Select
            options={[
              { value: 'day' as const, label: 'On days' },
              {
                value: 'nth' as const,
                label: `On the ${pos ? NTH_WORDS[pos.nth] : 'same'} ${weekday}`,
                show: !!pos && pos.nth <= 4,
              },
              { value: 'last' as const, label: `On the last ${weekday}`, show: !!pos?.last },
            ].filter((o) => (o.show ?? true) || o.value === monthBy)}
            value={monthBy}
            onChange={(monthBy) => patch({ monthBy })}
          />
          {monthBy === 'day' && (
            <MonthDayPicker
              value={value.monthDays}
              startDay={date ? parse(date).getDate() : 0}
              onChange={(monthDays) => patch({ monthDays })}
            />
          )}
        </>
      )}

      {value.choice === 'every' && (doable || value.fromDone) && (
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
