// N3 — Web API suite: capture propose/confirm, priority swap, restore.
// Run: bun test/web-api.test.mjs
//
// What runs REAL here: the express router + auth middleware exactly as
// production wires them (createApiRouter() with default deps), the three N3
// services, and the shared pipeline stages the capture path calls —
// messages.buildContext, understand() (safety gate + voice guard included),
// resolveEntities(), persist(), and the people/memory/relationships/usage
// services beneath them. Only two seams are faked, via bun's mock.module:
// the Supabase client (in-memory tables + a faithful set_priority_people
// mirror) and the OpenAI client (canned extractions).
//
// Spec coverage (night brief N3, item 5):
//   • JWT required on every route; forged/absent JWT rejected
//   • user A cannot capture into, swap, restore, or list user B's data
//   • capture without confirm writes nothing durable
//   • sixth priority person rejected with the friendly message
//   • restore round-trips

import crypto from 'node:crypto';
import { mock } from 'bun:test';

// ── Env BEFORE any src import: config.js fail-closed-requires these. Dummy
// values only — every network seam is faked, nothing can reach a real host.
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'sk-test-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

import { makeFakeSupabase, makeFakeOpenai, extraction } from './web-fakes.mjs';

// ── Seed data ───────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID();
const uA = uid(), uB = uid();
const A = { self: uid(), ana: uid(), ben: uid(), cara: uid(), dev: uid(), eli: uid(), fay: uid(), grandpa: uid() };
const B = { self: uid(), zoe: uid(), xander: uid() };

const person = (id, user_id, name, extra = {}) => ({
  id, user_id, name, aliases: [], relationship: null, is_self: false,
  is_archived: false, archived_at: null, archived_reason: null,
  is_core_five: false, core_five_source: null, last_nudged_at: null,
  created_at: new Date().toISOString(), ...extra,
});

const db = {
  app_users: [
    { id: uA, auth_user_id: 'auth-a', name: 'Alba', phone: '15551110001', timezone: 'America/New_York', plan: 'trialing', onboarding_complete: true },
    { id: uB, auth_user_id: 'auth-b', name: 'Bram', phone: '15551110002', timezone: 'America/New_York', plan: 'trialing', onboarding_complete: true },
  ],
  v_message_quota: [
    { user_id: uA, daily_limit: 30, inbound_last_24h: 0 },
    { user_id: uB, daily_limit: 30, inbound_last_24h: 0 },
  ],
  people: [
    person(A.self, uA, 'Alba', { is_self: true }),
    person(A.ana, uA, 'Ana'), person(A.ben, uA, 'Ben'), person(A.cara, uA, 'Cara'),
    person(A.dev, uA, 'Dev'), person(A.eli, uA, 'Eli'), person(A.fay, uA, 'Fay'),
    person(A.grandpa, uA, 'Grandpa Joe', {
      is_archived: true, archived_at: '2026-07-18T20:00:00.000Z', archived_reason: 'user_archived',
    }),
    person(B.self, uB, 'Bram', { is_self: true }),
    person(B.zoe, uB, 'Zoe'),
    person(B.xander, uB, 'Xander', {
      is_archived: true, archived_at: '2026-07-17T10:00:00.000Z', archived_reason: 'user_archived',
    }),
  ],
  messages: [], facts: [], saved_items: [], reminders: [], user_goals: [],
  contact_events: [], message_people: [], agent_runs: [], pending_prompts: [], nudges: [],
};

const TOKENS = { 'tok-a': 'auth-a', 'tok-b': 'auth-b', 'tok-unlinked': 'auth-nobody' };

const fakeSupabase = makeFakeSupabase({ db, tokens: TOKENS });
const fakeOpenai = makeFakeOpenai();

// The two seams. Registered before anything imports src/, so every real
// module (services, pipeline stages, auth middleware) gets the fakes.
mock.module('../src/lib/supabase.js', () => ({ supabase: fakeSupabase }));
mock.module('../src/lib/openai.js', () => ({ openai: fakeOpenai }));

