import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActiveView,
  CalendarEvent,
  CalendarMode,
  Category,
  CategoryScope,
  FirstDayOfWeek,
  SharedGroup,
  ThemeName,
  Todo,
} from '../types';
import { fmt, parse, weekOf } from '../dates';
import { inTauri, persistence, readLocalBlob } from '../persistence';
import { DEFAULT_COLOR, deriveAccent, isHex, TODO_CATEGORIES } from '../colors';
import { migrateLegacyTask, migrateTodo, periodToEvent, remapLegacyCategory, taskToTodo } from '../migrations';
import { mapSharedRows } from '../sharedLogic';
import * as ipc from '../ipc';
import type { SyncOutcome } from '../ipc';

const today = new Date();
const todayStr = fmt(today);

// Seed demo data on the current Mon–Sun week so it lines up with the weekly tracker,
// but never on future days.
const weekDates = weekOf(today).filter((d) => d <= todayStr);
const weekAgo = new Date(today);
weekAgo.setDate(today.getDate() - 7);
const weekAgoStr = fmt(weekAgo);

const baseTodo = {
  kind: 'yesno' as const,
  unit: '',
  target: 1,
  dueDate: null,
  time: null,
  createdAt: weekAgoStr,
  reminder: false,
  category: '',
  important: false,
};

const initialTodos: Todo[] = [
  {
    ...baseTodo,
    id: '1',
    name: 'Deep Work',
    colorKey: '#10b981',
    kind: 'measurable',
    unit: 'h',
    target: 4,
    schedule: { type: 'weekdays', days: [1, 2, 3, 4, 5] },
    completions: Object.fromEntries(
      weekDates
        .filter((d) => {
          const day = parse(d).getDay();
          return day >= 1 && day <= 5;
        })
        .map((d) => [d, 4]),
    ),
  },
  {
    ...baseTodo,
    id: '2',
    name: 'Meditation',
    colorKey: '#a855f7',
    schedule: { type: 'daily' },
    completions: Object.fromEntries(weekDates.filter((_, i) => i % 2 === 0).map((d) => [d, 1])),
  },
  {
    ...baseTodo,
    id: '3',
    name: 'Take out trash',
    colorKey: '#f59e0b',
    reminder: true,
    schedule: { type: 'every', n: 3, unit: 'day', fromDone: true },
    completions: weekDates.length > 2 ? { [weekDates[weekDates.length - 3]]: 1 } : {},
  },
  {
    ...baseTodo,
    id: '4',
    name: 'Finalize Q4 roadmap',
    colorKey: DEFAULT_COLOR,
    schedule: { type: 'once' },
    dueDate: todayStr,
    completions: {},
  },
];

export type NewTodo = Omit<Todo, 'id' | 'completions' | 'createdAt'>;
export type NewEvent = Omit<CalendarEvent, 'id'>;

export type NewCategory = Omit<Category, 'id'>;

