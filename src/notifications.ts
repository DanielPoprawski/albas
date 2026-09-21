import { addDays, fmt, parse, shortDate } from './dates';
import { expandEvents, shortTime, type Occurrence } from './eventLogic';
import { isDoneOn, isDueOn } from './todoLogic';
import { inTauri } from './persistence';
import type { CalendarEvent, FirstDayOfWeek, Todo } from './types';

const NOTIFIED_KEY = 'albas-last-reminder';
const EVENT_NOTIFIED_KEY = 'albas-event-reminders-sent';

/** When a to-do with no time of its own is reminded on a due day. */
const DEFAULT_REMINDER_TIME = '09:00';

/**
 * Notify about to-dos due today once their reminder time (`time`, else 09:00)
 * has passed and they aren't done yet — one notification per pass, each
 * to-do at most once a day (tracked in localStorage as id → day). No-op
 * outside Tauri (plain browser dev server).
 */
export async function remindDueTodos(todos: Todo[], firstDay: FirstDayOfWeek = 0): Promise<void> {
  if (!inTauri()) return;

  const now = new Date();
  const todayStr = fmt(now);
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let sent: Record<string, string> = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') sent = parsed;
  } catch {
    /* the pre-time-of-day store was a bare date string — start fresh */
  }

  const due = todos.filter(
    (t) =>
      t.reminder &&
      sent[t.id] !== todayStr &&
      (t.time ?? DEFAULT_REMINDER_TIME) <= nowHm &&
      isDueOn(t, todayStr, firstDay) &&
      !isDoneOn(t, todayStr),
  );
  if (due.length === 0) return;

  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      '@tauri-apps/plugin-notification'
    );

    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (!granted) return;

    sendNotification({
      title: due.length === 1 ? 'Due today' : `${due.length} to-dos due today`,
      body: due.map((t) => t.name).join(', '),
    });
    for (const t of due) sent[t.id] = todayStr;
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(sent));
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
  } catch {
    /* corrupted store — start fresh */
  }

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
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      '@tauri-apps/plugin-notification'
    );

    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (!granted) return;

    for (const { occ, key, start } of due) {
      const timed = !occ.event.allDay && occ.event.startTime;
      const when =
        occ.startDate === todayStr
          ? timed
            ? `today at ${shortTime(occ.event.startTime!)}`
            : 'today'
          : timed
            ? `${shortDate(occ.startDate)} at ${shortTime(occ.event.startTime!)}`
            : shortDate(occ.startDate);
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
