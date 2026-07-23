import * as people from '../services/people.js';
import { decideResolution } from '../services/entityResolution.js';

// The model proposes a resolution per person; here we apply the Phase-1 confidence
// bands (src/services/entityResolution.js — the ONE place the merge/create decision
// lives) and EXECUTE the create or merge. Returns mention_text -> person_id.
//
// Phase 1 of docs/ENTITY_RESOLUTION_V2.md fixes the wrong-person merge: the old
// `fuzzyFind >= 0.6 => merge` backstop silently merged "Lucas" into "Luca" on a bare
// substring. Now a merge is automatic ONLY on an exact name / registered alias /
// curated nickname; a "new-person" phrasing cue ("met a guy named Lucas") always
// creates a new person; and a genuinely-ambiguous mention DEFAULTS TO CREATE rather
// than guessing a merge onto an existing record. The ask-first clarification loop
// (HOLD the write + ask "same person, or someone new?") is deferred to Phase 2.
export async function resolveEntities({ user, parsed, body = '' }) {
  const personByMention = {};
  const asks = []; // Phase 2a: mentions HELD for a clarification (never merged/created here)

  // Priority 0: a crisis/boundary turn extracts and creates nothing. Crisis
  // content must never flow into ordinary storage (safety spec §7).
  if (parsed._suppressPersistence) return { personByMention, asks };

  // One user-scoped read of the existing people (id, name, aliases, relationship,
  // is_self). The band decision is a pure function over this roster.
  const roster = await people.listForUser(user.id);

  for (const p of parsed.people || []) {
    const verdict = decideResolution({ mention: p, body, people: roster });

    if (verdict.action === 'existing' && verdict.personId) {
      personByMention[p.mention_text] = verdict.personId;
      continue;
    }

    // Phase 2a — action 'ask': a near-match / bare-name / model-ambiguous mention.
    // HOLD it: do not create and do not map it, so persist() naturally skips its
    // facts/items (ref → null). The clarification loop enqueues the held write and
    // asks ONE candidate-listing question (services/clarifications.js).
    if (verdict.action === 'ask') {
      asks.push({ mention: p, candidates: verdict.candidates || [], askKind: verdict.askKind });
      continue;
    }

    // action 'new' — create a fresh person (no match at all, or a new-person cue).
    // create() is user-scoped (ownership guard).
    const created = await people.create(user.id, {
      name: p.proposed_name || p.mention_text,
      relationship: p.proposed_relationship || null,
    });
    personByMention[p.mention_text] = created.id;
    // Let a repeated mention of the SAME new name later in this one message resolve
    // to the row we just created instead of duplicating it.
    roster.push({ id: created.id, name: created.name, aliases: created.aliases || [], relationship: created.relationship, is_self: false });
  }

  return { personByMention, asks };
}
