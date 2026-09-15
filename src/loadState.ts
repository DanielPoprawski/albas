// The store read at launch, plus every one-time upgrade it folds in: the
// pre-SQLite localStorage import, legacy tasks/periods becoming to-dos/events,
// the starter data, and the free-text → id category remap. No React in here —
// rows in, rows out; `DataContext` sets its state from the result.

import { TODO_CATEGORIES } from './colors';
import { migrateLegacyTask, migrateTodo, periodToEvent, remapLegacyCategory, taskToTodo } from './migrations';
import { inTauri, persistence, readLocalBlob } from './persistence';
import { initialTodos } from './seedData';
import type { CalendarEvent, Category, Todo } from './types';

export interface LoadedApp {
  todos: Todo[];
  events: CalendarEvent[];
  categories: Category[];
  settings: Record<string, string>;
}

/** Persists the starter to-dos (and their completions) and returns them. */
export function seedDemoTodos(): Todo[] {
  for (const t of initialTodos) {
    persistence.saveTodo(t);
    for (const [d, v] of Object.entries(t.completions)) persistence.setCompletion(t.id, d, v);
  }
  return initialTodos;
}

export async function loadInitialState(): Promise<LoadedApp> {
  let state = await persistence.load();

  if (inTauri() && state.needsLegacyImport) {
    const blob = readLocalBlob();
    if (blob) {
      await persistence.importLegacy(blob.tasks.map(migrateLegacyTask), blob.habits.map(migrateTodo));
      state = await persistence.load();
    }
  }

  // Demo data goes only where it can't leak into an account: never on a
  // signed-in device (the first sync would push it), and in Tauri only once
  // the Welcome gate has been dismissed with "use offline" (`seedDemoIfEmpty`
  // handles that moment; a fresh install that signs in from Welcome must
  // start empty). The browser dev server has no gate and no sync, so it
  // seeds on first load.
  const signedIn = !!state.settings.__sync_token?.trim();
  const welcomeDone = state.settings.__welcome_done === '1';
  const seedNow = state.empty && !signedIn && (!inTauri() || welcomeDone);

  const events = [...state.events];
  let todos: Todo[];
  if (seedNow) {
    todos = seedDemoTodos();
  } else {
    todos = state.todos.map(migrateTodo);
    // one-time unification: fold legacy tasks/periods into todos/events
    for (const raw of state.legacyTasks) {
      const todo = taskToTodo(migrateLegacyTask(raw));
      todos.push(todo);
      persistence.saveTodo(todo);
      for (const [d, v] of Object.entries(todo.completions)) persistence.setCompletion(todo.id, d, v);
      persistence.deleteTask(raw.id);
    }
    for (const raw of state.legacyPeriods) {
      const event = periodToEvent(raw);
      events.push(event);
      persistence.saveEvent(event);
      persistence.deletePeriod(raw.id);
    }
  }

  // Categories: seed the five starters only for a genuinely fresh,
  // never-signed-in install — zero categories exist yet, nothing is signed
  // in (a sync is not about to pull the real ones), and no loaded to-do
  // already carries a pre-Phase-K free-text category (that data goes through
  // the remap below instead of being buried under five defaults it never
  // asked for). Everything else — an existing local install with free-text
  // categories, or any signed-in device, which will get its real categories
  // from the next sync — is left empty for the user to fill in from Settings.
  let categories = state.categories;
  const hasLegacyCategoryText = todos.some((t) => t.category.trim());
  if (categories.length === 0 && !signedIn && !hasLegacyCategoryText) {
    categories = TODO_CATEGORIES.map((c, i) => ({
      id: crypto.randomUUID(),
      name: c.label,
      colorKey: c.hex,
      scopes: ['tasks'],
      sort: i,
    }));
    for (const c of categories) persistence.saveCategory(c);
  }
  // Best-effort, cheap remap of any surviving free-text category to the
  // matching id (see migrations.ts#remapLegacyCategory) — a no-op once
  // everything already holds ids, which is every load after the first.
  todos = todos.map((t) => {
    const remapped = remapLegacyCategory(t.category, categories);
    if (remapped === t.category) return t;
    const next = { ...t, category: remapped };
    persistence.saveTodo(next);
    return next;
  });

  return { todos, events, categories, settings: state.settings };
}
