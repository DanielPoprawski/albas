// Maps raw shared rows (the server's opaque column-map payloads, cached in
// SQLite by sync.rs) into typed read-only seeds, lists and tags, grouped by
// the account that shared them.
//
// Two invariants worth knowing:
// - Every id is namespaced `${owner}:${pk}` — the seed's own id, its `list`,
//   every entry of its `tags`. Another person's UUIDs can never collide with
//   local ones in occurrence keys, and a shared id can never match anything
//   `updateSeed`/`deleteSeed` would look up.
// - Reminders are stripped: your phone should not buzz for someone else's
//   dentist appointment.

import { COLOR_KEYS, DEFAULT_COLOR } from './colors';
import { bySort } from './seedLogic';
import type { ColorKey, List, RawSharedRow, Repeat, Seed, SharedGroup, Tag, Track } from './types';

/** Joins composite primary keys on the server and in sync.rs. */
const PK_SEP = '\u0001';

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

function parseJson(v: unknown, fallback: unknown): unknown {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateOrNull(v: unknown): string | null {
  const s = str(v);
  return DATE_RE.test(s) ? s : null;
}

function colorKey(v: unknown): ColorKey | null {
  const s = str(v);
  return COLOR_KEYS.includes(s as ColorKey) ? (s as ColorKey) : null;
}

/** Namespaces a bare id the way every shared row's own id is namespaced. */
function ns(owner: string, rawId: unknown): string {
  const id = str(rawId);
  return id ? `${owner}:${id}` : '';
}

function sharedSeed(owner: string, id: string, p: Record<string, unknown>): Seed {
  const date = dateOrNull(p.date);
  const endDate = dateOrNull(p.end_date);
  const rawTags = parseJson(p.tags, []);
  const repeat = parseJson(p.repeat, { type: 'none' }) as Repeat;
  const track = str(p.track) ? (parseJson(p.track, null) as Track) : null;
  return {
    id,
    title: str(p.title, '(untitled)'),
    notes: str(p.notes),
    color: colorKey(p.color),
    list: ns(owner, p.list),
    tags: Array.isArray(rawTags) ? rawTags.map((t) => ns(owner, t)).filter(Boolean) : [],
    important: !!p.important,
    sort: num(p.sort),
    routine: '',
    createdAt: dateOrNull(p.created_at) ?? date ?? '1970-01-01',
    date,
    time: str(p.time) || null,
    endDate: endDate && date && endDate > date ? endDate : null,
    endTime: str(p.end_time) || null,
    repeat: repeat && typeof repeat === 'object' && 'type' in repeat ? repeat : { type: 'none' },
    track: track && typeof track === 'object' && 'kind' in track ? track : null,
    reminders: [],
    done: {},
    sharedBy: owner,
  };
}

export function mapSharedRows(rows: RawSharedRow[]): SharedGroup[] {
  const owners = new Map<string, RawSharedRow[]>();
  for (const row of rows) {
    if (!row.payload || typeof row.payload !== 'object') continue;
    const list = owners.get(row.owner);
    if (list) list.push(row);
    else owners.set(row.owner, [row]);
  }

  const groups: SharedGroup[] = [];
  for (const [owner, ownerRows] of owners) {
    const seeds = new Map<string, Seed>();
    const lists: List[] = [];
    const tags: Tag[] = [];
    const done: Array<[string, string, number]> = [];

    for (const { tbl, pk, payload } of ownerRows) {
      const p = payload as Record<string, unknown>;
      const id = `${owner}:${pk}`;
      switch (tbl) {
        case 'seeds':
          seeds.set(id, sharedSeed(owner, id, p));
          break;
        case 'done': {
          const [seedId, date] = pk.split(PK_SEP);
          if (seedId && DATE_RE.test(date ?? '')) done.push([`${owner}:${seedId}`, date, num(p.value)]);
          break;
        }
        case 'lists':
          lists.push({ id, name: str(p.name, '(untitled)'), sort: num(p.sort) });
          break;
        case 'tags':
          tags.push({
            id,
            name: str(p.name, '(untitled)'),
            color: colorKey(p.color) ?? DEFAULT_COLOR,
            icon: str(p.icon),
            sort: num(p.sort),
          });
          break;
      }
    }

    // Done rows may arrive before, after, or without their seed in the
    // stream order; fold them in at the end and drop orphans.
    for (const [seedId, date, value] of done) {
      const seed = seeds.get(seedId);
      if (seed && value > 0) seed.done[date] = value;
    }

    groups.push({
      owner,
      seeds: [...seeds.values()].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id)),
      lists: lists.sort(bySort),
      tags: tags.sort(bySort),
    });
  }

  return groups.sort((a, b) => a.owner.localeCompare(b.owner));
}

// --- Display -----------------------------------------------------------------
// How a shared (read-only) seed is marked wherever seeds render. Central so
// the month pills, bars, week lanes, day strip and hour grid can't drift: the
// owner's initial in the label, a dimmed body, and an explanatory tooltip.

/** "s · Dinner" — the sharing account's initial prefixes the title. */
export function seedTitle(s: Seed): string {
  return s.sharedBy ? `${s.sharedBy[0].toUpperCase()} · ${s.title}` : s.title;
}

/** Shared items draw dimmed; `undefined` leaves own items untouched. */
export function sharedOpacity(s: Seed): number | undefined {
  return s.sharedBy ? 0.55 : undefined;
}

export function sharedTitleAttr(s: Seed): string | undefined {
  return s.sharedBy ? `Shared by ${s.sharedBy} (read-only)` : undefined;
}