const express = (await import('express')).default;
const { createApiRouter } = await import('../src/routes/api/index.js');
const captureSvc = await import('../src/services/capture.js');
const swapSvc = await import('../src/services/prioritySwap.js');
const restoreSvc = await import('../src/services/restore.js');

// ── Harness ─────────────────────────────────────────────────────────────────
let failures = 0;
const p = (...a) => console.log(...a);
function check(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail ? '  -- ' + JSON.stringify(detail) : '')); }
}

// Production wiring: default deps, fakes arrive via the mocked lib modules.
const app = express();
app.use(express.json({ limit: '100kb' })); // mirror index.js's app-wide parser
app.use('/api', createApiRouter());
const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;

async function call(path, { method = 'GET', token, body, rawAuth } = {}) {
  const headers = {};
  if (rawAuth) headers.authorization = rawAuth;
  else if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// Durability probe: row counts across every product-memory table. propose
// must not move ANY of these; app_users (safety cooldown) is deliberately
// not product memory (cf. routes/admin.js RESET_TABLES).
const PRODUCT_TABLES = ['messages', 'facts', 'saved_items', 'reminders', 'user_goals',
  'contact_events', 'message_people', 'agent_runs', 'pending_prompts', 'nudges', 'people'];
const snapshot = () => Object.fromEntries(PRODUCT_TABLES.map((t) => [t, db[t].length]));
const sameCounts = (a, b) => PRODUCT_TABLES.every((t) => a[t] === b[t]);
const rowsOf = (uidWanted) => JSON.stringify(db.people.filter((r) => r.user_id === uidWanted));

// ════════════════════════════════════════════════════════════════════════════
p('\n── 1. Auth: JWT required on every route ──');
{
  const routes = [
    ['POST', '/capture', { text: 'hola' }],
    ['POST', '/capture/confirm', { proposal_id: uid() }],
    ['POST', '/priority/swap', { person_ids: [] }],
    ['POST', `/people/${A.ana}/restore`, undefined],
    ['GET', '/people/archived', undefined],
  ];
  for (const [method, path, body] of routes) {
    const bare = await call(path, { method, body });
    check(`absent JWT → 401  ${method} ${path}`, bare.status === 401 && bare.json?.error === 'auth_required', bare);
    const forged = await call(path, { method, body, token: 'forged-token-123' });
    check(`forged JWT → 401  ${method} ${path}`, forged.status === 401 && forged.json?.error === 'auth_required', forged);
  }
  const badScheme = await call('/people/archived', { rawAuth: 'Basic dXNlcjpwYXNz' });
  check('non-Bearer scheme → 401', badScheme.status === 401, badScheme);
  const unlinked = await call('/people/archived', { token: 'tok-unlinked' });
  check('valid session, no linked account → 403', unlinked.status === 403 && unlinked.json?.error === 'no_linked_account', unlinked);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 2. Capture: propose writes nothing durable; confirm commits ──');
let confirmedMessageId = null;
{
  fakeOpenai.queue.push(extraction({
    people: [{ mention_text: 'rio', resolution: 'new', proposed_name: 'Rio',
      proposed_relationship: 'friend', contact_signal: 'explicit_contact',
      sentiment: 'positive', confidence: 0.85 }],
    facts: [{ person_ref: 'rio', fact_type: 'interest', fact_key: 'hobby',
      fact_value: 'film photography', supersedes_prior: false, confidence: 0.85 }],
    reply: 'Rio, run club, film photography. Saved once you confirm.',
  }));

  const before = snapshot();
  const prop = await call('/capture', { method: 'POST', token: 'tok-a',
    body: { text: 'met a guy called Rio at the run club, he is into film photography' } });
  check('propose → 200', prop.status === 200, prop);
  check('propose → safety:false + proposal id', prop.json?.safety === false && !!prop.json?.proposal?.id, prop.json);
  check('propose echoes extraction', prop.json?.proposal?.people?.[0]?.proposed_name === 'Rio'
    && prop.json?.proposal?.facts?.[0]?.fact_value === 'film photography', prop.json?.proposal);
  check('propose echo has no underscore internals',
    JSON.stringify(prop.json).indexOf('"_') === -1, null);
  check('propose wrote NOTHING durable', sameCounts(before, snapshot()), snapshot());

  const conf = await call('/capture/confirm', { method: 'POST', token: 'tok-a',
    body: { proposal_id: prop.json.proposal.id } });
  check('confirm → 200 confirmed', conf.status === 200 && conf.json?.confirmed === true, conf);
  confirmedMessageId = conf.json?.message_id;

  const msg = db.messages.find((m) => m.id === confirmedMessageId);
  check('confirm wrote the web message row', !!msg && msg.channel === 'web'
    && msg.provider === 'web' && msg.user_id === uA && msg.direction === 'inbound', msg);
  const run = db.agent_runs.find((r) => r.trigger_message_id === confirmedMessageId);
  check('confirm wrote the agent_runs audit row', !!run && run.run_type === 'web_capture'
    && run.user_id === uA && run.model === 'gpt-fake', run);
  const rio = db.people.find((x) => x.user_id === uA && x.name === 'Rio');
  check('confirm created the new person under user A', !!rio && rio.is_self === false, rio);
  const fact = db.facts.find((f) => f.person_id === rio?.id);
  check('confirm wrote the fact to that person', !!fact && fact.user_id === uA
    && fact.fact_value === 'film photography' && fact.is_current === true, fact);
  const link = db.message_people.find((l) => l.message_id === confirmedMessageId);
  check('confirm linked message↔person', !!link && link.person_id === rio?.id && link.user_id === uA, link);
  const contact = db.contact_events.find((c) => c.person_id === rio?.id);
  check('confirm logged the contact event', !!contact && contact.user_id === uA, contact);

  const again = await call('/capture/confirm', { method: 'POST', token: 'tok-a',
    body: { proposal_id: prop.json.proposal.id } });
  check('proposals are single-use → second confirm 404', again.status === 404 && again.json?.error === 'not_found', again);
  const unknown = await call('/capture/confirm', { method: 'POST', token: 'tok-a',
    body: { proposal_id: uid() } });
  check('unknown proposal id → 404', unknown.status === 404, unknown);
  const emptyText = await call('/capture', { method: 'POST', token: 'tok-a', body: { text: '   ' } });
  check('empty text → 422 invalid_request', emptyText.status === 422 && emptyText.json?.error === 'invalid_request', emptyText);
  const tooLong = await call('/capture', { method: 'POST', token: 'tok-a', body: { text: 'x'.repeat(2001) } });
  check('over-length text → 422 invalid_request', tooLong.status === 422 && tooLong.json?.error === 'invalid_request', tooLong);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 3. Capture: user A cannot capture into user B\'s data ──');
{
  // The model hallucinates B's person id as an 'existing' resolution. The
  // scrub must strip it before the proposal is stored OR echoed.
  fakeOpenai.queue.push(extraction({
    people: [{ mention_text: 'zoe', resolution: 'existing', person_id: B.zoe,
      contact_signal: 'none', sentiment: null, confidence: 0.9 }],
    facts: [{ person_ref: 'zoe', fact_type: 'note', fact_key: 'note',
      fact_value: 'moved to lisbon', supersedes_prior: false, confidence: 0.9 }],
    reply: 'Zoe moved to Lisbon, noted.',
  }));
  const bPeopleBefore = rowsOf(uB);
  const prop = await call('/capture', { method: 'POST', token: 'tok-a',
    body: { text: 'zoe moved to lisbon' } });
  const echoed = prop.json?.proposal?.people?.[0];
  check('foreign person_id scrubbed from the echo', echoed
    && echoed.person_id === undefined && echoed.resolution === 'new', echoed);

  const conf = await call('/capture/confirm', { method: 'POST', token: 'tok-a',
    body: { proposal_id: prop.json.proposal.id } });
  check('confirm still succeeds (within A\'s space)', conf.status === 200, conf);
  check('user B\'s people rows are byte-identical', rowsOf(uB) === bPeopleBefore, null);
  const zoeA = db.people.find((x) => x.user_id === uA && x.name === 'zoe');
  check('the mention landed as A\'s OWN new person', !!zoeA && zoeA.id !== B.zoe, zoeA);
  const fact = db.facts.find((f) => f.fact_value === 'moved to lisbon');
  check('the fact is bound to A\'s person, not B\'s', !!fact && fact.user_id === uA && fact.person_id === zoeA?.id, fact);
  check('no fact/link ever pointed at B\'s person',
    !db.facts.some((f) => f.person_id === B.zoe) && !db.message_people.some((l) => l.person_id === B.zoe), null);

  // A's held proposal cannot be confirmed by B.
  fakeOpenai.queue.push(extraction({
    facts: [{ person_ref: 'ana', fact_type: 'note', fact_key: 'note', fact_value: 'loves jazz records', confidence: 0.8 }],
    people: [{ mention_text: 'ana', resolution: 'existing', person_id: A.ana, contact_signal: 'none', confidence: 0.9 }],
    reply: 'Ana and her jazz records, noted.',
  }));
  const propA = await call('/capture', { method: 'POST', token: 'tok-a', body: { text: 'ana loves jazz records' } });
  const bBefore = snapshot();
  const confB = await call('/capture/confirm', { method: 'POST', token: 'tok-b',
    body: { proposal_id: propA.json.proposal.id } });
  check('B confirming A\'s proposal → 404', confB.status === 404, confB);
  check('B\'s attempt wrote nothing', sameCounts(bBefore, snapshot()), null);
  const confA = await call('/capture/confirm', { method: 'POST', token: 'tok-a',
    body: { proposal_id: propA.json.proposal.id } });
  check('A\'s proposal survives B\'s attempt and confirms fine', confA.status === 200, confA);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 4. Capture: quota, expiry, pending cap ──');
{
  const quotaRow = db.v_message_quota.find((q) => q.user_id === uA);
  quotaRow.inbound_last_24h = quotaRow.daily_limit;
  const prop = await call('/capture', { method: 'POST', token: 'tok-a', body: { text: 'over the line' } });
  check('quota spent → 429 quota_exceeded', prop.status === 429 && prop.json?.error === 'quota_exceeded', prop);
  check('quota copy is the SMS rate-limit copy verbatim', prop.json?.message === captureSvc.MSG_QUOTA, prop.json);
  quotaRow.inbound_last_24h = 0;

  // Service level (real service code, tiny injected stages): TTL expiry.
  const user = db.app_users.find((u) => u.id === uA);
  const stageFakes = {
    checkRateLimit: async () => ({ allowed: true }),
    buildContext: async () => ({ people: [], openPrompts: [], recentMessages: [] }),
    understand: async () => extraction({ reply: 'ok', _model: 'stub', _usage: {} }),
    listForUser: async () => [],
  };
  const deadStore = captureSvc.createProposalStore({ ttlMs: -1 });
  const dead = await captureSvc.proposeCapture({ user, text: 'expiring thought' }, { ...stageFakes, store: deadStore });
  let expiredThrew = null;
  try { await captureSvc.confirmCapture({ user, proposalId: dead.proposal.id }, { store: deadStore }); }
  catch (e) { expiredThrew = e; }
  check('expired proposal → 404 on confirm', expiredThrew?.status === 404, expiredThrew?.message);

  const smallStore = captureSvc.createProposalStore({ maxPerUser: 2 });
  const p1 = await captureSvc.proposeCapture({ user, text: 'one' }, { ...stageFakes, store: smallStore });
  await captureSvc.proposeCapture({ user, text: 'two' }, { ...stageFakes, store: smallStore });
  await captureSvc.proposeCapture({ user, text: 'three' }, { ...stageFakes, store: smallStore });
  check('pending cap evicts oldest-first', smallStore.size() === 2, smallStore.size());
  let evictedThrew = null;
  try { await captureSvc.confirmCapture({ user, proposalId: p1.proposal.id }, { store: smallStore }); }
  catch (e) { evictedThrew = e; }
  check('evicted proposal → 404 on confirm', evictedThrew?.status === 404, evictedThrew?.message);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 5. Capture: crisis turn proposes nothing, stores nothing ──');
{
  const before = snapshot();
  const prop = await call('/capture', { method: 'POST', token: 'tok-a',
    body: { text: 'I want to kill myself' } });
  check('crisis → 200 with safety:true', prop.status === 200 && prop.json?.safety === true, prop);
  check('crisis → no proposal to confirm', prop.json?.proposal === null, prop.json);
  check('crisis reply is the fixed template (concrete resource)', /988/.test(prop.json?.reply || ''), prop.json?.reply);
  check('crisis wrote nothing durable', sameCounts(before, snapshot()), null);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 6. Priority swap: own list only, max five, friendly sixth ──');
{
  const five = [A.ana, A.ben, A.cara, A.dev, A.eli];
  const ok = await call('/priority/swap', { method: 'POST', token: 'tok-a', body: { person_ids: five } });
  check('pick five → 200, priority_count 5', ok.status === 200 && ok.json?.priority_count === 5, ok.json);
  check('all five flagged manual', five.every((id) => {
    const r = db.people.find((x) => x.id === id);
    return r.is_core_five === true && r.core_five_source === 'manual';
  }), null);
  check('response echoes the five', ok.json?.priority_people?.length === 5, ok.json?.priority_people);

  const flagsBefore = rowsOf(uA);
  const sixth = await call('/priority/swap', { method: 'POST', token: 'tok-a',
    body: { person_ids: [...five, A.fay] } });
  check('sixth person → 422 priority_limit_reached', sixth.status === 422
    && sixth.json?.error === 'priority_limit_reached', sixth);
  check('sixth person gets the friendly message, verbatim',
    sixth.json?.message === swapSvc.MSG_PRIORITY_LIMIT, sixth.json?.message);
  check('rejected sixth changed no flags', rowsOf(uA) === flagsBefore, null);

  const foreign = await call('/priority/swap', { method: 'POST', token: 'tok-a',
    body: { person_ids: [A.ana, B.zoe] } });
  check('B\'s person in A\'s list → 422 not_selectable', foreign.status === 422
    && foreign.json?.error === 'not_selectable', foreign);
  check('foreign attempt changed neither tenant', rowsOf(uA) === flagsBefore
    && db.people.find((x) => x.id === B.zoe).is_core_five === false, null);

  const archived = await call('/priority/swap', { method: 'POST', token: 'tok-a',
    body: { person_ids: [A.grandpa] } });
  check('archived person → 422 not_selectable', archived.status === 422
    && archived.json?.error === 'not_selectable', archived);

  const selfTry = await call('/priority/swap', { method: 'POST', token: 'tok-a',
    body: { person_ids: [A.self] } });
  check('self person → 422 not_selectable', selfTry.status === 422
    && selfTry.json?.error === 'not_selectable', selfTry);

  const replace = await call('/priority/swap', { method: 'POST', token: 'tok-a',
    body: { person_ids: [A.fay] } });
  check('full-set replace → count 1, added 1, removed 5', replace.status === 200
    && replace.json?.priority_count === 1 && replace.json?.added === 1 && replace.json?.removed === 5, replace.json);
  check('only Fay is flagged now', db.people.filter((x) => x.user_id === uA && x.is_core_five).length === 1
    && db.people.find((x) => x.id === A.fay).is_core_five === true, null);

  const dupes = await call('/priority/swap', { method: 'POST', token: 'tok-a',
    body: { person_ids: [A.ana, A.ana, A.ben, A.ben, A.cara, A.cara] } });
  check('six entries but three unique → 200, count 3', dupes.status === 200
    && dupes.json?.priority_count === 3, dupes.json);

  const cleared = await call('/priority/swap', { method: 'POST', token: 'tok-a', body: { person_ids: [] } });
  check('empty set clears the selection', cleared.status === 200
    && db.people.filter((x) => x.user_id === uA && x.is_core_five).length === 0, cleared.json);

  const malformed = await call('/priority/swap', { method: 'POST', token: 'tok-a',
    body: { person_ids: ['not-a-uuid'] } });
  check('malformed id → 422 invalid_request', malformed.status === 422
    && malformed.json?.error === 'invalid_request', malformed);

  const aBefore = rowsOf(uA);
  const bSwap = await call('/priority/swap', { method: 'POST', token: 'tok-b', body: { person_ids: [B.zoe] } });
  check('B swaps B\'s own list fine', bSwap.status === 200 && bSwap.json?.priority_count === 1, bSwap.json);
  check('B\'s swap left A untouched', rowsOf(uA) === aBefore, null);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 7. Restore: round-trip, ownership, archived list ──');
{
  const listA = await call('/people/archived', { token: 'tok-a' });
  check('archived list shows A\'s archived person', listA.status === 200
    && listA.json?.people?.length === 1 && listA.json.people[0].id === A.grandpa
    && !!listA.json.people[0].archived_at, listA.json);
  check('archived list never shows B\'s people',
    !listA.json.people.some((x) => x.id === B.xander), null);

  const stealB = await call(`/people/${A.grandpa}/restore`, { method: 'POST', token: 'tok-b' });
  check('B restoring A\'s person → 404', stealB.status === 404 && stealB.json?.error === 'not_found', stealB);
  check('A\'s person is still archived after B\'s attempt',
    db.people.find((x) => x.id === A.grandpa).is_archived === true, null);

  const res = await call(`/people/${A.grandpa}/restore`, { method: 'POST', token: 'tok-a' });
  check('owner restore → 200', res.status === 200 && res.json?.restored === true, res);
  const row = db.people.find((x) => x.id === A.grandpa);
  check('restore cleared all three archive fields', row.is_archived === false
    && row.archived_at === null && row.archived_reason === null, row);

  const listAfter = await call('/people/archived', { token: 'tok-a' });
  check('round-trip: archived list is now empty', listAfter.json?.people?.length === 0, listAfter.json);

  const again = await call(`/people/${A.grandpa}/restore`, { method: 'POST', token: 'tok-a' });
  check('restore is idempotent (second call 200)', again.status === 200, again);

  const ghost = await call(`/people/${uid()}/restore`, { method: 'POST', token: 'tok-a' });
  check('unknown person id → 404', ghost.status === 404, ghost);
  const mangled = await call('/people/definitely-not-a-uuid/restore', { method: 'POST', token: 'tok-a' });
  check('malformed person id → 404 (no 500 leak)', mangled.status === 404, mangled);

  const pin = await call('/priority/swap', { method: 'POST', token: 'tok-a', body: { person_ids: [A.grandpa] } });
  check('full promise round-trip: restored person is pinnable again',
    pin.status === 200 && db.people.find((x) => x.id === A.grandpa).is_core_five === true, pin.json);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 8. Voice: user-facing copy obeys the spec ──');
{
  const COPY = [
    captureSvc.MSG_QUOTA, captureSvc.MSG_PROPOSAL_GONE, captureSvc.MSG_EMPTY_TEXT,
    swapSvc.MSG_PRIORITY_LIMIT, swapSvc.MSG_NOT_SELECTABLE, swapSvc.MSG_BAD_IDS,
    restoreSvc.MSG_PERSON_NOT_FOUND,
  ];
  check('no em dashes anywhere in API copy', COPY.every((s) => !s.includes('—')), COPY.filter((s) => s.includes('—')));
  check('no exclamation marks in API copy', COPY.every((s) => !s.includes('!')), COPY.filter((s) => s.includes('!')));
  check('sixth-person copy keeps the product promise ("stays remembered", "swap anytime")',
    /stays remembered/.test(swapSvc.MSG_PRIORITY_LIMIT) && /swap anytime/i.test(swapSvc.MSG_PRIORITY_LIMIT), null);
}

// ════════════════════════════════════════════════════════════════════════════
server.close();
p('');
if (failures === 0) p('ALL WEB-API TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
