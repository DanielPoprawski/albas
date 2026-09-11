/**
 * Colour data for the redesign, plus the palette the colour pickers draw.
 *
 * The CSS side of this lives in `App.css` (`--t-*` on `:root`). The hexes here
 * are **identities, not paint**: a category's stored `colorKey`, the key that
 * picks its `bg-cat-*` classes, the value an ICS export writes. Anything that
 * is painted for a theme goes through `var(--t-*)` or a class so it follows
 * dark mode and a custom accent; only arbitrary (non-category) colours are
 * ever painted from a literal, and then as a translucent `tintOf()` wash.
 * `scripts/css-audit.mjs` asserts CATEGORY_ACCENTS matches `:root`.
 */

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
  red: { hex: '#ef4444', tint: '#fee2e2', line: '#fecaca', ink: '#991b1b' },
} as const satisfies Record<string, CategoryAccent>;

/**
 * The Tailwind classes that paint a named accent from the `--t-cat-*` tokens,
 * so a chip or tag follows the theme instead of carrying a light-only hex.
 * Spelled out as literals (not built from the name) so Tailwind emits them.
 */
export const CATEGORY_CLASSES: Record<CategoryAccentName, { tint: string; line: string; ink: string; solid: string }> =
  {
    purple: {
      tint: 'bg-cat-purple-tint',
      line: 'border-cat-purple-line',
      ink: 'text-cat-purple-ink',
      solid: 'bg-cat-purple',
    },
    amber: {
      tint: 'bg-cat-amber-tint',
      line: 'border-cat-amber-line',
      ink: 'text-cat-amber-ink',
      solid: 'bg-cat-amber',
    },
    green: {
      tint: 'bg-cat-green-tint',
      line: 'border-cat-green-line',
      ink: 'text-cat-green-ink',
      solid: 'bg-cat-green',
    },
    blue: { tint: 'bg-cat-blue-tint', line: 'border-cat-blue-line', ink: 'text-cat-blue-ink', solid: 'bg-cat-blue' },
    pink: { tint: 'bg-cat-pink-tint', line: 'border-cat-pink-line', ink: 'text-cat-pink-ink', solid: 'bg-cat-pink' },
    teal: { tint: 'bg-cat-teal-tint', line: 'border-cat-teal-line', ink: 'text-cat-teal-ink', solid: 'bg-cat-teal' },
    red: { tint: 'bg-cat-red-tint', line: 'border-cat-red-line', ink: 'text-cat-red-ink', solid: 'bg-cat-red' },
  };

/** The accent name a stored hex belongs to, or null for a wheel/palette colour. */
export function accentNameOf(hex: string): CategoryAccentName | null {
  const h = hex.toLowerCase();
  for (const name of Object.keys(CATEGORY_ACCENTS) as CategoryAccentName[]) {
    if (CATEGORY_ACCENTS[name].hex === h) return name;
  }
  return null;
}

export type CategoryAccentName = keyof typeof CATEGORY_ACCENTS;

/**
 * The five starter categories `AppContext` seeds into the (now managed,
 * synced) `categories` table on a fresh, never-signed-in install — see
 * `AppProvider`'s seeding effect for exactly when. Once seeded they are
 * ordinary rows the user can rename, recolour, or delete; this array is not
 * read anywhere else.
 */
export const TODO_CATEGORIES: { label: string; hex: string }[] = [
  { label: 'Work', hex: CATEGORY_ACCENTS.blue.hex },
  { label: 'Personal', hex: CATEGORY_ACCENTS.purple.hex },
  { label: 'Shopping', hex: CATEGORY_ACCENTS.amber.hex },
  { label: 'Health', hex: CATEGORY_ACCENTS.green.hex },
  { label: 'Finance', hex: CATEGORY_ACCENTS.teal.hex },
];

/**
 * The tint/line/ink trio for an arbitrary stored colour.
 *
 * A category accent gets the hand-picked shades above — those are the ones the
 * designs draw. Anything else (a colour picked off the wheel) gets a derived
 * pair, which is why `tintOf` exists rather than a second lookup table.
 */
export function accentOf(hex: string): CategoryAccent {
  const found = Object.values(CATEGORY_ACCENTS).find((a) => a.hex.toLowerCase() === hex.toLowerCase());
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
  [
    '#fca5a5',
    '#fdba74',
    '#fcd34d',
    '#fde047',
    '#bef264',
    '#86efac',
    '#6ee7b7',
    '#67e8f9',
    '#7dd3fc',
    '#93c5fd',
    '#d8b4fe',
    '#f9a8d4',
  ],
  // base
  [
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#eab308',
    '#84cc16',
    '#22c55e',
    '#10b981',
    '#06b6d4',
    '#0ea5e9',
    '#3b82f6',
    '#a855f7',
    '#ec4899',
  ],
  // dark
  [
    '#991b1b',
    '#9a3412',
    '#b45309',
    '#a16207',
    '#3f6212',
    '#15803d',
    '#047857',
    '#0e7490',
    '#0369a1',
    '#1d4ed8',
    '#7e22ce',
    '#be185d',
  ],
];

/**
 * The last desktop row: black through white in eleven steps. The twelfth cell
 * is the colour wheel, which is why this stops at eleven.
 */
export const GREY_RAMP: string[] = [
  '#000000',
  '#1a1a1a',
  '#333333',
  '#4d4d4d',
  '#666666',
  '#808080',
  '#999999',
  '#b3b3b3',
  '#cccccc',
  '#e6e6e6',
  '#ffffff',
];

/**
 * Phone picker: one row, so it's seven hues and the wheel. These are the
 * redesign's category accents plus red — a second row of swatches costs more
 * vertical space than a phone form can spare.
 */
export const PALETTE_COMPACT: string[] = ['#a855f7', '#ec4899', '#10b981', '#06b6d4', '#f59e0b', '#3b82f6', '#ef4444'];

/** Every named swatch, for "is this a custom colour?" checks. */
export const PALETTE: string[] = [...PALETTE_ROWS.flat(), ...GREY_RAMP, ...PALETTE_COMPACT];

/** Colors used before the palette existed, kept readable in old saves. */
const LEGACY: Record<string, string> = {
  primary: CATEGORY_ACCENTS.purple.hex,
  secondary: CATEGORY_ACCENTS.green.hex,
  tertiary: CATEGORY_ACCENTS.pink.hex,
};

export const DEFAULT_COLOR: string = CATEGORY_ACCENTS.purple.hex;

/** Resolve a stored color (hex or legacy named key) to a hex string. */
export function colorHex(key: string | null | undefined): string {
  if (!key) return DEFAULT_COLOR;
  return key.startsWith('#') ? key : (LEGACY[key] ?? DEFAULT_COLOR);
}

// --- Appearance (Settings › Appearance) ---

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
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
