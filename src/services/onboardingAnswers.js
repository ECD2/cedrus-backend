import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import * as memory from './memory.js';
import * as people from './people.js';

// ─────────────────────────────────────────────────────────────────────────────
// Web onboarding answers (night build 2026-07-28, item 5).
//
// POST /api/onboarding/answers persists a STEP-KEYED answer graph from the new
// web platform's onboarding into the EXISTING facts/people layer — additive
// only. It does not touch the SMS onboarding flow (needsFreshStart /
// onboarding_complete stay owned by the pipeline), and it invents no new
// storage: every answer becomes a facts row (self-person scoped) or a people
// row, which is exactly where the concierge already reads context from.
//
// Idempotency: re-submitting a step REPLACES that step's answers via the
// facts layer's own supersession — single-answer steps pass
// supersedesPrior:true; multi-answer steps supersede on the batch's first
// insert (retiring the whole prior set) and append the rest. Facts writes go
// through memory.addFact, which THROWS on a failed insert (the post-incident
// fix), so a saved step is a step that actually landed — never a confident
// false ack (Lesson 1).
//
// fact_type values are the live enum (probed 2026-07-28): preference |
// interest | life_event | goal | mood | relationship_detail | context | note.
// ─────────────────────────────────────────────────────────────────────────────

export const ONBOARDING_STEPS = [
  'work_setup', 'neighborhood', 'free_windows', 'activities',
  'current_groups', 'people', 'social_prefs',
];
export const FRIENDSHIP_STAGES = ['sprout', 'sapling', 'young_cedar', 'cedar'];

const afail = (status, code, publicMessage) => {
  const e = new Error(publicMessage); e.status = status; e.code = code; e.publicMessage = publicMessage; throw e;
};

const str = (v, max = 200) => {
  const s = String(v == null ? '' : v).trim();
  return s.length && s.length <= max ? s : null;
};
const strList = (v, { max = 20, itemMax = 80 } = {}) => {
  if (!Array.isArray(v) || v.length > max) return null;
  const out = [];
  for (const item of v) {
    const s = str(item, itemMax);
    if (!s) return null;
    out.push(s);
  }
  return out;
};

// The user's own facts hang off their is_self person row (created by a DB
// trigger at signup). Its absence is abnormal and refuses the write.
async function getSelfPersonId(userId) {
  const { data, error } = await supabase
    .from('people').select('id').eq('user_id', userId).eq('is_self', true).maybeSingle();
  if (error) {
    logger.event('onboarding.answers.failed', {
      level: 'error', error_category: 'db_error', error_code: error.code || 'unknown',
      message: 'self-person read failed: ' + (error.message || String(error)),
    });
    afail(500, 'internal', 'could not load your profile');
  }
  if (!data) afail(500, 'no_self_person', 'your profile row is missing its self person');
  return data.id;
}

// One self-fact; supersedesPrior=true replaces the previous answer for the key.
async function selfFact({ userId, selfId, factType, factKey, factValue, supersede }) {
  await memory.addFact({
    userId, personId: selfId, factType, factKey, factValue,
    supersedesPrior: supersede, sourceMessageId: null, confidence: 1,
  });
}

// Multi-answer batch: first insert supersedes (retires the whole prior set for
// the key), the rest append — so the stored set is exactly the submitted set.
async function selfFactBatch({ userId, selfId, factType, factKey, values }) {
  let first = true;
  for (const factValue of values) {
    await selfFact({ userId, selfId, factType, factKey, factValue, supersede: first });
    first = false;
  }
  return values.length;
}

