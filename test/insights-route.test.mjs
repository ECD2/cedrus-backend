// INFRA-10 — Insights API route suite: auth wall, feed shape, entitlement
// tags passed through (not enforced), query validation, per-person read, and
// cross-tenant isolation. Run: bun test/insights-route.test.mjs
//
// What runs REAL here: the express router + auth middleware exactly as
// production wires them (createInsightsRouter) and the insight engine's read
// layer (getInsightsForUser / getInsightsForPerson + the pure computeInsights
// core). Two seams are controlled:
//   • the Supabase client — faked via bun's mock.module (auth: app_users +
//     token map from test/web-fakes.mjs), so requireUser runs unmodified.
//   • the engine's gather — injected via deps.insights, so the five reads
//     return deterministic, CLOCK-INDEPENDENT fixtures. Only recency
//     (days_since_contact, a number) and open_goal (no date) are used — no
//     date-window signal — so the suite is reproducible without a fixed
//     clock (the route deliberately does not accept `now`).
//
// Spec coverage (INFRA-10):
//   • JWT required on every route; absent / forged / non-Bearer / unlinked
//     JWT rejected (401 / 401 / 401 / 403)
//   • feed shape { generatedAt, viewerTier, insights }; viewerTier is the
//     token user's OWN plan (free vs pro), never body-derived
//   • entitlement is PASSED THROUGH, NOT ENFORCED: a free viewer still
//     receives gated (Pro) insights, each carrying entitlement/gated
//   • limit caps the feed; perPerson expands per-person; both validate
//     (non-int / out-of-range / repeated param → 422 invalid_request)
//   • per-person read returns all of that person's ranked insights
//   • cross-tenant: A cannot read B's person insights (gather is user-scoped)

import crypto from 'node:crypto';
import { mock } from 'bun:test';

// Env BEFORE any src import (config.js fail-closed-requires these). Dummy
// values only — the Supabase seam is faked; nothing reaches a real host.
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'sk-test-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

import { makeFakeSupabase } from './web-fakes.mjs';

const uid = () => crypto.randomUUID();
const uA = uid(), uB = uid();
const pA1 = uid(), pA2 = uid(), pB1 = uid();
const SELF_A = 'self-a';

// ── app_users (the ONLY table the auth seam reads) ───────────────────────────
const db = {
  app_users: [
    { id: uA, auth_user_id: 'auth-a', name: 'Alba', timezone: 'America/New_York', plan: 'free', billing_status: null },
    { id: uB, auth_user_id: 'auth-b', name: 'Bram', timezone: 'America/New_York', plan: 'pro', billing_status: 'active' },
  ],
};
const TOKENS = { 'tok-a': 'auth-a', 'tok-b': 'auth-b', 'tok-unlinked': 'auth-nobody' };
const fakeSupabase = makeFakeSupabase({ db, tokens: TOKENS });

// The one seam. Registered before anything imports src/, so the real auth
// middleware (and the engine's own supabase import) gets the fake.
mock.module('../src/lib/supabase.js', () => ({ supabase: fakeSupabase }));

// ── Injected engine gather: deterministic + clock-independent ────────────────
// Keyed by the token-derived user id → also proves user-scoping. Only recency
// (days_since_contact vs the ring threshold: core 14, regular 30) and open_goal
// (dateless) are exercised, so nothing depends on the real wall clock the route
// passes to the engine.
const CONTEXT = {
  [uA]: [
    { person_id: SELF_A, name: 'Me', is_self: true },
    { person_id: pA1, name: 'Ana', is_core_five: true, relationship_health_score: null, days_since_contact: 40, current_facts: [], active_saved_items: [] },
    { person_id: pA2, name: 'Ben', is_core_five: false, relationship_health_score: null, days_since_contact: 40, current_facts: [], active_saved_items: [] },
  ],
  [uB]: [
    { person_id: 'self-b', name: 'Me', is_self: true },
    { person_id: pB1, name: 'Cara', is_core_five: false, relationship_health_score: null, days_since_contact: 50, current_facts: [], active_saved_items: [] },
  ],
};
const GOALS = {
  [uA]: [{ id: 'g1', person_id: pA1, goal_text: 'grab coffee with Ana' }],
  [uB]: [],
};
const gather = {
  getAgentContext: async (userId) => CONTEXT[userId] || [],
  getBirthdays: async () => [],
  getOpenGoals: async (userId) => GOALS[userId] || [],
  getOpenReminders: async () => [],
  getOpenPrompts: async () => [],
};

const express = (await import('express')).default;
const { createInsightsRouter } = await import('../src/routes/api/insights.js');

// ── Harness ──────────────────────────────────────────────────────────────────
let failures = 0;
const p = (...a) => console.log(...a);
function check(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}

