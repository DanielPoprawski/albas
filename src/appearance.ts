import { deriveAccent, isHex } from './colors';
import type { ThemeName } from './types';

/**
 * The themes that exist. Two, not the four CLAUDE.md § Theming lists: the
 * redesign draws `:root` (light) and `[data-theme='dark']` only, and
 * `grey-high`/`grey-low` are gone for good.
 *
 * A stored value that isn't one of these — an install that last ran a
 * four-theme build — falls through to the default rather than stamping an
 * attribute nothing responds to. The default is **light**, because the
 * redesign is a light-first design; it used to be dark.
 */
const THEMES: ThemeName[] = ['light', 'dark'];

export function readTheme(settings: Record<string, string>): ThemeName {
  const t = settings.theme as ThemeName | undefined;
  return t && THEMES.includes(t) ? t : 'light';
}

/**
 * Themes are also mirrored to localStorage by `applyTheme` so the inline script
 * in index.html can paint the right colours before React mounts. SQLite stays
 * the source of truth; the mirror is only a first-paint cache.
 */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('albas-theme', theme);
  } catch {
    // private mode / quota — the theme still applies for this session
  }
}

// --- Appearance: accent colour, font, text size ---

export type FontChoice = 'outfit' | 'sora' | 'slabo' | 'system';
export type FontSizeChoice = 's' | 'm' | 'l' | 'xl' | 'xxl' | 'xxxl';

export const FONT_STACKS: Record<FontChoice, { body: string; heading: string; label: string }> = {
  outfit: {
    body: "'Outfit', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    heading: "'Sora', 'Outfit', system-ui, -apple-system, sans-serif",
    label: 'Outfit',
  },
  sora: {
    body: "'Sora', 'Outfit', system-ui, -apple-system, sans-serif",
    heading: "'Sora', 'Outfit', system-ui, -apple-system, sans-serif",
    label: 'Sora',
  },
  slabo: {
    body: "'Slabo 27px', Georgia, 'Times New Roman', serif",
    heading: "'Slabo 27px', Georgia, 'Times New Roman', serif",
    label: 'Slabo',
  },
  system: {
    body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    heading: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    label: 'System',
  },
};

/** Root font size per choice; everything is in rem, so this scales the app. */
export const FONT_SIZES: Record<FontSizeChoice, { css: string; label: string }> = {
  s: { css: '87.5%', label: 'Small' },
  m: { css: '', label: 'Default' },
  l: { css: '112.5%', label: 'Large' },
  xl: { css: '125%', label: 'Extra large' },
  xxl: { css: '150%', label: 'Huge' },
  xxxl: { css: '175%', label: 'Largest' },
};

export interface Appearance {
  /** `#rrggbb`, or '' for the theme's own accent. */
  accent: string;
  font: FontChoice;
  fontSize: FontSizeChoice;
}

export function readAppearance(settings: Record<string, string>): Appearance {
  const accent = settings.accent ?? '';
  const font = settings.font as FontChoice | undefined;
  const size = settings.fontSize as FontSizeChoice | undefined;
  return {
    accent: isHex(accent) ? accent : '',
    font: font && font in FONT_STACKS ? font : 'outfit',
    fontSize: size && size in FONT_SIZES ? size : 'm',
  };
}

/**
 * Stamps the appearance onto <html> as inline custom properties, which beat
 * both `:root` and `[data-theme='dark']`. The accent's hover/deep/tint are
 * derived here per theme (see `deriveAccent`), so it has to re-run whenever
 * the theme changes too. Mirrored to localStorage, pre-derived, so the inline
 * script in index.html can paint it before React mounts.
 */
export function applyAppearance(theme: ThemeName, a: Appearance): void {
  const root = document.documentElement;
  const vars: Record<string, string> = {};
  if (a.accent) {
    const surface =
      getComputedStyle(root).getPropertyValue('--t-surface').trim() || (theme === 'dark' ? '#17191e' : '#ffffff');
    const d = deriveAccent(a.accent, surface, theme === 'dark');
    vars['--t-accent'] = a.accent;
    vars['--t-accent-hover'] = d.hover;
    vars['--t-accent-deep'] = d.deep;
    vars['--t-accent-tint'] = d.tint;
  }
  if (a.font !== 'outfit') {
    vars['--t-font-body'] = FONT_STACKS[a.font].body;
    vars['--t-font-heading'] = FONT_STACKS[a.font].heading;
  }
  for (const name of [
    '--t-accent',
    '--t-accent-hover',
    '--t-accent-deep',
    '--t-accent-tint',
    '--t-font-body',
    '--t-font-heading',
  ]) {
    if (vars[name]) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }
  root.style.fontSize = FONT_SIZES[a.fontSize].css;
  try {
    localStorage.setItem('albas-appearance', JSON.stringify({ vars, fontSize: FONT_SIZES[a.fontSize].css }));
  } catch {
    // private mode / quota — still applied for this session
  }
}

// --- Layout: adjustable sidebar / right-panel widths ---

export interface Layout {
  /** Rem number as a string, or '' for "unset — CSS default wins". */
  sidebar: string;
  right: string;
}

/** Min/max/default rem widths for each resizable panel (Phase L). */
export const LAYOUT_LIMITS = {
  sidebar: { min: 10, max: 24, def: 12.5 },
  right: { min: 14, max: 32, def: 20 },
} as const;

export function clampRem(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function readLayout(settings: Record<string, string>): Layout {
  return {
    sidebar: settings.__layout_sidebar_w ?? '',
    right: settings.__layout_right_w ?? '',
  };
}

/**
 * Stamps the two layout widths onto <html> as inline custom properties, the
 * same trick `applyAppearance` uses. An unset (or unparsable) value removes
 * the property instead of writing one, so `.sidebar`'s own
 * `var(--layout-sidebar-w, 12.5rem)` fallback wins — this is what "reset"
 * (the handle's double-click) relies on. Mirrored to localStorage, already
 * clamped, so the inline script in index.html can paint it before React
 * mounts and the layout doesn't jump on launch.
 */
export function applyLayout(l: Layout): void {
  const root = document.documentElement;
  const vars: Record<string, string> = {};
  const sidebarNum = parseFloat(l.sidebar);
  if (l.sidebar !== '' && Number.isFinite(sidebarNum)) {
    vars['--layout-sidebar-w'] = `${clampRem(sidebarNum, LAYOUT_LIMITS.sidebar.min, LAYOUT_LIMITS.sidebar.max)}rem`;
  }
  const rightNum = parseFloat(l.right);
  if (l.right !== '' && Number.isFinite(rightNum)) {
    vars['--layout-right-w'] = `${clampRem(rightNum, LAYOUT_LIMITS.right.min, LAYOUT_LIMITS.right.max)}rem`;
  }
  for (const name of ['--layout-sidebar-w', '--layout-right-w'] as const) {
    if (vars[name]) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }
  try {
    localStorage.setItem('albas-layout', JSON.stringify(vars));
  } catch {
    // private mode / quota — the layout still applies for this session
  }
}