interface AppContextType {
  todos: Todo[];
  events: CalendarEvent[];
  loaded: boolean;
  selectedDate: string | null;
  currentMonth: Date;
  activeView: ActiveView;
  calendarMode: CalendarMode;
  setSelectedDate: (date: string | null) => void;
  setCurrentMonth: React.Dispatch<React.SetStateAction<Date>>;
  setActiveView: (view: ActiveView) => void;
  setCalendarMode: (mode: CalendarMode) => void;
  addTodo: (todo: NewTodo) => void;
  updateTodo: (id: string, updates: Partial<Omit<Todo, 'id' | 'completions'>>) => void;
  deleteTodo: (id: string) => void;
  /** Yes/no: toggles done. Measurable: jumps to target, or back to 0 if already done. */
  toggleTodo: (todoId: string, date: string) => void;
  setTodoValue: (todoId: string, date: string, value: number) => void;
  addEvent: (event: NewEvent) => void;
  updateEvent: (id: string, updates: Partial<Omit<CalendarEvent, 'id'>>) => void;
  deleteEvent: (id: string) => void;
  /** Bulk upsert (by id), e.g. a Google Calendar import — re-importing updates in place. */
  importEvents: (incoming: CalendarEvent[]) => void;
  /** User-managed, synced groupings (Settings › Categories). */
  categories: Category[];
  /** Returns the created category (with its new id) so a caller can select it immediately. */
  addCategory: (category: NewCategory) => Category;
  updateCategory: (id: string, updates: Partial<Omit<Category, 'id'>>) => void;
  /** Also clears `category` on every referencing to-do/event (they persist as uncategorised). */
  deleteCategory: (id: string) => void;
  /** Own categories offered for a given surface, sorted by the user's manual order. */
  categoriesFor: (scope: CategoryScope) => Category[];
  /** Resolves an id against own categories, then shared ones (namespaced `${owner}:${pk}`). */
  categoryById: (id: string) => Category | undefined;
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
   * Re-reads everything from the store. Needed after a server sync, which
   * writes straight to SQLite from Rust and so bypasses React state.
   */
  reloadFromStore: () => Promise<void>;
  /** Everything other accounts share with this one, hidden owners included. */
  shared: SharedGroup[];
  /** `shared` minus locally hidden owners — what the panels should render. */
  visibleShared: SharedGroup[];
  /** Visible shared events flattened, each carrying `sharedBy` — merged into the calendar. */
  sharedEvents: CalendarEvent[];
  /** Owners hidden on this device (local preference, never synced). */
  hiddenOwners: string[];
  toggleOwnerHidden: (owner: string) => void;
  /** True when sync credentials exist (passkey login or a pasted token). */
  signedIn: boolean;
  /** Account name from passkey login; null for token-only setups. */
  syncAccount: string | null;
  /**
   * The bearer token this device authenticates to the sync server with, or
   * null when signed out. Exposed so the fetch-based auth-method modules
   * (`src/authMethods/`) can call authenticated endpoints without a Tauri
   * round-trip; passkey ceremonies still go through Rust because they need
   * the OS authenticator.
   */
  syncToken: string | null;
  /** Epoch millis of the last successful sync on this device, or null for never. */
  lastSync: number | null;
  /** True while a sync is in flight, whoever started it. */
  syncing: boolean;
  /**
   * Runs a sync and folds the result back into React. Every caller goes
   * through this — the status bar, Settings, and the once-per-launch effect
   * below — so there is a single `lastSync` rather than one per surface.
   * Rejects on failure; how loudly to say so is the caller's business.
   */
  syncNow: () => Promise<SyncOutcome>;
  /** Welcome screen dismissed (or made moot by being signed in). */
  welcomeDone: boolean;
}

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

