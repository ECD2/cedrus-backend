import * as people from '../services/people.js';

// The model proposes a resolution per person; here we apply the fuzzy-match
// BACKSTOP (catches Mike/Michael) and create/merge. Returns mention_text -> person_id.
export async function resolveEntities({ user, parsed }) {
  const personByMention = {};

  // Priority 0: a crisis/boundary turn extracts and creates nothing. Crisis
  // content must never flow into ordinary storage (safety spec §7).
  if (parsed._suppressPersistence) return { personByMention };

  for (const p of parsed.people || []) {
    if ((p.resolution === 'existing' || p.resolution === 'self') && p.person_id) {
      personByMention[p.mention_text] = p.person_id;
      continue;
    }

    if (p.resolution === 'new') {
      const match = await people.fuzzyFind(user.id, p.proposed_name);
      if (match && match.score >= 0.6) {              // TODO: tune threshold from logs
        personByMention[p.mention_text] = match.id;   // TODO: optionally store proposed_name as an alias
      } else {
        const created = await people.create(user.id, {
          name: p.proposed_name, relationship: p.proposed_relationship,
        });
        personByMention[p.mention_text] = created.id;
      }
      continue;
    }

    if (p.resolution === 'ambiguous') {
      // Brand rule: guess + let the user correct, rather than interrogate.
      // MVP picks the first candidate. TODO: optionally open a confirm prompt.
      personByMention[p.mention_text] = (p.candidate_ids && p.candidate_ids[0]) || null;
    }
  }

  return { personByMention };
}
