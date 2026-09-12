import { useState } from 'react';
import { FONT_SIZES, FONT_STACKS, type FontChoice, type FontSizeChoice } from '../../appearance';
import { useApp } from '../../context/AppContext';
import { DEFAULT_COLOR, isHex, PALETTE_COMPACT } from '../../colors';
import { Segmented } from '../ui/segmented';
import { cn } from '@/lib/utils';
import type { ThemeName } from '../../types';
import { Card } from './shared';

/**
 * The themes this build offers: two, not the four `CLAUDE.md` § Theming lists.
 * `grey-high` and `grey-low` are dropped — the redesign never drew them and
 * nobody asked for them back. There is deliberately no "Auto (System)": a
 * theme here is a stored value that `applyTheme()` stamps onto <html>, and
 * "follow the OS" is a fifth state with no `data-theme` to write.
 *
 * `appearance.ts`'s `THEMES` / `readTheme()` now validate against these same two,
 * so a database still holding `grey-high`/`grey-low` fails that check and falls
 * back to the default rather than selecting an option that no longer paints.
 */
const THEME_OPTIONS: { value: ThemeName; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Theme, accent colour, font and text size — all live settings read from
 * `useApp()` (which derives them from the persisted `theme` / `accent` /
 * `font` / `fontSize` keys) and written through `setSetting`, whose
 * appearance branch calls `applyAppearance()` so the change paints at once.
 * No local state except the custom-colour input's own value.
 */
export function AppearanceCard() {
  const { theme, accent, font, fontSize, setSetting } = useApp();
  const [custom, setCustom] = useState(accent || DEFAULT_COLOR);
  const fonts = Object.keys(FONT_STACKS) as FontChoice[];
  const sizes = Object.keys(FONT_SIZES) as FontSizeChoice[];

  return (
    <Card title="Appearance" span>
      <div className="setting-item">
        <div>
          <div className="setting-label">Theme</div>
          <div className="setting-desc">Applies immediately and is remembered across launches.</div>
        </div>
        <Segmented aria-label="Theme" options={THEME_OPTIONS} value={theme} onChange={(v) => setSetting('theme', v)} />
      </div>

      <div className="setting-item items-start">
        <div>
          <div className="setting-label">Accent colour</div>
          <div className="setting-desc">
            Buttons, highlights and the selected day. Hover and tint shades are derived from it.
          </div>
        </div>
        <div className="flex items-center gap-[0.5rem] flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setSetting('accent', '')}
            className={cn('button-small', accent === '' && 'border-accent text-accent bg-accent-tint')}
          >
            Default
          </button>
          {PALETTE_COMPACT.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={hex}
              title={hex}
              onClick={() => setSetting('accent', hex)}
              className="w-[1.5rem] h-[1.5rem] transition-transform hover:scale-110"
              // dynamic: the swatch's own colour and the selected-state outline
              style={{
                background: hex,
                outline: accent.toLowerCase() === hex ? '2px solid var(--t-ink)' : '1px solid var(--t-border)',
                outlineOffset: '2px',
              }}
            />
          ))}
          <label className="flex items-center gap-[0.25rem] setting-desc mt-0">
            <input
              type="color"
              value={isHex(custom) ? custom : DEFAULT_COLOR}
              onChange={(e) => {
                setCustom(e.target.value);
                setSetting('accent', e.target.value);
              }}
              aria-label="Custom accent colour"
              className="w-[1.5rem] h-[1.5rem] p-0 border border-line bg-transparent"
            />
            Custom
          </label>
        </div>
      </div>

      <div className="setting-item">
        <div>
          <div className="setting-label">Font</div>
          <div className="setting-desc">Outfit is the default; Slabo is a serif; System uses your OS font.</div>
        </div>
        <Segmented
          aria-label="Font"
          options={fonts.map((f) => ({
            value: f,
            // The option previews its own face — the one inline style that is
            // genuinely per-option data.
            // dynamic: each option previews its own font
            label: <span style={{ fontFamily: FONT_STACKS[f].body }}>{FONT_STACKS[f].label}</span>,
          }))}
          value={font}
          onChange={(v) => setSetting('font', v)}
        />
      </div>

      <div className="setting-item">
        <div>
          <div className="setting-label">Text size</div>
          <div className="setting-desc">Scales the whole interface, not just the text.</div>
        </div>
        <Segmented
          aria-label="Text size"
          options={sizes.map((sz) => ({ value: sz, label: FONT_SIZES[sz].label }))}
          value={fontSize}
          onChange={(v) => setSetting('fontSize', v)}
        />
      </div>
    </Card>
  );
}
