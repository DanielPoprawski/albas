import { colorHex } from '../../colors';
import { addDays, diffDays, shortDate } from '../../dates';
import { nearestOccurrence, shortTime } from '../../eventLogic';
import { type Plan, matchItem } from '../../searchMatch';
import { isRepeating, nearestDueDate, streakOf } from '../../todoLogic';
import type { CalendarEvent, Category, FirstDayOfWeek, Todo } from '../../types';
import { eventKey, todoKey } from '../../itemKeys';
import type { Hit, ScopeTab, SearchItem } from './types';

/** Hits shown at once; counts are still over every match. */
export const MAX_HITS = 50;

/** Everything the palette can find, decorated once per data change. */
export function toSearchItems(
  events: CalendarEvent[],
  sharedEvents: CalendarEvent[],
  todos: Todo[],
  categoryById: (id: string) => Category | undefined,
  firstDayOfWeek: FirstDayOfWeek,
  todayStr: string,
): SearchItem[] {
  const out: SearchItem[] = [];
  for (const e of [...events, ...sharedEvents]) {
    const categoryName = categoryById(e.category)?.name ?? '';
    out.push({
      key: eventKey(e),
      kind: 'event',
      event: e,
      title: e.title,
      fields: [e.title, e.description, categoryName],
      date: nearestOccurrence(e, todayStr),
      color: colorHex(e.colorKey),
      categoryName,
      hasReminder: e.reminders.length > 0,
      selectable: !e.sharedBy,
    });
  }
  for (const t of todos) {
    const categoryName = categoryById(t.category)?.name ?? '';
    out.push({
      key: todoKey(t),
      kind: isRepeating(t) ? 'habit' : 'task',
      todo: t,
      title: t.name,
      fields: [t.name, categoryName],
      date: nearestDueDate(t, todayStr, firstDayOfWeek),
      color: colorHex(t.colorKey),
      categoryName,
      hasReminder: t.reminder,
      selectable: true,
    });
  }
  return out;
}

export function tabOf(item: SearchItem): Exclude<ScopeTab, 'all'> {
  return item.kind === 'event' ? 'events' : item.kind === 'task' ? 'tasks' : 'habits';
}

/** `cat:` filter: a category name, or `general` (or blank) for the uncategorised. */
function inCategory(item: SearchItem, name: string): boolean {
  const want = name.toLowerCase();
  if (want === '' || want === 'general') return item.categoryName === '';
  return item.categoryName.toLowerCase() === want;
}

/**
 * Run the plan over every item. An empty query lists everything (score 0);
 * a regex that doesn't compile yet lists nothing.
 */
export function matchAll(plan: Plan, items: SearchItem[]): Hit[] {
  const scoped = plan.category === undefined ? items : items.filter((item) => inCategory(item, plan.category ?? ''));
  if (plan.mode === 'empty') return scoped.map((item) => ({ item, score: 0, positions: item.fields.map(() => []) }));
  if (!plan.ok) return [];
  const hits: Hit[] = [];
  for (const item of scoped) {
    const r = matchItem(plan, item.fields);
    if (r) hits.push({ item, score: r.score, positions: r.positions });
  }
  return hits;
}

/** Score, then nearness to today (undated last), then title. */
export function rankHits(hits: Hit[], todayStr: string): Hit[] {
  const dist = (h: Hit) => (h.item.date ? Math.abs(diffDays(todayStr, h.item.date)) : Number.POSITIVE_INFINITY);
  return hits
    .slice()
    .sort((a, b) => b.score - a.score || dist(a) - dist(b) || a.item.title.localeCompare(b.item.title));
}

/** The right-hand date column: `10 Aug · 2:00 PM`, `13 Aug – 15 Aug`, `2 Sep`, `12-day streak`, `no date`. */
export function dateLabel(item: SearchItem, firstDayOfWeek: FirstDayOfWeek): string {
  if (item.kind === 'habit') {
    const n = streakOf(item.todo, firstDayOfWeek);
    return `${n}-day streak`;
  }
  if (!item.date) return 'no date';
  if (item.kind === 'event') {
    const { event } = item;
    const span = Math.max(0, diffDays(event.startDate, event.endDate));
    if (span > 0) return `${shortDate(item.date)} – ${shortDate(addDays(item.date, span))}`;
    return event.startTime ? `${shortDate(item.date)} · ${shortTime(event.startTime)}` : shortDate(item.date);
  }
  return item.todo.time ? `${shortDate(item.date)} · ${shortTime(item.todo.time)}` : shortDate(item.date);
}

export const KIND_LABEL: Record<SearchItem['kind'], string> = { event: 'event', task: 'to-do', habit: 'habit' };
