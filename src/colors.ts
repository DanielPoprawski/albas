/**
 * Colour data for the app. Seeds, tags and the picker speak in `ColorKey`s;
 * the paint lives in `App.css` as `--t-c-<key>` token families (restated for
 * dark) and reaches an element as one of the literal classes below, so a
 * chip follows the theme instead of carrying a light-only hex.
 * `scripts/css-audit.mjs` asserts every key has its tokens in both themes.
 *
 * The one hex table left, `PALETTE_COMPACT`, is the theme-accent picker in
 * Settings › Appearance — a runtime override of `--t-accent`, not item paint.
 */

import type { ColorKey } from './types';

export const COLOR_KEYS: ColorKey[] = [
  'ink',
  'paper',
  'grey',
  'grey-dark',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
];

export const COLOR_LABELS: Record<ColorKey, string> = {
  ink: 'Ink',
  paper: 'Paper',
  grey: 'Grey',
  'grey-dark': 'Dark grey',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
};

/** What a seed with no colour of its own and no coloured tag wears. */
export const DEFAULT_COLOR: ColorKey = 'grey';

export interface ColorClasses {
  /** Solid mark: a dot, a bar, a habit square, a checked box. */
  bg: string;
  /** The mark colour as text: a tag icon, a coloured title. */
  text: string;
  /** Chip background. */
  tint: string;
  /** Chip hairline. */
  line: string;
  /** Text on `tint`. */
  ink: string;
}

/**
 * The Tailwind classes that paint a key from its tokens. Spelled out as
 * literals (not built from the key) so Tailwind emits them.
 */
export const COLOR_CLASSES: Record<ColorKey, ColorClasses> = {
  ink: { bg: 'bg-c-ink', text: 'text-c-ink', tint: 'bg-c-ink-tint', line: 'border-c-ink-line', ink: 'text-c-ink-ink' },
  paper: {
    bg: 'bg-c-paper',
    text: 'text-c-paper',
    tint: 'bg-c-paper-tint',
    line: 'border-c-paper-line',
    ink: 'text-c-paper-ink',
  },
  grey: {
    bg: 'bg-c-grey',
    text: 'text-c-grey',
    tint: 'bg-c-grey-tint',
    line: 'border-c-grey-line',
    ink: 'text-c-grey-ink',
  },
  'grey-dark': {
    bg: 'bg-c-grey-dark',
    text: 'text-c-grey-dark',
    tint: 'bg-c-grey-dark-tint',
    line: 'border-c-grey-dark-line',
    ink: 'text-c-grey-dark-ink',
  },
  red: { bg: 'bg-c-red', text: 'text-c-red', tint: 'bg-c-red-tint', line: 'border-c-red-line', ink: 'text-c-red-ink' },
  orange: {
    bg: 'bg-c-orange',
    text: 'text-c-orange',
    tint: 'bg-c-orange-tint',
    line: 'border-c-orange-line',
    ink: 'text-c-orange-ink',
  },
  yellow: {
    bg: 'bg-c-yellow',
    text: 'text-c-yellow',
    tint: 'bg-c-yellow-tint',
    line: 'border-c-yellow-line',
    ink: 'text-c-yellow-ink',
  },
  green: {
    bg: 'bg-c-green',
    text: 'text-c-green',
    tint: 'bg-c-green-tint',
    line: 'border-c-green-line',
    ink: 'text-c-green-ink',
  },
  teal: {
    bg: 'bg-c-teal',
    text: 'text-c-teal',
    tint: 'bg-c-teal-tint',
    line: 'border-c-teal-line',
    ink: 'text-c-teal-ink',
  },
  blue: {
    bg: 'bg-c-blue',
    text: 'text-c-blue',
    tint: 'bg-c-blue-tint',
    line: 'border-c-blue-line',
    ink: 'text-c-blue-ink',
  },
  purple: {
    bg: 'bg-c-purple',
    text: 'text-c-purple',
    tint: 'bg-c-purple-tint',
    line: 'border-c-purple-line',
    ink: 'text-c-purple-ink',
  },
  pink: {
    bg: 'bg-c-pink',
    text: 'text-c-pink',
    tint: 'bg-c-pink-tint',
    line: 'border-c-pink-line',
    ink: 'text-c-pink-ink',
  },
};

// --- Appearance (Settings › Appearance) ---

/**
 * The theme-accent swatches: one row, the redesign's accents plus red. A
 * second row costs more vertical space than a phone form can spare.
 */
export const PALETTE_COMPACT: string[] = ['#a855f7', '#ec4899', '#10b981', '#06b6d4', '#f59e0b', '#3b82f6', '#ef4444'];

export const DEFAULT_ACCENT = '#a855f7';

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.round(Math.max(0, Math.min(255, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** `a` blended towards `b` by `t` (0 = all `a`, 1 = all `b`). */
export function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  return rgbToHex([ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t, ra[2] + (rb[2] - ra[2]) * t]);
}

/** Is this a usable `#rrggbb`? What the accent setting stores must pass this. */
export function isHex(value: string): boolean {
  return hexToRgb(value) !== null;
}

/**
 * The accent's derived trio. Light and dark differ in direction: on the light
 * theme "hover" and "deep" get darker, on the dark theme they get lighter (the
 * tokens in App.css do the same by hand for the default purple), and the tint
 * is mixed with the theme's surface rather than a fixed white so it is legible
 * on both.
 */
export function deriveAccent(
  accent: string,
  surface: string,
  dark: boolean,
): {
  hover: string;
  deep: string;
  tint: string;
} {
  const towards = dark ? '#ffffff' : '#000000';
  return {
    hover: mixHex(accent, towards, dark ? 0.15 : 0.12),
    deep: mixHex(accent, towards, dark ? 0.35 : 0.28),
    tint: mixHex(surface, accent, dark ? 0.16 : 0.08),
  };
}
