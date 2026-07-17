import { fmt } from './dates';
import { isDoneOn, isDueOn } from './habitLogic';
import type { Habit } from './types';

const NOTIFIED_KEY = 'albas-last-reminder';

function inTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/**
 * Send one desktop notification per day listing habits that are due today,
 * have reminders enabled, and aren't done yet. No-op outside Tauri (plain
 * browser dev server) and when everything is already done.
 */
export async function remindDueHabits(habits: Habit[]): Promise<void> {
  if (!inTauri()) return;

  const todayStr = fmt(new Date());
  if (localStorage.getItem(NOTIFIED_KEY) === todayStr) return;

  const due = habits.filter(h => h.reminder && isDueOn(h, todayStr) && !isDoneOn(h, todayStr));
  if (due.length === 0) return;

  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import('@tauri-apps/plugin-notification');

    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (!granted) return;

    sendNotification({
      title: due.length === 1 ? 'Habit due today' : `${due.length} habits due today`,
      body: due.map(h => h.name).join(', '),
    });
    localStorage.setItem(NOTIFIED_KEY, todayStr);
  } catch (err) {
    console.warn('notification failed:', err);
  }
}
