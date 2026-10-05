// Reminder lead times, in minutes before an event's start (or a to-do's
// time). One table for both surfaces that offer them: the Add modal's chips
// and the bulk-edit panel.

/** The short list the chip surfaces (Add modal, bulk panel) show. */
export const REMINDER_QUICK = [0, 5, 10, 15, 30, 60, 1440, 10_080] as const;

/** A bulk-edit choice: no reminder, or one lead time. */
export type ReminderChoice = 'none' | number;

type Unit = 'week' | 'day' | 'hour' | 'minute';
const UNITS: [Unit, number][] = [
  ['week', 10_080],
  ['day', 1440],
  ['hour', 60],
  ['minute', 1],
];

/**
 * Minutes-before as words, in the largest unit that divides evenly:
 * `long` reads "10 minutes before"; `short` is chip-sized, "10 min".
 */
export function reminderLabel(minutes: number, style: 'long' | 'short' = 'long'): string {
  if (minutes === 0) return style === 'short' ? 'At time' : 'At start time';
  const [unit, size] = UNITS.find(([, s]) => minutes % s === 0) ?? ['minute', 1];
  const n = minutes / size;
  if (style === 'short') {
    const word = unit === 'minute' ? 'min' : n === 1 ? unit : `${unit}s`;
    return `${n} ${word}`;
  }
  return `${n} ${n === 1 ? unit : `${unit}s`} before`;
}

// Below `reminderLabel` and `UNITS`: built at module load.
export const REMINDER_CHOICES: { value: ReminderChoice; label: string }[] = [
  { value: 'none', label: 'None' },
  ...REMINDER_QUICK.map((m) => ({ value: m as ReminderChoice, label: reminderLabel(m, 'short') })),
];
