import * as people from '../../services/people.js';
import * as memory from '../../services/memory.js';
import { localWeekOf } from '../../utils/time.js';

export async function gatherNudgeCandidates(user, now = new Date()) {
  const weekOf = localWeekOf(user.timezone, now);
  const [context, birthdays, goals, cooldowns] = await Promise.all([
    people.getAgentContext(user.id),                 // drift health + proactive_enabled
    people.getBirthdaysForUser(user.id),
    memory.getOpenGoalsThisWeek(user.id, weekOf),     // intentions to follow up on
    people.getNudgeCooldowns(user.id),                // per-person cooldowns
  ]);
  return { user, context, birthdays, goals, cooldowns, weekOf };
}