export async function saveAnswers({ userId, step, answers }) {
  if (!ONBOARDING_STEPS.includes(step)) {
    afail(400, 'bad_step', `step must be one of: ${ONBOARDING_STEPS.join(', ')}`);
  }
  const a = answers && typeof answers === 'object' ? answers : {};
  let factsSaved = 0;
  let peopleTouched = 0;

  const selfId = await getSelfPersonId(userId);

  if (step === 'work_setup') {
    const mode = str(a.mode, 80);
    if (!mode) afail(400, 'bad_answers', 'work_setup needs answers.mode (e.g. home, hybrid, cowork)');
    const detail = str(a.detail, 200);
    await selfFact({
      userId, selfId, factType: 'context', factKey: 'work_setup',
      factValue: detail ? `${mode} - ${detail}` : mode, supersede: true,
    });
    factsSaved = 1;
  }

  if (step === 'neighborhood') {
    const hood = str(a.neighborhood, 120);
    if (!hood) afail(400, 'bad_answers', 'neighborhood needs answers.neighborhood');
    await selfFact({ userId, selfId, factType: 'context', factKey: 'neighborhood', factValue: hood, supersede: true });
    factsSaved = 1;
  }

  if (step === 'free_windows') {
    const windows = strList(a.windows);
    if (!windows || !windows.length) afail(400, 'bad_answers', 'free_windows needs answers.windows (a list like ["tuesday afternoon"])');
    await selfFact({
      userId, selfId, factType: 'context', factKey: 'free_windows',
      factValue: windows.join(', '), supersede: true,
    });
    factsSaved = 1;
  }

  if (step === 'activities') {
    const acts = strList(a.activities);
    if (!acts || !acts.length) afail(400, 'bad_answers', 'activities needs answers.activities (a non-empty list)');
    factsSaved = await selfFactBatch({ userId, selfId, factType: 'interest', factKey: 'activity', values: acts });
  }

  if (step === 'current_groups') {
    const groups = strList(a.groups);
    if (!groups) afail(400, 'bad_answers', 'current_groups needs answers.groups (a list; may be empty)');
    // An empty list means "no groups" — nothing to write, prior answers stand.
    factsSaved = groups.length
      ? await selfFactBatch({ userId, selfId, factType: 'context', factKey: 'current_group', values: groups })
      : 0;
  }

  if (step === 'people') {
    const entries = Array.isArray(a.people) ? a.people : null;
    if (!entries || !entries.length || entries.length > 20) {
      afail(400, 'bad_answers', 'people needs answers.people (1–20 entries with a name each)');
    }
    for (const entry of entries) {
      const name = str(entry && entry.name, 80);
      if (!name) afail(400, 'bad_answers', 'every people entry needs a name');
      const relationship = str(entry && entry.relationship, 60);
      const stage = entry && entry.stage != null ? String(entry.stage).trim().toLowerCase() : null;
      if (stage && !FRIENDSHIP_STAGES.includes(stage)) {
        afail(400, 'bad_stage', `stage must be one of: ${FRIENDSHIP_STAGES.join(', ')}`);
      }

      // Reuse an existing person on a confident match (exact name/alias hit);
      // otherwise create. The full ask-first entity-resolution loop is an SMS
      // pipeline concern — a form submit must not open clarifications.
      const found = await people.fuzzyFind(userId, name);
      let personId;
      if (found && found.score === 1) {
        personId = found.id;
      } else {
        const created = await people.create(userId, { name, relationship });
        personId = created.id;
      }
      peopleTouched++;

      if (entry && entry.see_more !== false) {
        await memory.addFact({
          userId, personId, factType: 'preference', factKey: 'wants_more_time',
          factValue: 'yes', supersedesPrior: true, sourceMessageId: null, confidence: 1,
        });
        factsSaved++;
      }
      if (stage) {
        // Existing friendships import at the stage the user says (spec PART 3)
        // — recorded as a fact the garden build will read; no schema invented.
        await memory.addFact({
          userId, personId, factType: 'relationship_detail', factKey: 'friendship_stage',
          factValue: stage, supersedesPrior: true, sourceMessageId: null, confidence: 1,
        });
        factsSaved++;
      }
    }
  }

  if (step === 'social_prefs') {
    const mapping = [
      ['pace', 'social_pace', 80],
      ['group_size', 'social_group_size', 80],
      ['notes', 'social_notes', 300],
    ];
    for (const [inKey, factKey, max] of mapping) {
      const val = str(a[inKey], max);
      if (val) {
        await selfFact({ userId, selfId, factType: 'preference', factKey, factValue: val, supersede: true });
        factsSaved++;
      }
    }
    if (!factsSaved) afail(400, 'bad_answers', 'social_prefs needs at least one of: pace, group_size, notes');
  }

  logger.event('onboarding.answers.saved', {
    user_ref: 'u_' + userId, outcome: 'saved', count: factsSaved,
    message: `step=${step} facts=${factsSaved} people=${peopleTouched}`,
  });
  return { step, facts_saved: factsSaved, people_touched: peopleTouched };
}
