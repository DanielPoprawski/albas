import { addDays, diffDays, shortDate } from '../../dates';
import { seedKey } from '../../itemKeys';
import { type Plan, matchItem } from '../../searchMatch';
import { isHabit, kindLabel, nearestDate, shortTime, streakOf } from '../../seedLogic';
import type { ColorKey, FirstDayOfWeek, List, Seed, Tag } from '../../types';
import type { Hit, ScopeTab, SearchItem } from './types';

/** Hits shown at once; counts are still over every match. */
export const MAX_HITS = 50;

/** Everything the palette can find, decorated once per data change. */
export function toSearchItems(
  seeds: Seed[],
  listById: (id: string) => List | undefined,
  tagById: (id: string) => Tag | undefined,
  colorOf: (seed: Seed) => ColorKey,
  firstDayOfWeek: FirstDayOfWeek,
  todayStr: string,
): SearchItem[] {
  return seeds.map((s) => {
    const listName = listById(s.list)?.name ?? '';
    const tagNames = s.tags.map((t) => tagById(t)?.name ?? '').filter(Boolean);
    return {
      key: seedKey(s),
      seed: s,
      title: s.title,
      fields: [s.title, s.notes, listName, ...tagNames],
      date: nearestDate(s, todayStr, firstDayOfWeek),
      color: colorOf(s),
      listName,
      hasReminder: s.reminders.length > 0,
      selectable: !s.sharedBy,
    };
  });
}

export function tabOf(item: SearchItem): Exclude<ScopeTab, 'all'> {
  const kind = kindLabel(item.seed);
  return kind === 'event' ? 'events' : kind === 'to-do' ? 'tasks' : 'habits';
}

/** `cat:` filter: a list name, or `general` (or blank) for the unfiled. */
function inList(item: SearchItem, name: string): boolean {
  const want = name.toLowerCase();
  if (want === '' || want === 'general') return item.listName === '';
  return item.listName.toLowerCase() === want;
}

/**
 * Run the plan over every item. An empty query lists everything (score 0);
 * a regex that doesn't compile yet lists nothing.
 */
export function matchAll(plan: Plan, items: SearchItem[]): Hit[] {
  const scoped = plan.category === undefined ? items : items.filter((item) => inList(item, plan.category ?? ''));
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
  const { seed } = item;
  if (isHabit(seed)) return `${streakOf(seed, firstDayOfWeek)}-day streak`;
  if (!item.date) return 'no date';
  const span = seed.endDate ? Math.max(0, diffDays(seed.date ?? seed.endDate, seed.endDate)) : 0;
  if (span > 0) return `${shortDate(item.date)} – ${shortDate(addDays(item.date, span))}`;
  return seed.time ? `${shortDate(item.date)} · ${shortTime(seed.time)}` : shortDate(item.date);
}
