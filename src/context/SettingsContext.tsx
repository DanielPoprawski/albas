import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import {
  applyAppearance,
  applyLayout,
  applyTheme,
  type FontChoice,
  type FontSizeChoice,
  readAppearance,
  readLayout,
  readTheme,
} from '../appearance';
import { persistence } from '../persistence';
import type { FirstDayOfWeek, ThemeName } from '../types';

export interface SettingsContextType {
  theme: ThemeName;
  /** Settings › Appearance. Device-local, like every setting. */
  accent: string;
  font: FontChoice;
  fontSize: FontSizeChoice;
  firstDayOfWeek: FirstDayOfWeek;
  setSetting: (key: string, value: string) => void;
  /** Raw read of any setting, layout's included — closes CLAUDE.md TODO 2. */
  getSetting: (key: string) => string | undefined;
  /**
   * Replaces the whole settings map from a fresh store read. Only the data
   * loader calls this (first load, and after a sync writes to SQLite from Rust).
   */
  hydrateSettings: (settings: Record<string, string>) => void;
  /** Owners hidden on this device (local preference, never synced). */
  hiddenOwners: string[];
  toggleOwnerHidden: (owner: string) => void;
  /** True when sync credentials exist (passkey login or a pasted token). */
  signedIn: boolean;
  /** Account name from passkey login; null for token-only setups. */
  syncAccount: string | null;
  /**
   * The bearer token this device authenticates to the sync server with, or
   * null when signed out. Exposed so the auth-method modules
   * (`src/authMethods/`) can call authenticated endpoints without a Tauri
   * round-trip; passkey ceremonies still go through Rust because they need
   * the OS authenticator.
   */
  syncToken: string | null;
  /** Welcome screen dismissed (or made moot by being signed in). */
  welcomeDone: boolean;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  // Nothing is stamped onto <html> until the store has been read once:
  // index.html's pre-paint already shows the stored theme, and applying the
  // defaults over it would flash light on a dark install.
  const [hydrated, setHydrated] = useState(false);

  const hydrateSettings = useCallback((next: Record<string, string>) => {
    setSettings(next);
    setHydrated(true);
  }, []);

  const setSetting = useCallback((key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    persistence.setSetting(key, value);
  }, []);

  const getSetting = useCallback((key: string) => settings[key], [settings]);

  const theme = readTheme(settings);
  const appearance = useMemo(() => readAppearance(settings), [settings.accent, settings.font, settings.fontSize]);
  const layout = useMemo(() => readLayout(settings), [settings.__layout_sidebar_w, settings.__layout_right_w]);

  // The accent's derived shades depend on the theme, so any of the four
  // appearance keys re-derives all of them. Layout effects, not effects, so
  // the stamped vars land before the frame that shows the new setting.
  useLayoutEffect(() => {
    if (!hydrated) return;
    applyTheme(theme);
    applyAppearance(theme, appearance);
  }, [hydrated, theme, appearance]);
  useLayoutEffect(() => {
    if (hydrated) applyLayout(layout);
  }, [hydrated, layout]);

  const hiddenOwners = useMemo<string[]>(() => {
    try {
      const parsed = JSON.parse(settings.__shared_hidden ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === 'string') : [];
    } catch {
      return [];
    }
  }, [settings.__shared_hidden]);

  const toggleOwnerHidden = useCallback(
    (owner: string) => {
      const next = hiddenOwners.includes(owner) ? hiddenOwners.filter((o) => o !== owner) : [...hiddenOwners, owner];
      setSetting('__shared_hidden', JSON.stringify(next));
    },
    [hiddenOwners, setSetting],
  );

  const signedIn = !!settings.__sync_token?.trim();

  const value = useMemo<SettingsContextType>(
    () => ({
      theme,
      ...appearance,
      // Sunday by default as of v1.7; only an explicit '1' opts into Monday.
      firstDayOfWeek: settings.firstDayOfWeek === '1' ? 1 : 0,
      setSetting,
      getSetting,
      hydrateSettings,
      hiddenOwners,
      toggleOwnerHidden,
      signedIn,
      syncAccount: settings.__sync_account?.trim() || null,
      syncToken: settings.__sync_token?.trim() || null,
      // Compared against '1' rather than coerced: the flag is cleared by
      // writing '0', and `!!'0'` is true in JS, so a presence check would make
      // sign-out fail to return the user to the splash.
      welcomeDone: settings.__welcome_done === '1' || signedIn,
    }),
    [settings, theme, appearance, setSetting, getSetting, hydrateSettings, hiddenOwners, toggleOwnerHidden, signedIn],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within AppProvider');
  return ctx;
}
