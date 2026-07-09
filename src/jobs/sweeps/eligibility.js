import * as users from '../../services/users.js';
import * as usage from '../../services/usage.js';
import * as rel from '../../services/relationships.js';
import { localParts } from '../../utils/time.js';

// A considerate daytime window (sits inside normal waking hours; quiet_hours
// columns exist on app_users for future per-user customization).
const NUDGE_WINDOW_START = 10; // 10am local
const NUDGE_WINDOW_END = 19;   // 7pm local
const MIN_HOURS_BETWEEN_NUDGES = 20;

// Who can be nudged on THIS sweep? Three rails, all about not being spammy.
export async function getNudgeableUsers(now = new Date()) {
  const all = await users.listNudgeable(); // opted_out = false
  const out = [];

  for (const u of all) {
    const { hour } = localParts(u.timezone, now);
    if (hour < NUDGE_WINDOW_START || hour >= NUDGE_WINDOW_END) continue; // good-time-of-day rail

    // weekly nudge BUDGET — the hard fatigue rail (free=1, pro=3 by default)
    const budget = await usage.getNudgeUsage(u.id);
    if (budget && budget.nudges_sent_this_week >= budget.weekly_budget) continue;

    // at most ~one nudge per day, so touches never cluster
    const since = new Date(now.getTime() - MIN_HOURS_BETWEEN_NUDGES * 3600000).toISOString();
    if (await rel.hasRecentNudge(u.id, since)) continue;

    out.push(u);
  }
  return out;
}
