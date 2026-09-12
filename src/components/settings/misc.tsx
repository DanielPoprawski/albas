import { useApp } from '../../context/AppContext';
import { inTauri } from '../../persistence';
import { Segmented } from '../ui/segmented';
import { formatKeys, SHORTCUTS, type ShortcutGroup } from '../../shortcuts';
import { Card } from './shared';

/* ── Preferences ─────────────────────────────────────────────────────────*/

/**
 * Week start. It is a live setting threaded through the whole calendar
 * (`firstDayOfWeek` is a trailing argument on a dozen date helpers), so it is
 * read from `useApp()` rather than local state.
 */
export function PreferencesCard() {
  const { firstDayOfWeek, setSetting } = useApp();

  return (
    <Card title="Preferences">
      <div>
        <div className="setting-label mb-2">Week starts on</div>
        <Segmented
          aria-label="Week starts on"
          options={[
            { value: '1', label: 'Monday' },
            { value: '0', label: 'Sunday' },
          ]}
          value={String(firstDayOfWeek)}
          onChange={(v) => setSetting('firstDayOfWeek', v)}
        />
        <p className="setting-desc mt-2">
          Changes the calendar and the weekly strips. A “N times per week” to-do counts its completions inside this
          week, so its progress can shift.
        </p>
      </div>
    </Card>
  );
}

/* ── Shortcuts ───────────────────────────────────────────────────────────*/

const SHORTCUT_GROUPS: ShortcutGroup[] = ['Navigation', 'Create', 'Search'];

/**
 * A reference card, not a settings surface — `shortcuts.ts#SHORTCUTS` is the
 * only place a binding is defined, this just renders it grouped. `Ctrl`
 * prints as `⌘` on Mac (`formatKeys`).
 */
export function ShortcutsCard() {
  return (
    <Card title="Keyboard shortcuts">
      <div className="space-y-md">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group}>
            <div className="setting-label mb-2">{group}</div>
            <div className="space-y-xs">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-sm">
                  <span className="setting-desc mt-0">{s.label}</span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    {formatKeys(s.keys).map((k, i) => (
                      <kbd
                        key={i}
                        className="inline-flex h-5 min-w-5 items-center justify-center border border-line-strong bg-subtle px-1 text-xs font-semibold text-ink-secondary"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── About ───────────────────────────────────────────────────────────────*/

/**
 * The one place the running version is visible. `__APP_VERSION__` is injected
 * by Vite from package.json (see `define` in vite.config.ts), which is the
 * single source every other version file is derived from — so if this number
 * is right, the bundle, the installer and the APK all agree.
 */
export function AboutCard() {
  // No Tauri platform check — `os` would be a plugin and an async call for one
  // word of text. Android's WebView is the only one that says so in the UA.
  const platform = !inTauri()
    ? 'Browser (data stays in this browser)'
    : /android/i.test(navigator.userAgent)
      ? 'Android app'
      : 'Desktop app';

  return (
    <Card title="About">
      <div className="setting-item">
        <div>
          <div className="setting-label">Albas v{__APP_VERSION__}</div>
          <div className="setting-desc">{platform}</div>
        </div>
      </div>
    </Card>
  );
}
