import { deriveAccent, isHex } from './colors';
import type { ThemeName, ThemePref } from './types';

/**
 * The themes that exist. Two (`ThemeName`): the
 * redesign draws `:root` (light) and `[data-theme='dark']` only, and
 * `grey-high`/`grey-low` are gone for good.
 *
 * A stored value that isn't one of these (or `system`) — an install that last
 * ran a four-theme build — falls through to the default rather than stamping
 * an attribute nothing responds to. The default is **system**: follow the OS.
 */
const THEMES: ThemeName[] = ['light', 'dark'];

export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

export function readThemePref(settings: Record<string, string>): ThemePref {
  const t = settings.theme as ThemePref | undefined;
  return t === 'system' || (t && THEMES.includes(t)) ? t : 'system';
}

/** The theme to actually paint: a fixed choice as-is, `system` per the OS. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): ThemeName {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

/**
 * Stamps the resolved theme onto <html>. The *preference* (not the resolved
 * value) is also mirrored to localStorage so the inline script in index.html
 * can paint the right colours before React mounts — for `system` it asks
 * `matchMedia` itself. SQLite stays the source of truth; the mirror is only a
 * first-paint cache.
 */
export function applyTheme(theme: ThemeName, pref: ThemePref): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('albas-theme', pref);
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
