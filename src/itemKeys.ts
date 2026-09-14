import type { CalendarEvent, ItemKey, Todo } from './types';

export function eventKey(e: CalendarEvent): ItemKey {
  return `event:${e.id}`;
}

export function todoKey(t: Todo): ItemKey {
  return `todo:${t.id}`;
}
