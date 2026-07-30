/**
 * Desktop picker: 12 hues across, three shades down (light / base / dark), so
 * a column is one hue and a row is one intensity. Any hex works; these are
 * chosen to stay legible on both the chrome and the sheet.
 */
export const PALETTE_ROWS: string[][] = [
  // light
  ['#fca5a5', '#fdba74', '#fcd34d', '#fde047', '#bef264', '#86efac',
   '#6ee7b7', '#5eead4', '#7dd3fc', '#93c5fd', '#c4b5fd', '#f0abfc'],
  // base
  ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
   '#10b981', '#14b8a6', '#0ea5e9', '#3b82f6', '#8b5cf6', '#d946ef'],
  // dark
  ['#991b1b', '#9a3412', '#b45309', '#a16207', '#3f6212', '#15803d',
   '#047857', '#0f766e', '#0369a1', '#1d4ed8', '#5b21b6', '#a21caf'],
];

/**
 * The last desktop row: black through white in eleven steps. The twelfth cell
 * is the colour wheel, which is why this stops at eleven.
 */
export const GREY_RAMP: string[] = [
  '#000000', '#1a1a1a', '#333333', '#4d4d4d', '#666666', '#808080',
  '#999999', '#b3b3b3', '#cccccc', '#e6e6e6', '#ffffff',
];

/**
 * Phone picker: one row, so it's seven hues and the wheel. Sampled across the
 * base row rather than crammed — a second row of swatches costs more vertical
 * space than a phone form can spare.
 */
export const PALETTE_COMPACT: string[] = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#8b5cf6', '#ec4899',
];

/** Every named swatch, for "is this a custom colour?" checks. */
export const PALETTE: string[] = [
  ...PALETTE_ROWS.flat(),
  ...GREY_RAMP,
  ...PALETTE_COMPACT,
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
