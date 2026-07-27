/** Swatches offered in the picker. Any hex works; these just look good on both surfaces. */
export const PALETTE: string[] = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
];

/** Colors used before the palette existed, kept readable in old saves. */
const LEGACY: Record<string, string> = {
  primary: '#2563eb',
  secondary: '#00a06c',
  tertiary: '#d22348',
};

export const DEFAULT_COLOR = '#3b82f6';

/**
 * Alpha suffix for the tinted background behind a colored chip. The calendar
 * sheet is a dark surface in three of the four themes, where the old `1a`
 * washed out to nothing.
 */
export const PILL_BG_ALPHA = '2e';

/** Resolve a stored color (hex or legacy named key) to a hex string. */
export function colorHex(key: string | null | undefined): string {
  if (!key) return DEFAULT_COLOR;
  return key.startsWith('#') ? key : LEGACY[key] ?? DEFAULT_COLOR;
}
