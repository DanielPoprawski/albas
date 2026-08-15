// Maps raw shared rows (the server's opaque column-map payloads, cached in
// SQLite by sync.rs) into typed read-only events and todos, grouped by the
// account that shared them.
//
// Two invariants worth knowing:
// - Every id is namespaced `${owner}:${pk}`. Another person's UUIDs can never
//   collide with local ones in occurrence keys, and a shared id can never
//   match anything updateEvent/deleteTodo would look up.
// - Reminders are stripped (events' lead times, todos' reminder flag): your
//   phone should not buzz for someone else's dentist appointment.

import type { CalendarEvent, RawSharedRow, SharedGroup, Todo } from './types';
import { migrateLegacyTask, migrateTodo, periodToEvent, taskToTodo } from './migrations';
import { DEFAULT_COLOR } from './colors';

/** Joins composite primary keys on the server and in sync.rs. */
const PK_SEP = '\u0001';

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
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

function sharedEvent(owner: string, id: string, p: Record<string, unknown>): CalendarEvent | null {
  const startDate = str(p.start_date);
  if (!DATE_RE.test(startDate)) return null;
  const endDate = str(p.end_date, startDate);
  return {
    id,
    title: str(p.title, '(untitled)'),
    description: str(p.description),
    colorKey: str(p.color_key) || DEFAULT_COLOR,
    allDay: !!p.all_day,
    startDate,
    startTime: str(p.start_time) || null,
    endDate: DATE_RE.test(endDate) && endDate >= startDate ? endDate : startDate,
    endTime: str(p.end_time) || null,
    recurrence: parseJson(p.recurrence, { type: 'none' }) as CalendarEvent['recurrence'],
    reminders: [],
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
    const events: CalendarEvent[] = [];
    const todos = new Map<string, Todo>();
    const completions: Array<[string, string, number]> = [];

    for (const { tbl, pk, payload } of ownerRows) {
      const p = payload as Record<string, unknown>;
      const id = `${owner}:${pk}`;
      switch (tbl) {
        case 'events': {
          const e = sharedEvent(owner, id, p);
          if (e) events.push(e);
          break;
        }
        case 'periods': {
          const startDate = str(p.start_date);
          if (!DATE_RE.test(startDate)) break;
          events.push({
            ...periodToEvent({
              id,
              name: str(p.name, '(untitled)'),
              colorKey: str(p.color_key) || DEFAULT_COLOR,
              startDate,
              endDate: str(p.end_date, startDate),
              notes: str(p.notes),
              habitIds: [],
            }),
            sharedBy: owner,
          });
          break;
        }
        case 'habits': {
          const todo = migrateTodo({
            id,
            name: str(p.name, '(untitled)'),
            colorKey: str(p.color_key),
            kind: str(p.kind),
            unit: str(p.unit),
            target: typeof p.target === 'number' ? p.target : 1,
            schedule: parseJson(p.schedule, { type: 'daily' }),
            createdAt: str(p.created_at) || undefined,
            reminder: false,
            dueDate: str(p.due_date) || null,
            time: str(p.time) || null,
            category: str(p.category),
            important: !!p.important,
            completions: {},
          });
          todos.set(id, todo);
          break;
        }
        case 'tasks': {
          todos.set(
            id,
            taskToTodo(
              migrateLegacyTask({
                id,
                title: str(p.title),
                category: str(p.category),
                completed: !!p.completed,
                date: str(p.date) || null,
              })
            )
          );
          break;
        }
        case 'habit_completions': {
          const [habitId, date] = pk.split(PK_SEP);
          if (habitId && DATE_RE.test(date ?? '')) {
            const value = typeof p.value === 'number' ? p.value : 0;
            completions.push([`${owner}:${habitId}`, date, value]);
          }
          break;
        }
        // weights (or anything a newer server sends) are simply not displayed
      }
    }

    // Completions may arrive before, after, or without their habit in the
    // stream order; fold them in at the end and drop orphans.
    for (const [todoId, date, value] of completions) {
      const todo = todos.get(todoId);
      if (todo && value > 0) todo.completions[date] = value;
    }

    groups.push({
      owner,
      events: events.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)),
      todos: [...todos.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    });
  }

  return groups.sort((a, b) => a.owner.localeCompare(b.owner));
}