// Production wiring: default-shaped deps; the fake supabase arrives via the
// mocked lib module, and the gather is injected (as production would inject
// the real Supabase-backed reads).
const app = express();
app.use(express.json({ limit: '100kb' })); // mirror index.js's app-wide parser
app.use('/api/insights', createInsightsRouter({ insights: gather }));
const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api/insights`;

async function call(path, { token, rawAuth } = {}) {
  const headers = {};
  if (rawAuth) headers.authorization = rawAuth;
  else if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const typesOf = (arr, pid) => (arr || []).filter((i) => i.personId === pid).map((i) => i.type);

// ════════════════════════════════════════════════════════════════════════════
p('── 1. Auth wall: fail closed on every route ──');
{
  for (const path of ['', '/', `/person/${pA1}`]) {
    const r = await call(path);
    check(`GET ${path || '(mount root)'} without header → 401 auth_required`,
      r.status === 401 && r.json.error === 'auth_required', r);
  }
  const forged = await call('/', { token: 'tok-forged' });
  check('forged token → 401', forged.status === 401 && forged.json.error === 'auth_required', forged);
  const badScheme = await call('/', { rawAuth: 'Basic abc' });
  check('non-Bearer scheme → 401', badScheme.status === 401, badScheme);
  const unlinked = await call('/', { token: 'tok-unlinked' });
  check('valid token, no linked account → 403 no_linked_account',
    unlinked.status === 403 && unlinked.json.error === 'no_linked_account', unlinked);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 2. Feed: shape + deterministic scoping to the token user ──');
{
  const a = await call('/', { token: 'tok-a' });
  check('200 with { generatedAt, viewerTier, insights }',
    a.status === 200 && typeof a.json.generatedAt === 'string'
    && typeof a.json.viewerTier === 'string' && Array.isArray(a.json.insights), a.json);
  check('viewerTier reflects the FREE token user', a.json.viewerTier === 'free', a.json.viewerTier);
  const ids = a.json.insights.map((i) => i.personId).sort();
  check('feed is exactly the token user’s people (one reason each, self excluded)',
    a.json.insights.length === 2 && ids.join(',') === [pA1, pA2].sort().join(','), ids);
  check('self is never in the feed', !a.json.insights.some((i) => i.personId === SELF_A), ids);
  check('every feed item carries entitlement + gated + a message',
    a.json.insights.every((i) => (i.entitlement === 'free' || i.entitlement === 'pro')
      && typeof i.gated === 'boolean' && typeof i.message === 'string'), a.json.insights);
  check('top reason per person is the highest-ranked (recency here)',
    a.json.insights.every((i) => i.type === 'recency'), a.json.insights.map((i) => i.type));

  const b = await call('/', { token: 'tok-b' });
  check('B’s feed is exactly B’s person (cross-tenant isolation)',
    b.status === 200 && b.json.insights.length === 1 && b.json.insights[0].personId === pB1, b.json);
  check('viewerTier reflects the PRO token user', b.json.viewerTier === 'pro', b.json.viewerTier);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 3. Entitlement is TAGGED, never enforced at this endpoint ──');
{
  const a = await call('/', { token: 'tok-a' });
  const core = a.json.insights.find((i) => i.personId === pA1);
  const nonCore = a.json.insights.find((i) => i.personId === pA2);
  check('Core-5 person tagged free + ungated', core.entitlement === 'free' && core.gated === false, core);
  check('non-Core person tagged pro + gated', nonCore.entitlement === 'pro' && nonCore.gated === true, nonCore);
  check('a FREE viewer STILL receives the gated (Pro) insight — tag only, no filtering',
    !!nonCore, a.json.insights.map((i) => i.personId + ':' + i.entitlement));
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 4. Query knobs: limit caps, perPerson expands, both validate ──');
{
  const capped = await call('/?limit=1', { token: 'tok-a' });
  check('limit=1 caps the feed to the single top-ranked item',
    capped.status === 200 && capped.json.insights.length === 1 && capped.json.insights[0].personId === pA1, capped.json);

  const dense = await call('/?perPerson=2', { token: 'tok-a' });
  check('perPerson=2 returns pA1’s two reasons (open_goal + recency) plus pA2’s one',
    dense.status === 200 && dense.json.insights.length === 3
    && typesOf(dense.json.insights, pA1).sort().join(',') === 'open_goal,recency',
    dense.json.insights.map((i) => i.personId + ':' + i.type));

  for (const q of ['?limit=0', '?limit=101', '?limit=-1', '?limit=abc', '?limit=1.5', '?limit=1&limit=2']) {
    const r = await call('/' + q, { token: 'tok-a' });
    check(`${q} → 422 invalid_request`, r.status === 422 && r.json.error === 'invalid_request', r);
  }
  for (const q of ['?perPerson=0', '?perPerson=11', '?perPerson=x']) {
    const r = await call('/' + q, { token: 'tok-a' });
    check(`${q} → 422 invalid_request`, r.status === 422 && r.json.error === 'invalid_request', r);
  }
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 5. Per-person read + cross-tenant isolation ──');
{
  const person = await call(`/person/${pA1}`, { token: 'tok-a' });
  check('GET /person/:id returns ALL of that person’s ranked insights',
    person.status === 200 && person.json.personId === pA1
    && person.json.insights.length === 2
    && person.json.insights.every((i) => i.personId === pA1), person.json);
  check('per-person insights keep the entitlement tag (Core-5 → free)',
    person.json.insights.every((i) => i.entitlement === 'free' && i.gated === false), person.json.insights);

  const foreign = await call(`/person/${pB1}`, { token: 'tok-a' });
  check('A querying B’s personId → 200 with EMPTY insights (user-scoped gather, no leak)',
    foreign.status === 200 && Array.isArray(foreign.json.insights) && foreign.json.insights.length === 0, foreign);

  const selfPerson = await call(`/person/${SELF_A}`, { token: 'tok-a' });
  check('self personId → empty (you do not reach out to yourself)',
    selfPerson.status === 200 && selfPerson.json.insights.length === 0, selfPerson);

  const unauthedPerson = await call(`/person/${pA1}`);
  check('per-person route is behind the auth wall too',
    unauthedPerson.status === 401 && unauthedPerson.json.error === 'auth_required', unauthedPerson);
}

// ════════════════════════════════════════════════════════════════════════════
server.close();
p('');
if (failures === 0) p('ALL INSIGHTS ROUTE TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