function readTheme(settings: Record<string, string>): ThemeName {
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

const APPEARANCE_KEYS = new Set(['theme', 'accent', 'font', 'fontSize']);

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

const LAYOUT_KEYS = new Set(['__layout_sidebar_w', '__layout_right_w']);

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [shared, setShared] = useState<SharedGroup[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr);
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [activeView, setActiveView] = useState<ActiveView>('calendar');
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('month');
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const initStarted = useRef(false);
  const syncStarted = useRef(false); // StrictMode double-mount guard

  useEffect(() => {
    if (initStarted.current) return; // StrictMode double-mount guard
    initStarted.current = true;

    (async () => {
      try {
        let state = await persistence.load();
        setSettings(state.settings);
        applyTheme(readTheme(state.settings));
        applyAppearance(readTheme(state.settings), readAppearance(state.settings));
        applyLayout(readLayout(state.settings));

        if (inTauri() && state.needsLegacyImport) {
          const blob = readLocalBlob();
          if (blob) {
            await persistence.importLegacy(blob.tasks.map(migrateLegacyTask), blob.habits.map(migrateTodo));
            state = await persistence.load();
          }
        }

        let finalTodos: Todo[];
        if (state.empty) {
          // first launch anywhere — seed the demo data through the store
          initialTodos.forEach((t) => {
            persistence.saveTodo(t);
            Object.entries(t.completions).forEach(([d, v]) => persistence.setCompletion(t.id, d, v));
          });
          finalTodos = initialTodos;
          setTodos(initialTodos);
        } else {
          const loadedTodos = state.todos.map(migrateTodo);
          const loadedEvents = [...state.events];

          // one-time unification: fold legacy tasks/periods into todos/events
          for (const raw of state.legacyTasks) {
            const todo = taskToTodo(migrateLegacyTask(raw));
            loadedTodos.push(todo);
            persistence.saveTodo(todo);
            Object.entries(todo.completions).forEach(([d, v]) => persistence.setCompletion(todo.id, d, v));
            persistence.deleteTask(raw.id);
          }
          for (const raw of state.legacyPeriods) {
            const event = periodToEvent(raw);
            loadedEvents.push(event);
            persistence.saveEvent(event);
            persistence.deletePeriod(raw.id);
          }

          finalTodos = loadedTodos;
          setTodos(loadedTodos);
          setEvents(loadedEvents);
        }

        // Categories: seed the five starters only for a genuinely fresh,
        // never-signed-in install — zero categories exist yet, nothing is
        // signed in (a sync is not about to pull the real ones), and no
        // loaded to-do already carries a pre-Phase-K free-text category (that
        // data goes through the remap below instead of being buried under
        // five defaults it never asked for). Everything else — an existing
        // local install with free-text categories, or any signed-in device,
        // which will get its real categories from the next sync — is left
        // empty for the user to fill in from Settings.
        let loadedCategories = state.categories;
        const signedInAtLoad = !!state.settings.__sync_token?.trim();
        const hasLegacyCategoryText = finalTodos.some((t) => t.category.trim());
        if (loadedCategories.length === 0 && !signedInAtLoad && !hasLegacyCategoryText) {
          loadedCategories = TODO_CATEGORIES.map((c, i) => ({
            id: crypto.randomUUID(),
            name: c.label,
            colorKey: c.hex,
            scopes: ['tasks'],
            sort: i,
          }));
          loadedCategories.forEach((c) => persistence.saveCategory(c));
        }
        // Best-effort, cheap remap of any surviving free-text category to the
        // matching id (see migrations.ts#remapLegacyCategory) — a no-op once
        // everything already holds ids, which is every load after the first.
        finalTodos = finalTodos.map((t) => {
          const remapped = remapLegacyCategory(t.category, loadedCategories);
          if (remapped === t.category) return t;
          const next = { ...t, category: remapped };
          persistence.saveTodo(next);
          return next;
        });
        setTodos(finalTodos);
        setCategories(loadedCategories);

        await refreshShared();
      } catch (err) {
        console.error('failed to load persisted data:', err);
        setTodos(initialTodos);
      }
      setLoaded(true);
    })();
  }, []);

  // One sync per launch, once the local data is on screen. Deliberately not
  // awaited by the load above: a slow or unreachable server must never delay
  // startup, and a failure here just means the app stays local until the next
  // manual sync from Settings.
  useEffect(() => {
    if (!loaded || !inTauri() || syncStarted.current) return;
    syncStarted.current = true;
    (async () => {
      try {
        const status = await ipc.syncStatus();
        if (!status.configured) return;
        await syncNow();
      } catch (err) {
        console.warn('startup sync failed:', err);
      }
    })();
  }, [loaded]);

  function addTodo(todo: NewTodo) {
    const full: Todo = { ...todo, id: crypto.randomUUID(), createdAt: todayStr, completions: {} };
    setTodos((prev) => [...prev, full]);
    persistence.saveTodo(full);
  }

  function updateTodo(id: string, updates: Partial<Omit<Todo, 'id' | 'completions'>>) {
    const current = todos.find((t) => t.id === id);
    if (!current) return;
    const next = { ...current, ...updates };
    setTodos((prev) => prev.map((t) => (t.id === id ? next : t)));
    persistence.saveTodo(next);
  }

  function deleteTodo(id: string) {
    setTodos((prev) => prev.filter((t) => t.id !== id));
    persistence.deleteTodo(id);
  }

  function setTodoValue(todoId: string, date: string, value: number) {
    setTodos((prev) =>
      prev.map((t) => {
        if (t.id !== todoId) return t;
        const completions = { ...t.completions };
        if (value <= 0) delete completions[date];
        else completions[date] = value;
        return { ...t, completions };
      }),
    );
    persistence.setCompletion(todoId, date, value);
  }

  function toggleTodo(todoId: string, date: string) {
    const todo = todos.find((t) => t.id === todoId);
    if (!todo) return;
    const current = todo.completions[date] ?? 0;
    setTodoValue(todoId, date, current >= todo.target ? 0 : todo.target);
  }

  function addEvent(event: NewEvent) {
    const full: CalendarEvent = { ...event, id: crypto.randomUUID() };
    setEvents((prev) => [...prev, full]);
    persistence.saveEvent(full);
  }

  function updateEvent(id: string, updates: Partial<Omit<CalendarEvent, 'id'>>) {
    const current = events.find((e) => e.id === id);
    if (!current) return;
    const next = { ...current, ...updates };
    setEvents((prev) => prev.map((e) => (e.id === id ? next : e)));
    persistence.saveEvent(next);
  }

  function deleteEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    persistence.deleteEvent(id);
  }

  function importEvents(incoming: CalendarEvent[]) {
    setEvents((prev) => {
      const byId = new Map(prev.map((e) => [e.id, e]));
      for (const e of incoming) byId.set(e.id, e);
      return [...byId.values()];
    });
    incoming.forEach((e) => persistence.saveEvent(e));
  }

  function addCategory(input: NewCategory): Category {
    const full: Category = { ...input, id: crypto.randomUUID() };
    setCategories((prev) => [...prev, full]);
    persistence.saveCategory(full);
    return full;
  }

  function updateCategory(id: string, updates: Partial<Omit<Category, 'id'>>) {
    const current = categories.find((c) => c.id === id);
    if (!current) return;
    const next = { ...current, ...updates };
    setCategories((prev) => prev.map((c) => (c.id === id ? next : c)));
    persistence.saveCategory(next);
  }

  function deleteCategory(id: string) {
    setCategories((prev) => prev.filter((c) => c.id !== id));
    persistence.deleteCategory(id);
    // Clear the reference through the normal update paths, not a direct
    // write, so the clear itself persists (and syncs) like any other edit.
    todos.filter((t) => t.category === id).forEach((t) => updateTodo(t.id, { category: '' }));
    events.filter((e) => e.category === id).forEach((e) => updateEvent(e.id, { category: '' }));
  }

  function categoriesFor(scope: CategoryScope): Category[] {
    return categories
      .filter((c) => c.scopes.includes(scope))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  }

  function categoryById(id: string): Category | undefined {
    if (!id) return undefined;
    return categories.find((c) => c.id === id) ?? shared.flatMap((g) => g.categories).find((c) => c.id === id);
  }

  function setSetting(key: string, value: string) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    persistence.setSetting(key, value);
    if (key === 'theme') applyTheme(value as ThemeName);
    // The accent's derived shades depend on the theme, so any of the four
    // re-derives all of them.
    if (APPEARANCE_KEYS.has(key)) applyAppearance(readTheme(next), readAppearance(next));
    if (LAYOUT_KEYS.has(key)) applyLayout(readLayout(next));
  }

  /** Raw read of any setting — Settings' display-name field and layout drags. */
  function getSetting(key: string): string | undefined {
    return settings[key];
  }

  /** Re-reads the shared cache. Tauri-only — the browser dev server has no sync. */
  async function refreshShared() {
    if (!inTauri()) return;
    try {
      const rows = await ipc.loadShared();
      setShared(mapSharedRows(rows));
    } catch (err) {
      console.warn('failed to load shared data:', err);
    }
  }

  async function reloadFromStore() {
    const state = await persistence.load();
    setTodos(state.todos.map(migrateTodo));
    setEvents([...state.events]);
    setCategories(state.categories);
    setSettings(state.settings);
    await refreshShared();
  }

  /**
   * The one place a sync is run from. Rust merges straight into SQLite, so a
   * pull has to be read back into React here; doing that per caller is how the
   * status bar and Settings would come to disagree about what is on screen and
   * when it last arrived.
   */
  async function syncNow(): Promise<SyncOutcome> {
    setSyncing(true);
    try {
      const out = await ipc.syncNow();
      if (out.pulled > 0 || out.sharedChanged) await reloadFromStore();
      if (out.lastSync) setLastSync(Number(out.lastSync));
      return out;
    } finally {
      setSyncing(false);
    }
  }

  const hiddenOwners = useMemo<string[]>(() => {
    try {
      const parsed = JSON.parse(settings.__shared_hidden ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === 'string') : [];
    } catch {
      return [];
    }
  }, [settings.__shared_hidden]);
  const visibleShared = useMemo(() => shared.filter((g) => !hiddenOwners.includes(g.owner)), [shared, hiddenOwners]);
  const sharedEvents = useMemo(() => visibleShared.flatMap((g) => g.events), [visibleShared]);

  function toggleOwnerHidden(owner: string) {
    const next = hiddenOwners.includes(owner) ? hiddenOwners.filter((o) => o !== owner) : [...hiddenOwners, owner];
    setSetting('__shared_hidden', JSON.stringify(next));
  }

  const signedIn = !!settings.__sync_token?.trim();

  // Rust owns the stamp, and not every sync passes through `syncNow`: the
  // browser sign-in flow (`useBrowserSignIn`) syncs from inside the poll
  // loop, so on sign-in React can only learn when that happened by asking.
  // Signing out clears it — the next account's history is not this one's.
  useEffect(() => {
    if (!inTauri()) return;
    if (!signedIn) {
      setLastSync(null);
      return;
    }
    (async () => {
      try {
        const status = await ipc.syncStatus();
        setLastSync(status.lastSync ? Number(status.lastSync) : null);
      } catch {
        // backend not ready — the bar reads "never synced" until one runs
      }
    })();
  }, [signedIn]);

  return (
    <AppContext.Provider
      value={{
        todos,
        events,
        loaded,
        selectedDate,
        currentMonth,
        activeView,
        calendarMode,
        setSelectedDate,
        setCurrentMonth,
        setActiveView,
        setCalendarMode,
        addTodo,
        updateTodo,
        deleteTodo,
        toggleTodo,
        setTodoValue,
        addEvent,
        updateEvent,
        deleteEvent,
        importEvents,
        categories,
        addCategory,
        updateCategory,
        deleteCategory,
        categoriesFor,
        categoryById,
        theme: readTheme(settings),
        ...readAppearance(settings),
        // Sunday by default as of v1.7; only an explicit '1' opts into Monday.
        firstDayOfWeek: settings.firstDayOfWeek === '1' ? 1 : 0,
        setSetting,
        getSetting,
        reloadFromStore,
        shared,
        visibleShared,
        sharedEvents,
        hiddenOwners,
        toggleOwnerHidden,
        signedIn,
        syncAccount: settings.__sync_account?.trim() || null,
        syncToken: settings.__sync_token?.trim() || null,
        lastSync,
        syncing,
        syncNow,
        // Compared against '1' rather than coerced: the flag is cleared by
        // writing '0', and `!!'0'` is true in JS, so a presence check would make
        // sign-out fail to return the user to the splash.
        welcomeDone: settings.__welcome_done === '1' || signedIn,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
