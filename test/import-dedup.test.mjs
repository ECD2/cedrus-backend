// NF2-IMPORT -- SERVICE-LAYER DEDUP + IDEMPOTENCY CORPUS (feat/import-hardening).
// Run: bun test/import-dedup.test.mjs   (or node)
//
// Exercises the DURABLE write guard confirmImport() and the batch builder with
// INJECTED deps -- no express, no mock.module, no network. The two seams
// (people fns, supabase) are plain fakes; the fake supabase query-builder is
// reused from test/web-fakes.mjs so the real confirm code runs unmodified.
//
// Focus (from the night brief + docs/EXTRACTION_AUDIT.md):
//   * D5 -- the dedup/single-valued guard keyed off the RAW stored fact_key,
//     so a LEGACY row under a non-canonical key (e.g. 'employer' -> canonical
//     'job') was invisible to it: an import could add a duplicate 'job' row
//     (idempotency miss) or fork a single-valued slot. This corpus asserts the
//     FIXED behavior (stored keys canonicalized at the read site).
//   * idempotent re-import -- an identical current fact is always a skip.
//   * duplicate-conversation dedup -- buildBatches collapses identical /
//     whitespace-only-different messages so a re-pasted conversation neither
//     wastes token budget nor double-proposes.

import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'sk-test-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

const { makeFakeSupabase } = await import('./web-fakes.mjs');
const { createImportStore } = await import('../src/services/importJobs.js');
const { confirmImport, buildBatches } = await import('../src/services/chatImport.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log('  PASS  ' + name);
  else { failures++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail).slice(0, 300) : '')); }
};
const uid = () => crypto.randomUUID();

// ── Injected-dep harness ────────────────────────────────────────────────────
// Build a fresh world (db + store + a ready job) and the deps confirmImport
// needs. People fns are trivial fakes scoped by user_id (the ownership guard).
function world({ people = [], facts = [] } = {}) {
  const db = { messages: [], facts: [...facts], people: [...people],
    saved_items: [], reminders: [], user_goals: [], contact_events: [],
    message_people: [], pending_prompts: [], nudges: [], agent_runs: [] };
  const supa = makeFakeSupabase({ db, tokens: {} });
  const store = createImportStore();
  const deps = {
    store,
    db: supa,
    listForUser: async (userId) => db.people.filter((p) => p.user_id === userId),
    fuzzyFind: async () => null,
    createPerson: async (userId, { name, relationship }) => {
      const row = { id: uid(), user_id: userId, name, relationship: relationship || null };
      db.people.push(row);
      return row;
    },
  };
  return { db, store, deps };
}

function seedReadyJob(store, { userId, format = 'chatgpt', groups }) {
  const now = Date.now();
  const job = {
    id: uid(), userId, digest: 'seed-' + uid(), format, status: 'ready',
    createdAt: now, expiresAt: now + store.ttlMs,
    progress: { batches_done: 1, batches_total: 1 },
    counts: {}, proposals: { people: groups }, results: null, error: null,
  };
  store.put(job);
  return job;
}

