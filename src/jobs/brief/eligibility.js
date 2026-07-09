import * as users from '../../services/users.js';
import * as briefs from '../../services/briefs.js';
import { localParts, localWeekOf } from '../../utils/time.js';

// Who should receive a brief at THIS hour? The cron fires hourly (UTC); we decide
// per user using THEIR timezone, and skip anyone already sent this week.
export async function getUsersDueForBrief(now = new Date()) {
  const candidates = await users.listActiveForBrief(); // opted_out = false
  const due = [];

  for (const u of candidates) {
    const { weekday, hour } = localParts(u.timezone, now);
    if (weekday !== (u.brief_day || 'sunday')) continue;
    const briefHour = parseInt((u.brief_time || '08:00').split(':')[0], 10);
    if (hour !== briefHour) continue;

    const weekOf = localWeekOf(u.timezone, now);
    if (await briefs.hasBriefForWeek(u.id, weekOf)) continue; // already sent this week

    u._weekOf = weekOf;
    due.push(u);
  }
  return due;
}
