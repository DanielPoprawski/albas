/**
 * Colour tokens for the redesign, plus the palette the colour pickers draw.
 *
 * The CSS side of this lives in `App.css` (`--t-*` on `:root`). This module is
 * the TypeScript mirror, for the places that need a literal hex rather than a
 * class: an inline `style={{ background }}`, a canvas, an ICS export.
 */

/** The core palette. One light theme, one purple accent. */
export const COLORS = {
  bg: '#f8fafb',
  surface: '#ffffff',
  border: '#e5e7eb',
  borderStrong: '#d1d5db',
  subtle: '#f3f4f6',
  accent: '#a855f7',
  accentHover: '#9333ea',
  accentDeep: '#7e22ce',
  accentTint: '#faf5ff',
  text: '#1a202c',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  danger: '#ef4444',
  success: '#10b981',
} as const;

/** A category accent and the three shades a chip drawn in it needs. */
export interface CategoryAccent {
  /** The mark colour — dots, bars, habit squares, the solid section header. */
  hex: string;
  /** Chip background. */
  tint: string;
  /** Chip hairline. */
  line: string;
  /** Text on `tint`. */
  ink: string;
}

/**
 * Category accents. **Small marks only** — a dot, a pill, a 7px swatch, a
 * habit square. Never a large fill: the surfaces in this design are white and
 * the accent doing the branding is purple.
 */
export const CATEGORY_ACCENTS = {
  purple: { hex: '#a855f7', tint: '#f3e8ff', line: '#e9d5ff', ink: '#6b21a8' },
  amber: { hex: '#f59e0b', tint: '#fef3c7', line: '#fcd34d', ink: '#92400e' },
  green: { hex: '#10b981', tint: '#dcfce7', line: '#bbf7d0', ink: '#166534' },
  blue: { hex: '#3b82f6', tint: '#dbeafe', line: '#bfdbfe', ink: '#1e40af' },
  pink: { hex: '#ec4899', tint: '#fce7f3', line: '#fbcfe8', ink: '#831843' },
  teal: { hex: '#06b6d4', tint: '#cffafe', line: '#a5f3fc', ink: '#0e7490' },
} as const satisfies Record<string, CategoryAccent>;

export type CategoryAccentName = keyof typeof CATEGORY_ACCENTS;

/**
 * The starter categories the Add modal offers and the To-Do sidebar lists.
 *
 * `Todo.category` is free text derived from use — there is no managed list —
 * so this is a set of *suggestions*, not an enumeration. It lives here because
 * three components were each carrying their own copy and they disagreed: the
 * same "Work" was blue in the Add modal and purple in the sidebar. A category
 * has one colour or it has none.
 */
export const TODO_CATEGORIES: { label: string; hex: string }[] = [
  { label: 'Work', hex: CATEGORY_ACCENTS.blue.hex },
  { label: 'Personal', hex: CATEGORY_ACCENTS.purple.hex },
  { label: 'Shopping', hex: CATEGORY_ACCENTS.amber.hex },
  { label: 'Health', hex: CATEGORY_ACCENTS.green.hex },
  { label: 'Finance', hex: CATEGORY_ACCENTS.teal.hex },
];

/** The accent a category name should draw in, or the default for an unknown one. */
export function categoryAccent(label: string): CategoryAccent {
  const found = TODO_CATEGORIES.find(
    (c) => c.label.toLowerCase() === label.trim().toLowerCase(),
  );
  return accentOf(found?.hex ?? DEFAULT_COLOR);
}

/** The accent hexes in the order the designs list their categories. */
export const CATEGORY_HEXES: string[] = [
  CATEGORY_ACCENTS.purple.hex,
  CATEGORY_ACCENTS.pink.hex,
  CATEGORY_ACCENTS.green.hex,
  CATEGORY_ACCENTS.teal.hex,
  CATEGORY_ACCENTS.amber.hex,
  CATEGORY_ACCENTS.blue.hex,
];

/**
 * The tint/line/ink trio for an arbitrary stored colour.
 *
 * A category accent gets the hand-picked shades above — those are the ones the
 * designs draw. Anything else (a colour picked off the wheel) gets a derived
 * pair, which is why `tintOf` exists rather than a second lookup table.
 */
export function accentOf(hex: string): CategoryAccent {
  const found = Object.values(CATEGORY_ACCENTS).find(
    (a) => a.hex.toLowerCase() === hex.toLowerCase(),
  );
  return found ?? { hex, tint: tintOf(hex), line: tintOf(hex, 0.35), ink: hex };
}

/**
 * A hex with an alpha channel appended, for a tinted background behind a
 * user-chosen colour. Surfaces are white in this design, so the default is a
 * light wash — the pre-redesign 18% was tuned for a dark sheet.
 */
export function tintOf(hex: string, alpha = 0.12): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${colorHex(hex)}${a}`;
}

/**
 * Alpha suffix for the tinted background behind a colored chip, as a hex pair
 * appended to a 6-digit colour. Kept as a constant because call sites
 * concatenate it directly.
 */
export const PILL_BG_ALPHA = '1f';

/**
 * Desktop picker: 12 hues across, three shades down (light / base / dark), so
 * a column is one hue and a row is one intensity. The base row leads with the
 * redesign's own accents so the colours in the designs are one click away.
 */
export const PALETTE_ROWS: string[][] = [
  // light
  ['#fca5a5', '#fdba74', '#fcd34d', '#fde047', '#bef264', '#86efac',
   '#6ee7b7', '#67e8f9', '#7dd3fc', '#93c5fd', '#d8b4fe', '#f9a8d4'],
  // base
  ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
   '#10b981', '#06b6d4', '#0ea5e9', '#3b82f6', '#a855f7', '#ec4899'],
  // dark
  ['#991b1b', '#9a3412', '#b45309', '#a16207', '#3f6212', '#15803d',
   '#047857', '#0e7490', '#0369a1', '#1d4ed8', '#7e22ce', '#be185d'],
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
 * Phone picker: one row, so it's seven hues and the wheel. These are the
 * redesign's category accents plus red — a second row of swatches costs more
 * vertical space than a phone form can spare.
 */
export const PALETTE_COMPACT: string[] = [
  '#a855f7', '#ec4899', '#10b981', '#06b6d4', '#f59e0b', '#3b82f6', '#ef4444',
];

/** Every named swatch, for "is this a custom colour?" checks. */
export const PALETTE: string[] = [
  ...PALETTE_ROWS.flat(),
  ...GREY_RAMP,
  ...PALETTE_COMPACT,
];

/** Colors used before the palette existed, kept readable in old saves. */
const LEGACY: Record<string, string> = {
  primary: COLORS.accent,
  secondary: CATEGORY_ACCENTS.green.hex,
  tertiary: CATEGORY_ACCENTS.pink.hex,
};

export const DEFAULT_COLOR = COLORS.accent;

/** Resolve a stored color (hex or legacy named key) to a hex string. */
export function colorHex(key: string | null | undefined): string {
  if (!key) return DEFAULT_COLOR;
  return key.startsWith('#') ? key : LEGACY[key] ?? DEFAULT_COLOR;
}
