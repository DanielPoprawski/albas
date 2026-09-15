import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { addDays, fmt } from '../../dates';
import { type ReminderChoice, reminderLabel } from '../../reminders';
import { doneDate, GENERAL, isDone, isDoneOn } from '../../todoLogic';
import type { SearchItem } from '../search/types';

const NOTICE_MS = 2400;

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The edits a selection can take as a whole — the search palette's bulk
 * panel and the list views' selection bar run the very same callbacks, so
 * "move to category" cannot mean two things. Every action posts a one-line
 * notice that clears itself; the caller decides where to show it.
 *
 * `selectedItems` are live `SearchItem`s (resolved against current data by
 * the caller), never a snapshot.
 */
export function useBulkActions(selectedItems: SearchItem[]) {
  const { updateEvent, updateTodo, deleteEvent, deleteTodo, setTodoValue, categoryById } = useApp();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  const applyCategory = useCallback(
    (categoryId: string) => {
      for (const item of selectedItems) {
        if (item.kind === 'event') updateEvent(item.event.id, { category: categoryId });
        else updateTodo(item.todo.id, { category: categoryId });
      }
      const name = categoryById(categoryId)?.name ?? GENERAL;
      setNotice(`Moved ${plural(selectedItems.length, 'item')} to ${name}`);
    },
    [selectedItems, updateEvent, updateTodo, categoryById],
  );

  /** ±n days. Events move whole (series bounds and exceptions too); dated tasks move; habits and undated stay. */
  const applyShift = useCallback(
    (n: number) => {
      let moved = 0;
      for (const item of selectedItems) {
        if (item.kind === 'event') {
          const e = item.event;
          const rec = e.recurrence;
          updateEvent(e.id, {
            startDate: addDays(e.startDate, n),
            endDate: addDays(e.endDate, n),
            recurrence:
              rec.type === 'none'
                ? rec
                : {
                    ...rec,
                    until: rec.until ? addDays(rec.until, n) : rec.until,
                    exdates: rec.exdates?.map((d) => addDays(d, n)),
                  },
          });
          moved++;
        } else if (item.kind === 'task' && item.todo.dueDate) {
          updateTodo(item.todo.id, { dueDate: addDays(item.todo.dueDate, n) });
          moved++;
        }
      }
      setNotice(`Shifted ${plural(moved, 'item')} ${n > 0 ? 'later' : 'earlier'} by ${plural(Math.abs(n), 'day')}`);
    },
    [selectedItems, updateEvent, updateTodo],
  );

  const applyReminder = useCallback(
    (choice: ReminderChoice) => {
      for (const item of selectedItems) {
        if (item.kind === 'event') updateEvent(item.event.id, { reminders: choice === 'none' ? [] : [choice] });
        else updateTodo(item.todo.id, { reminder: choice !== 'none' });
      }
      const label = choice === 'none' ? 'No reminder' : `Reminder "${reminderLabel(choice)}"`;
      setNotice(`${label} on ${plural(selectedItems.length, 'item')}`);
    },
    [selectedItems, updateEvent, updateTodo],
  );

  /** Star or unstar every selected to-do; events have no importance. */
  const setImportant = useCallback(
    (important: boolean) => {
      let n = 0;
      for (const item of selectedItems) {
        if (item.kind === 'event') continue;
        updateTodo(item.todo.id, { important });
        n++;
      }
      setNotice(`${important ? 'Starred' : 'Unstarred'} ${plural(n, 'to-do')}`);
    },
    [selectedItems, updateTodo],
  );

  /**
   * Mark every selected to-do done today — a task logs on the day it was
   * ticked, never backdated to its due day (`completionDay`), a habit on
   * today's cell. Already-done rows are left alone.
   */
  const complete = useCallback(() => {
    const today = fmt(new Date());
    let n = 0;
    for (const item of selectedItems) {
      if (item.kind === 'event') continue;
      const t = item.todo;
      if (item.kind === 'task' ? isDone(t) : isDoneOn(t, today)) continue;
      setTodoValue(t.id, today, t.target);
      n++;
    }
    setNotice(`Completed ${plural(n, 'to-do')}`);
  }, [selectedItems, setTodoValue]);

  /** Clear the completion that makes each selected to-do count as done (a task's logged day, a habit's today). */
  const uncomplete = useCallback(() => {
    const today = fmt(new Date());
    let n = 0;
    for (const item of selectedItems) {
      if (item.kind === 'event') continue;
      const t = item.todo;
      const date = item.kind === 'task' ? doneDate(t) : isDoneOn(t, today) ? today : null;
      if (!date) continue;
      setTodoValue(t.id, date, 0);
      n++;
    }
    setNotice(`Reopened ${plural(n, 'to-do')}`);
  }, [selectedItems, setTodoValue]);

  const applyDelete = useCallback(() => {
    for (const item of selectedItems) {
      if (item.kind === 'event') deleteEvent(item.event.id);
      else deleteTodo(item.todo.id);
    }
    setNotice(`Deleted ${plural(selectedItems.length, 'item')}`);
  }, [selectedItems, deleteEvent, deleteTodo]);

  return {
    notice,
    setNotice,
    applyCategory,
    applyShift,
    applyReminder,
    setImportant,
    complete,
    uncomplete,
    applyDelete,
  };
}
