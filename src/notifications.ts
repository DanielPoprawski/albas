import { addDays, fmt, parse, shortDate } from './dates';
import { expandEvents, shortTime, type Occurrence } from './eventLogic';
import { isDoneOn, isDueOn } from './habitLogic';
import type { CalendarEvent, Habit } from './types';

const NOTIFIED_KEY = 'albas-last-reminder';
const EVENT_NOTIFIED_KEY = 'albas-event-reminders-sent';

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

/** Occurrence start as epoch ms; all-day events anchor at local midnight. */
function occStartMs(o: Occurrence): number {
  const d = parse(o.startDate);
  if (!o.event.allDay && o.event.startTime) {
    const [h, m] = o.event.startTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d.getTime();
}

/**
 * Fire desktop notifications for upcoming event occurrences whose reminder
 * window (start − offset minutes) has opened. Each occurrence+offset fires at
 * most once, tracked in localStorage. No-op outside Tauri.
 */
export async function remindDueEvents(events: CalendarEvent[]): Promise<void> {
  if (!inTauri()) return;

  const now = Date.now();
  const todayStr = fmt(new Date());
  // 8-day horizon covers the longest preset offset (1 week)
  const occs = expandEvents(events, todayStr, addDays(todayStr, 8));

  let sent: Record<string, number> = {};
  try {
    sent = JSON.parse(localStorage.getItem(EVENT_NOTIFIED_KEY) ?? '{}') ?? {};
  } catch { /* corrupted store — start fresh */ }

  const due: { occ: Occurrence; offset: number; key: string; start: number }[] = [];
  for (const occ of occs) {
    const start = occStartMs(occ);
    for (const offset of occ.event.reminders) {
      const key = `${occ.key}:${offset}`;
      if (key in sent) continue;
      if (start - offset * 60_000 <= now && now < start) {
        due.push({ occ, offset, key, start });
      }
    }
  }
  if (due.length === 0) return;

  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import('@tauri-apps/plugin-notification');

    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (!granted) return;

    for (const { occ, key, start } of due) {
      const timed = !occ.event.allDay && occ.event.startTime;
      const when = occ.startDate === todayStr
        ? (timed ? `today at ${shortTime(occ.event.startTime!)}` : 'today')
        : (timed ? `${shortDate(occ.startDate)} at ${shortTime(occ.event.startTime!)}` : shortDate(occ.startDate));
      sendNotification({ title: occ.event.title, body: `Starts ${when}` });
      sent[key] = start;
    }

    // drop entries whose start passed over 30 days ago so the store stays small
    const cutoff = now - 30 * 86_400_000;
    sent = Object.fromEntries(Object.entries(sent).filter(([, start]) => start > cutoff));
    localStorage.setItem(EVENT_NOTIFIED_KEY, JSON.stringify(sent));
  } catch (err) {
    console.warn('event notification failed:', err);
  }
}
