import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { addDays, fmt } from '../../dates';
import { type ReminderChoice, reminderLabel } from '../../reminders';
import { doneDate, GENERAL, isDone, isDoneOn, isRepeating, targetOf } from '../../seedLogic';
import type { SearchItem } from '../search/types';

const NOTICE_MS = 2400;

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The edits a selection can take as a whole — the search palette's bulk
 * panel and the list views' selection bar run the very same callbacks, so
 * "move to list" cannot mean two things. Every action posts a one-line
 * notice that clears itself; the caller decides where to show it.
 *
 * `selectedItems` are live `SearchItem`s (resolved against current data by
 * the caller), never a snapshot.
 */
export function useBulkActions(selectedItems: SearchItem[]) {
  const { updateSeed, deleteSeed, setDone, listById, tagById } = useApp();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  const applyList = useCallback(
    (listId: string) => {
      for (const item of selectedItems) updateSeed(item.seed.id, { list: listId });
      const name = listById(listId)?.name ?? GENERAL;
      setNotice(`Moved ${plural(selectedItems.length, 'item')} to ${name}`);
    },
    [selectedItems, updateSeed, listById],
  );

  /**
   * Adds the tag to every selected item that lacks it (last, so it takes over
   * colour and icon) — or, when all of them already carry it, removes it.
   */
  const applyTag = useCallback(
    (tagId: string) => {
      const remove = selectedItems.every((i) => i.seed.tags.includes(tagId));
      for (const { seed } of selectedItems) {
        if (remove) updateSeed(seed.id, { tags: seed.tags.filter((t) => t !== tagId) });
        else if (!seed.tags.includes(tagId)) updateSeed(seed.id, { tags: [...seed.tags, tagId] });
      }
      const name = tagById(tagId)?.name ?? 'tag';
      const n = plural(selectedItems.length, 'item');
      setNotice(remove ? `Removed ${name} from ${n}` : `Added ${name} to ${n}`);
    },
    [selectedItems, updateSeed, tagById],
  );

  /** ±n days. Dated seeds move whole (series bounds and exceptions too); undated ones stay. */
  const applyShift = useCallback(
    (n: number) => {
      let moved = 0;
      for (const { seed } of selectedItems) {
        if (!seed.date) continue;
        const r = seed.repeat;
        updateSeed(seed.id, {
          date: addDays(seed.date, n),
          endDate: seed.endDate ? addDays(seed.endDate, n) : null,
          repeat:
            r.type === 'none'
              ? r
              : {
                  ...r,
                  until: r.until ? addDays(r.until, n) : r.until,
                  ...(r.type === 'every' && r.exdates ? { exdates: r.exdates.map((d) => addDays(d, n)) } : {}),
                },
        });
        moved++;
      }
      setNotice(`Shifted ${plural(moved, 'item')} ${n > 0 ? 'later' : 'earlier'} by ${plural(Math.abs(n), 'day')}`);
    },
    [selectedItems, updateSeed],
  );

  const applyReminder = useCallback(
    (choice: ReminderChoice) => {
      for (const item of selectedItems) updateSeed(item.seed.id, { reminders: choice === 'none' ? [] : [choice] });
      const label = choice === 'none' ? 'No reminder' : `Reminder "${reminderLabel(choice)}"`;
      setNotice(`${label} on ${plural(selectedItems.length, 'item')}`);
    },
    [selectedItems, updateSeed],
  );

  const setImportant = useCallback(
    (important: boolean) => {
      for (const item of selectedItems) updateSeed(item.seed.id, { important });
      setNotice(`${important ? 'Starred' : 'Unstarred'} ${plural(selectedItems.length, 'item')}`);
    },
    [selectedItems, updateSeed],
  );

  /**
   * Mark every selected doable seed done today — a to-do logs on the day it
   * was ticked, never backdated to its due day (`completionDay`), a habit on
   * today's cell. Events and already-done rows are left alone.
   */
  const complete = useCallback(() => {
    const today = fmt(new Date());
    let n = 0;
    for (const { seed } of selectedItems) {
      if (!seed.track) continue;
      if (isRepeating(seed) ? isDoneOn(seed, today) : isDone(seed)) continue;
      setDone(seed.id, today, targetOf(seed));
      n++;
    }
    setNotice(`Completed ${plural(n, 'to-do')}`);
  }, [selectedItems, setDone]);

  /** Clear the completion that makes each selected seed count as done (a to-do's logged day, a habit's today). */
  const uncomplete = useCallback(() => {
    const today = fmt(new Date());
    let n = 0;
    for (const { seed } of selectedItems) {
      if (!seed.track) continue;
      const date = isRepeating(seed) ? (isDoneOn(seed, today) ? today : null) : doneDate(seed);
      if (!date) continue;
      setDone(seed.id, date, 0);
      n++;
    }
    setNotice(`Reopened ${plural(n, 'to-do')}`);
  }, [selectedItems, setDone]);

  const applyDelete = useCallback(() => {
    for (const item of selectedItems) deleteSeed(item.seed.id);
    setNotice(`Deleted ${plural(selectedItems.length, 'item')}`);
  }, [selectedItems, deleteSeed]);

  return {
    notice,
    setNotice,
    applyList,
    applyTag,
    applyShift,
    applyReminder,
    setImportant,
    complete,
    uncomplete,
    applyDelete,
  };
}
