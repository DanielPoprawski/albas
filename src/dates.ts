export function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parse(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from `fromStr` to `toStr` (negative if `toStr` is earlier). */
export function diffDays(fromStr: string, toStr: string): number {
  const ms = parse(toStr).getTime() - parse(fromStr).getTime();
  // Math.round absorbs DST's ±1h drift
  return Math.round(ms / 86_400_000);
}

/** `dateStr` shifted by `n` days (n may be negative). */
export function addDays(dateStr: string, n: number): string {
  const d = parse(dateStr);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

/** "2026-07-04" -> "Jul 4" */
export function shortDate(dateStr: string): string {
  return parse(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "2026-07-04" -> "Saturday, Jul 4" */
export function longDate(dateStr: string): string {
  return parse(dateStr).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Mon–Sun dates of the week containing `d`. */
export function weekOf(d: Date): string[] {
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return fmt(day);
  });
}