const fact = (fact_key, fact_value, extra = {}) => ({
  id: uid(), fact_type: 'preference', fact_key, fact_value, confidence: 0.8,
  theme: 'relationships', already_known: false, evidence: null, ...extra,
});
const group = (person, facts) => ({
  key: `p:${person.id}`, person_id: person.id, name: person.name,
  relationship: person.relationship || null, matched_existing: true,
  mention_count: 1, facts,
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\n-- D5: dedup + single-valued guard must see through legacy non-canonical keys --');
{
  const userId = uid();
  const p = { id: uid(), user_id: userId, name: 'Sam', relationship: 'friend' };
  // LEGACY row stored under a non-canonical key: canonicalFactKey('employer')
  // === 'job', and 'job' is single-valued.
  const legacy = { id: uid(), user_id: userId, person_id: p.id, fact_type: 'preference',
    fact_key: 'employer', fact_value: 'Stripe', is_current: true, source: 'stated' };
  const { db, store, deps } = world({ people: [p], facts: [legacy] });

  // Import proposes two canonical 'job' facts for Sam:
  //   - job=Stripe  (SAME value as the legacy employer row -> must be an
  //     idempotent skip, not a duplicate)
  //   - job=Google  (DIFFERENT value on a single-valued slot that already has
  //     a current value -> historical never clobbers present -> skip)
  const job = seedReadyJob(store, { userId, groups: [
    group(p, [fact('job', 'Stripe'), fact('job', 'Google')]),
  ] });

  const res = await confirmImport({ user: { id: userId }, importId: job.id, accept: { all: true } }, deps);
  const jobRows = db.facts.filter((f) => f.person_id === p.id && f.fact_key === 'job');
  const workRows = db.facts.filter((f) => f.person_id === p.id); // employer + any job

  check('confirm succeeded', res && res.confirmed === true, res);
  check('D5: no duplicate/forked "job" row written for a legacy "employer" holder',
    jobRows.length === 0, { jobRows: jobRows.map((f) => f.fact_value) });
  check('D5: both proposed facts skipped (idempotent + single-valued)',
    res.results.facts_saved === 0 && res.results.facts_skipped === 2, res.results);
  check('D5: person keeps exactly the one legacy work row (no fork)',
    workRows.length === 1 && workRows[0].fact_value === 'Stripe', workRows.map((f) => f.fact_value));
}

console.log('\n-- guard does NOT over-skip: a genuinely new fact still writes --');
{
  const userId = uid();
  const p = { id: uid(), user_id: userId, name: 'Kai' };
  const { db, store, deps } = world({ people: [p], facts: [] });
  const job = seedReadyJob(store, { userId, groups: [
    group(p, [fact('coffee', 'flat whites'), fact('music', 'loves jazz')]),
  ] });
  const res = await confirmImport({ user: { id: userId }, importId: job.id, accept: { all: true } }, deps);
  check('new facts on empty slots are written, not skipped',
    res.results.facts_saved === 2 && res.results.facts_skipped === 0, res.results);
  check('written with source=imported provenance',
    db.facts.filter((f) => f.source === 'imported').length === 2);
}

console.log('\n-- idempotent re-import: an identical current fact is always a skip --');
{
  const userId = uid();
  const p = { id: uid(), user_id: userId, name: 'Noor' };
  // Already-canonical current row.
  const existing = { id: uid(), user_id: userId, person_id: p.id, fact_type: 'preference',
    fact_key: 'coffee', fact_value: 'Flat Whites', is_current: true, source: 'imported' };
  const { db, store, deps } = world({ people: [p], facts: [existing] });
  // Re-import proposes the same fact (case-insensitively equal value).
  const job = seedReadyJob(store, { userId, groups: [group(p, [fact('coffee', 'flat whites')])] });
  const res = await confirmImport({ user: { id: userId }, importId: job.id, accept: { all: true } }, deps);
  check('re-importing the same fact writes nothing (case-insensitive idempotency)',
    res.results.facts_saved === 0 && res.results.facts_skipped === 1, res.results);
  check('facts table still holds exactly one coffee row',
    db.facts.filter((f) => f.person_id === p.id && f.fact_key === 'coffee').length === 1);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n-- buildBatches: duplicate / near-duplicate conversations are collapsed --');
{
  // A re-pasted conversation: the same high-signal message three times, plus
  // two whitespace-only variants of it. All should collapse to ONE considered
  // message so a duplicated export neither wastes budget nor double-proposes.
  const msg = 'My sister Ana loves jazz and her birthday is March 4';
  const dupes = [msg, msg, msg, '  ' + msg + '  ', msg.replace(/ /g, '  ')];
  const out = buildBatches(dupes, {});
  check('identical + whitespace-variant messages dedup to a single considered message',
    out.consideredMessages === 1, { consideredMessages: out.consideredMessages });
  check('the surviving batch contains the message exactly once',
    (out.batches.join('\n').match(/loves jazz/g) || []).length === 1, out.batches);
}

console.log('\n-- buildBatches: genuinely distinct messages are all kept --');
{
  const distinct = [
    'My sister Ana loves jazz',
    'My buddy Mike is into fountain pens',
    'We visit grandma every Sunday',
  ];
  const out = buildBatches(distinct, {});
  check('distinct messages are not collapsed', out.consideredMessages === 3, { considered: out.consideredMessages });
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nIMPORT DEDUP + IDEMPOTENCY SUITE PASSED');
process.exit(failures ? 1 : 0);
