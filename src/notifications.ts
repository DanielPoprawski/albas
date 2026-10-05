import { addDays, fmt, parse, shortDate } from './dates';
import { inTauri } from './persistence';
import { expandSeeds, isDoneOn, type Occurrence, shortTime } from './seedLogic';
import type { FirstDayOfWeek, Seed } from './types';

const SENT_KEY = 'albas-reminders-sent';

/** When a seed with no time of its own is reminded on its day. */
const DEFAULT_REMINDER_TIME = '09:00';

/** Occurrence start as epoch ms; an all-day seed anchors at the default reminder time. */
function occStartMs(o: Occurrence): number {
  const d = parse(o.startDate);
  const [h, m] = (o.seed.time ?? DEFAULT_REMINDER_TIME).split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/**
 * Fire desktop notifications for upcoming occurrences whose reminder window
 * (start − lead minutes) has opened and that aren't done yet. Each
 * occurrence+lead fires at most once, tracked in localStorage. No-op outside
 * Tauri (plain browser dev server).
 */
export async function remindDue(seeds: Seed[], firstDay: FirstDayOfWeek = 0): Promise<void> {
  if (!inTauri()) return;

  const now = Date.now();
  const todayStr = fmt(new Date());
  // 8-day horizon covers the longest preset lead (1 week)
  const occs = expandSeeds(
    seeds.filter((s) => s.reminders.length > 0),
    todayStr,
    addDays(todayStr, 8),
    firstDay,
  );

  let sent: Record<string, number> = {};
  try {
    sent = JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') ?? {};
  } catch {
    /* corrupted store — start fresh */
  }

  const due: { occ: Occurrence; key: string; start: number }[] = [];
  for (const occ of occs) {
    if (isDoneOn(occ.seed, occ.startDate)) continue;
    const start = occStartMs(occ);
    for (const lead of occ.seed.reminders) {
      const key = `${occ.key}:${lead}`;
      if (key in sent) continue;
      // A lead of 0 on an untimed seed means "on the day", so it may fire any time after 09:00.
      const open = start - lead * 60_000 <= now && (now < start || (lead === 0 && occ.seed.time === null));
      if (open) due.push({ occ, key, start });
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
      const { seed } = occ;
      const at = seed.time ? ` at ${shortTime(seed.time)}` : '';
      const when = occ.startDate === todayStr ? `today${at}` : `${shortDate(occ.startDate)}${at}`;
      sendNotification({ title: seed.title, body: seed.track ? `Due ${when}` : `Starts ${when}` });
      sent[key] = start;
    }

    // drop entries whose start passed over 30 days ago so the store stays small
    const cutoff = now - 30 * 86_400_000;
    sent = Object.fromEntries(Object.entries(sent).filter(([, start]) => start > cutoff));
    localStorage.setItem(SENT_KEY, JSON.stringify(sent));
  } catch (err) {
    console.warn('notification failed:', err);
  }
}
