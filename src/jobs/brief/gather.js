import * as people from '../../services/people.js';
import * as memory from '../../services/memory.js';

// Pull the raw material for one user's brief. Three reads:
//  - the agent context view (people + bundled current facts + active saved items
//    + proactive_enabled + drift health) — the master source
//  - birthdays (the view doesn't carry birthday fields)
//  - still-open intentions from prior weeks
export async function gatherCandidates(user) {
  const [context, birthdays, openGoals] = await Promise.all([
    people.getAgentContext(user.id),     // v_agent_person_context, all people
    people.getBirthdaysForUser(user.id),
    memory.getOpenGoals(user.id),
  ]);
  return { user, context, birthdays, openGoals };
}
