import type React from 'react';
import { useMemo } from 'react';
import { DataProvider, useData } from './DataContext';
import { SettingsProvider, useSettings } from './SettingsContext';
import { UiProvider, useUi } from './UiContext';

/**
 * Three providers behind one hook. `SettingsProvider` sits outermost because
 * `DataProvider` hydrates it from the store read and watches `signedIn`;
 * `UiProvider` depends on nothing. Components that only need one slice can
 * import `useData`/`useUi`/`useSettings` directly and skip the other two
 * contexts' re-renders; `useApp()` merges all three for everything else.
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <UiProvider>
        <DataProvider>{children}</DataProvider>
      </UiProvider>
    </SettingsProvider>
  );
}

export function useApp() {
  const data = useData();
  const ui = useUi();
  const settings = useSettings();
  return useMemo(() => ({ ...settings, ...ui, ...data }), [data, ui, settings]);
}
