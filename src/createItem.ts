import { addMinutes } from './dates';
import type { ColorKey, NewSeed, Repeat, Routine } from './types';

/**
 * Everything a create surface may know about a new seed. Every field is
 * optional so a one-line quick-add and the full modal share one payload
 * builder; an omitted field is the default, not a choice.
 */
export interface CreateOptions {
  /** Can be ticked off. Off = an event. */
  doable?: boolean;
  /** Null = anytime (doable, non-repeating only). */
  date?: string | null;
  /** `HH:MM`; null/omitted = all-day. */
  time?: string | null;
  endDate?: string | null;
  /** Events default to an hour after `time`; a to-do has no duration unless given one. */
  endTime?: string | null;
  repeat?: Repeat;
  /** Count tracking when above 1 or when `unit` is given. */
  target?: number;
  unit?: string;
  location?: string;
  notes?: string;
  important?: boolean;
  list?: string;
  tags?: string[];
  /** Lead times in minutes before the start. */
  reminders?: number[];
  routine?: Routine;
  color?: ColorKey | null;
}

/** Builds the row a create surface persists; the caller hands it to `addSeed`. */
export function buildCreate(title: string, o: CreateOptions): NewSeed {
  const doable = !!o.doable;
  const date = o.date ?? null;
  const time = o.time || null;
  const endDate = date && o.endDate && o.endDate > date ? o.endDate : null;
  const endTime = time ? o.endTime || (doable ? null : addMinutes(time, 60)) : null;
  const target = Math.max(1, o.target ?? 1);
  const unit = o.unit?.trim() ?? '';
  const where = o.location?.trim() ?? '';
  const notes = o.notes?.trim() ?? '';
  return {
    title: title.trim(),
    // There is no `location` column; Where folds into the first paragraph of the notes.
    notes: [where && `Location: ${where}`, notes].filter(Boolean).join('\n\n'),
    color: o.color ?? null,
    list: o.list ?? '',
    tags: o.tags ?? [],
    important: !!o.important,
    // `addSeed` places a new habit last; every other order is the user's.
    sort: 0,
    routine: o.routine ?? '',
    date,
    time,
    endDate,
    endTime,
    repeat: o.repeat ?? { type: 'none' },
    track: doable ? (target > 1 || unit ? { kind: 'count', unit, target } : { kind: 'check' }) : null,
    reminders: o.reminders ?? [],
  };
}

/** Where + notes back out of the `Location: …` first paragraph `buildCreate` writes. */
export function splitLocation(notes: string): { location: string; notes: string } {
  const m = /^Location: ([^\n]*)(?:\n\n([\s\S]*))?$/.exec(notes);
  return m ? { location: m[1], notes: m[2] ?? '' } : { location: '', notes };
}
