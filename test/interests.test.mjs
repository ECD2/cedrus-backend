// NF2-SOURCES — Interests API suite: CRUD, auth, cross-tenant denial,
// opt-out honored. Run: bun test/interests.test.mjs
//
// What runs REAL here: the express router + auth middleware exactly as
// production wires them (createInterestsRouter() with default deps) and the
// interests service. One seam is faked, via bun's mock.module: the Supabase
// client (in-memory tables from test/web-fakes.mjs — imported, not edited).
//
// Spec coverage (NF2-SOURCES tasks 1–2, 4):
//   • JWT required on every route; forged/absent/unlinked JWT rejected
//   • list/add/update/remove round-trips against the N5 column set
//   • provenance is server-owned: explicit adds are user_stated, client
//     attempts to set provenance/confidence/surfacing_state are 422s
//   • re-add re-affirms (no duplicate row, freshness bump, off→active,
//     provenance upgrade) per the (user, category, lower(label)) identity
//   • user A cannot read, rename, silence, or delete user B's interests
//   • per-interest opt-out honored: default list is active-only
//   • `confidence` never appears in any response body

import crypto from 'node:crypto';
import { mock } from 'bun:test';

// ── Env BEFORE any src import: config.js fail-closed-requires these. Dummy
// values only — the Supabase seam is faked, nothing can reach a real host.
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'sk-test-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

import { makeFakeSupabase } from './web-fakes.mjs';

// ── Seed data ───────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID();
const uA = uid(), uB = uid();

const OLD = '2026-07-01T00:00:00.000Z'; // seeded freshness clock, clearly pre-test

const I = {
  yankees: uid(), knicks: uid(), pottery: uid(), severance: uid(), // user A
  lakers: uid(), sushi: uid(),                                     // user B
};

const interestRow = (id, user_id, category, label, created, extra = {}) => ({
  id, user_id, category, label,
  provenance: 'user_stated', confidence: 1.0, surfacing_state: 'active',
  last_affirmed_at: OLD, created_at: created, updated_at: created, ...extra,
});

const db = {
  app_users: [
    { id: uA, auth_user_id: 'auth-a', name: 'Alba', phone: '15551110001', timezone: 'America/New_York', plan: 'trialing', onboarding_complete: true },
    { id: uB, auth_user_id: 'auth-b', name: 'Bram', phone: '15551110002', timezone: 'America/New_York', plan: 'trialing', onboarding_complete: true },
  ],
  interests: [
    interestRow(I.yankees, uA, 'sports_team', 'New York Yankees', '2026-07-10T10:00:00.000Z'),
    interestRow(I.knicks, uA, 'sports_team', 'Knicks', '2026-07-10T11:00:00.000Z', { surfacing_state: 'off' }),
    interestRow(I.pottery, uA, 'hobby', 'Pottery', '2026-07-10T12:00:00.000Z', { provenance: 'inferred_confirmed', confidence: 0.7 }),
    interestRow(I.severance, uA, 'media_show', 'Severance', '2026-07-10T13:00:00.000Z', { surfacing_state: 'resting' }),
    interestRow(I.lakers, uB, 'sports_team', 'Lakers', '2026-07-10T14:00:00.000Z'),
    interestRow(I.sushi, uB, 'food', 'Omakase sushi', '2026-07-10T15:00:00.000Z', { surfacing_state: 'off' }),
  ],
};

const TOKENS = { 'tok-a': 'auth-a', 'tok-b': 'auth-b', 'tok-unlinked': 'auth-nobody' };

const fakeSupabase = makeFakeSupabase({ db, tokens: TOKENS });

// The one seam. Registered before anything imports src/, so every real
// module (service + auth middleware) gets the fake.
mock.module('../src/lib/supabase.js', () => ({ supabase: fakeSupabase }));

const express = (await import('express')).default;
const { createInterestsRouter } = await import('../src/routes/api/interests.js');
const svc = await import('../src/services/interests.js');

// ── Harness ─────────────────────────────────────────────────────────────────
let failures = 0;
const p = (...a) => console.log(...a);
function check(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail ? '  -- ' + JSON.stringify(detail) : '')); }
}

// Production wiring: default deps, the fake arrives via the mocked lib module.
const app = express();
app.use(express.json({ limit: '100kb' })); // mirror index.js's app-wide parser
app.use('/api/interests', createInterestsRouter());
const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api/interests`;

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

// db.interests is reassigned by the fake's delete op — always read it live.
const rowById = (id) => db.interests.find((r) => r.id === id);
const ids = (res) => (res.json.interests || []).map((r) => r.id);

// The exact key set a client may see (contract Interest type). confidence
// and user_id must never appear.
const PUBLIC_KEYS = ['category', 'created_at', 'id', 'label', 'last_affirmed_at',
  'provenance', 'surfacing_state', 'updated_at'];
const keysOf = (o) => Object.keys(o).sort().join(',');

// ════════════════════════════════════════════════════════════════════════════
p('── 1. Auth wall: every verb, fail closed ──');
{
  for (const [method, path] of [
    ['GET', ''], ['POST', ''], ['PATCH', `/${I.yankees}`], ['DELETE', `/${I.yankees}`],
  ]) {
    const r = await call(path, { method });
    check(`${method} without header → 401 auth_required`,
      r.status === 401 && r.json.error === 'auth_required', r);
  }
  const forged = await call('', { token: 'tok-forged' });
  check('forged token → 401', forged.status === 401 && forged.json.error === 'auth_required', forged);
  const unlinked = await call('', { token: 'tok-unlinked' });
  check('valid token, no linked account → 403 no_linked_account',
    unlinked.status === 403 && unlinked.json.error === 'no_linked_account', unlinked);
  check('auth wall probes wrote nothing', db.interests.length === 6, db.interests.length);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 2. List: active-only default, filters, shape ──');
{
  const dflt = await call('', { token: 'tok-a' });
  check('default list is ACTIVE ONLY (opt-out honored by default)',
    dflt.status === 200 && ids(dflt).join(',') === [I.yankees, I.pottery].join(','), ids(dflt));
  check('rows expose exactly the public columns',
    dflt.json.interests.every((r) => keysOf(r) === PUBLIC_KEYS.join(',')),
    dflt.json.interests.map(keysOf));
  check('confidence never appears in a response body',
    !JSON.stringify(dflt.json).includes('confidence'), null);
  check('user_id never appears in a response body',
    !JSON.stringify(dflt.json).includes('user_id'), null);

  const all = await call('?state=all', { token: 'tok-a' });
  check('state=all returns every row, created_at ascending',
    ids(all).join(',') === [I.yankees, I.knicks, I.pottery, I.severance].join(','), ids(all));

  const off = await call('?state=off', { token: 'tok-a' });
  check('state=off returns only silenced rows', ids(off).join(',') === I.knicks, ids(off));

  const resting = await call('?state=resting', { token: 'tok-a' });
  check('state=resting readable (sweep-reserved state)',
    ids(resting).join(',') === I.severance, ids(resting));

  const sport = await call('?category=sports_team', { token: 'tok-a' });
  check('category filter + active default', ids(sport).join(',') === I.yankees, ids(sport));

  const sportAll = await call('?category=sports_team&state=all', { token: 'tok-a' });
  check('category filter composes with state=all',
    ids(sportAll).join(',') === [I.yankees, I.knicks].join(','), ids(sportAll));

  const badState = await call('?state=loud', { token: 'tok-a' });
  check('unknown state → 422 invalid_request',
    badState.status === 422 && badState.json.error === 'invalid_request', badState);
  const badCat = await call('?category=topic', { token: 'tok-a' });
  check('unknown category filter → 422 (schema vocabulary is the contract)',
    badCat.status === 422, badCat);
  const arrayState = await call('?state=all&state=off', { token: 'tok-a' });
  check('repeated state param → 422 (no array smuggling)', arrayState.status === 422, arrayState);

  const bAll = await call('?state=all', { token: 'tok-b' });
  check("B's list is exactly B's rows",
    ids(bAll).join(',') === [I.lakers, I.sushi].join(','), ids(bAll));
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 3. Add: explicit user-stated create ──');
let chessId;
{
  const add = await call('', { method: 'POST', token: 'tok-a', body: { category: 'hobby', label: '  Chess  ' } });
  chessId = add.json.interest && add.json.interest.id;
  check('add → created, label trimmed', add.status === 200 && add.json.created === true
    && add.json.reaffirmed === false && add.json.interest.label === 'Chess', add.json);
  check('add is provenance=user_stated, surfacing_state=active',
    add.json.interest.provenance === 'user_stated' && add.json.interest.surfacing_state === 'active', add.json);
  check('add response carries exactly the public columns',
    keysOf(add.json.interest) === PUBLIC_KEYS.join(','), keysOf(add.json.interest));
  const row = rowById(chessId);
  check('stored row: owner is the token user, confidence certainty',
    row && row.user_id === uA && row.confidence === 1.0, row);
  check('one new row', db.interests.length === 7, db.interests.length);

  for (const [name, body] of [
    ['missing label', { category: 'hobby' }],
    ['blank label', { category: 'hobby', label: '   ' }],
    ['label over 200 chars', { category: 'hobby', label: 'x'.repeat(201) }],
    ['missing category', { label: 'Chess' }],
    ["category outside the N5 vocabulary ('topic' is not a real column value)", { category: 'topic', label: 'AI' }],
    ['array body', [{ category: 'hobby', label: 'Chess' }]],
  ]) {
    const r = await call('', { method: 'POST', token: 'tok-a', body });
    check(`${name} → 422`, r.status === 422 && r.json.error === 'invalid_request', r);
  }

  // Server-owned columns are refused, not ignored: the ONLY way an
  // inferred interest reaches this table is the capture confirm flow.
  for (const [name, extra] of [
    ['provenance', { provenance: 'inferred_confirmed' }],
    ['confidence', { confidence: 0.5 }],
    ['surfacing_state', { surfacing_state: 'off' }],
    ['user_id', { user_id: uB }],
  ]) {
    const r = await call('', {
      method: 'POST', token: 'tok-a',
      body: { category: 'food', label: 'Ramen', ...extra },
    });
    check(`client-set ${name} → 422 (server-owned)`, r.status === 422, r);
  }
  check('rejected adds wrote nothing', db.interests.length === 7, db.interests.length);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 4. Re-add: re-affirm, never duplicate ──');
{
  const re = await call('', {
    method: 'POST', token: 'tok-a',
    body: { category: 'sports_team', label: 'new york yankees' },
  });
  check('same (category, lower(label)) → reaffirmed, not created',
    re.status === 200 && re.json.reaffirmed === true && re.json.created === false, re.json);
  check('no duplicate row', db.interests.length === 7, db.interests.length);
  const yankees = rowById(I.yankees);
  check("latest casing wins ('new york yankees')", yankees.label === 'new york yankees', yankees.label);
  check('freshness clock bumped past the seeded value', yankees.last_affirmed_at > OLD, yankees.last_affirmed_at);

  const knicksBack = await call('', {
    method: 'POST', token: 'tok-a', body: { category: 'sports_team', label: 'KNICKS ' },
  });
  check('re-adding a silenced interest flips it back to active',
    knicksBack.json.reaffirmed === true && rowById(I.knicks).surfacing_state === 'active',
    rowById(I.knicks));

  const potteryBack = await call('', {
    method: 'POST', token: 'tok-a', body: { category: 'hobby', label: 'Pottery' },
  });
  const pottery = rowById(I.pottery);
  check('explicit re-statement upgrades inferred_confirmed → user_stated at certainty',
    potteryBack.json.reaffirmed === true && pottery.provenance === 'user_stated' && pottery.confidence === 1.0,
    pottery);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 5. Update: opt-out toggle and rename ──');
{
  const silence = await call(`/${I.yankees}`, {
    method: 'PATCH', token: 'tok-a', body: { surfacing_state: 'off' },
  });
  check('opt-out: surfacing_state → off',
    silence.status === 200 && silence.json.updated === true
    && silence.json.interest.surfacing_state === 'off', silence.json);

  const sport = await call('?category=sports_team', { token: 'tok-a' });
  check('opted-out interest vanishes from the default consumer read (sports module path)',
    ids(sport).join(',') === I.knicks, ids(sport));

  const preKnicks = rowById(I.knicks).last_affirmed_at;
  await call(`/${I.knicks}`, { method: 'PATCH', token: 'tok-a', body: { surfacing_state: 'off' } });
  check('silencing does NOT touch the freshness clock',
    rowById(I.knicks).last_affirmed_at === preKnicks && rowById(I.knicks).surfacing_state === 'off',
    rowById(I.knicks));

  const wake = await call(`/${I.severance}`, {
    method: 'PATCH', token: 'tok-a', body: { surfacing_state: 'active' },
  });
  check('non-active → active IS an affirmation (clock bumped past seed)',
    wake.status === 200 && rowById(I.severance).last_affirmed_at > OLD, rowById(I.severance));

  const yankeesOn = await call(`/${I.yankees}`, {
    method: 'PATCH', token: 'tok-a', body: { surfacing_state: 'active' },
  });
  check('opt back in round-trips', yankeesOn.json.interest.surfacing_state === 'active', yankeesOn.json);

  const preChess = rowById(chessId).last_affirmed_at;
  const rename = await call(`/${chessId}`, {
    method: 'PATCH', token: 'tok-a', body: { label: ' Speed Chess ' },
  });
  check('rename: trimmed label lands', rename.json.interest.label === 'Speed Chess', rename.json);
  check('a plain rename is NOT an affirmation (clock untouched)',
    rowById(chessId).last_affirmed_at === preChess, rowById(chessId).last_affirmed_at);

  const clash = await call(`/${I.pottery}`, {
    method: 'PATCH', token: 'tok-a', body: { label: 'speed chess' },
  });
  check('rename colliding in-category → 409 duplicate_interest',
    clash.status === 409 && clash.json.error === 'duplicate_interest', clash);
  check('collision left the row unchanged', rowById(I.pottery).label === 'Pottery', rowById(I.pottery).label);

  const caseOnly = await call(`/${chessId}`, {
    method: 'PATCH', token: 'tok-a', body: { label: 'speed chess' },
  });
  check('case-only self-rename is not a collision',
    caseOnly.status === 200 && caseOnly.json.interest.label === 'speed chess', caseOnly);

  const both = await call(`/${chessId}`, {
    method: 'PATCH', token: 'tok-a', body: { label: 'Blitz Chess', surfacing_state: 'off' },
  });
  check('label + surfacing_state patch together',
    both.json.interest.label === 'Blitz Chess' && both.json.interest.surfacing_state === 'off', both.json);

  for (const [name, body, status] of [
    ["'resting' is sweep-reserved, not client-writable", { surfacing_state: 'resting' }, 422],
    ['empty patch', {}, 422],
    ['unknown patch key', { sneaky: 1 }, 422],
    ['provenance not patchable (confirmed-only rule)', { provenance: 'inferred_confirmed' }, 422],
    ['confidence not patchable', { confidence: 0.2 }, 422],
    ['label over 200 chars', { label: 'x'.repeat(201) }, 422],
  ]) {
    const r = await call(`/${chessId}`, { method: 'PATCH', token: 'tok-a', body });
    check(`${name} → ${status}`, r.status === status, r);
  }
  const mangled = await call('/definitely-not-a-uuid', {
    method: 'PATCH', token: 'tok-a', body: { surfacing_state: 'off' },
  });
  check('malformed id → 404 (no 500 leak)', mangled.status === 404, mangled);
  const ghost = await call(`/${uid()}`, {
    method: 'PATCH', token: 'tok-a', body: { surfacing_state: 'off' },
  });
  check('unknown id → 404', ghost.status === 404, ghost);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 6. Cross-tenant denial ──');
{
  const patchB = await call(`/${I.lakers}`, {
    method: 'PATCH', token: 'tok-a', body: { surfacing_state: 'off' },
  });
  check("A silencing B's interest → 404, row untouched",
    patchB.status === 404 && rowById(I.lakers).surfacing_state === 'active', patchB);

  const renameB = await call(`/${I.lakers}`, {
    method: 'PATCH', token: 'tok-a', body: { label: 'Clippers' },
  });
  check("A renaming B's interest → 404, label untouched",
    renameB.status === 404 && rowById(I.lakers).label === 'Lakers', renameB);

  const deleteB = await call(`/${I.lakers}`, { method: 'DELETE', token: 'tok-a' });
  check("A deleting B's interest → 404, row survives",
    deleteB.status === 404 && !!rowById(I.lakers), deleteB);

  // Same label, two tenants: independent rows, no cross-tenant dedup and
  // no cross-tenant re-affirm side effects.
  const bAdd = await call('', {
    method: 'POST', token: 'tok-b', body: { category: 'sports_team', label: 'New York Yankees' },
  });
  check("B adding A's label creates B's OWN row (no cross-tenant identity)",
    bAdd.json.created === true && rowById(bAdd.json.interest.id).user_id === uB, bAdd.json);
  check("…and A's row was not re-affirmed or relabeled",
    rowById(I.yankees).label === 'new york yankees' && rowById(I.yankees).user_id === uA,
    rowById(I.yankees));

  const aAll = await call('?state=all', { token: 'tok-a' });
  const bIds = db.interests.filter((r) => r.user_id === uB).map((r) => r.id);
  check("A's list never contains a B row", ids(aAll).every((id) => !bIds.includes(id)), ids(aAll));
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 7. Remove: a real delete, distinct from opt-out ──');
{
  const before = db.interests.length;
  const del = await call(`/${chessId}`, { method: 'DELETE', token: 'tok-a' });
  check('delete → removed', del.status === 200 && del.json.removed === true && del.json.id === chessId, del.json);
  check('row is gone', !rowById(chessId) && db.interests.length === before - 1, db.interests.length);

  const again = await call(`/${chessId}`, { method: 'DELETE', token: 'tok-a' });
  check('double delete → 404 (client may treat as success-noop)', again.status === 404, again);

  const mangled = await call('/not-a-uuid', { method: 'DELETE', token: 'tok-a' });
  check('malformed id → 404 (no 500 leak)', mangled.status === 404, mangled);

  const list = await call('?state=all', { token: 'tok-a' });
  check('deleted interest is gone from the list', !ids(list).includes(chessId), ids(list));
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 8. Service ownership guards (defense in depth) ──');
{
  for (const [name, fn] of [
    ['listInterests', () => svc.listInterests({})],
    ['addInterest', () => svc.addInterest({ body: { category: 'hobby', label: 'x' } })],
    ['updateInterest', () => svc.updateInterest({ interestId: uid(), patch: { label: 'x' } })],
    ['removeInterest', () => svc.removeInterest({ interestId: uid() })],
  ]) {
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    check(`${name} without user throws the ownership guard`,
      !!threw && /ownership guard/.test(threw.message), threw && threw.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 9. Voice: user-facing copy obeys the spec ──');
{
  const COPY = [
    svc.MSG_NOT_FOUND, svc.MSG_NEED_CATEGORY_AND_LABEL, svc.MSG_BAD_CATEGORY,
    svc.MSG_EMPTY_LABEL, svc.MSG_LABEL_TOO_LONG, svc.MSG_SERVER_FIELDS,
    svc.MSG_BAD_PATCH, svc.MSG_RESTING_RESERVED, svc.MSG_DUPLICATE, svc.MSG_BAD_LIST_FILTER,
  ];
  check('no em dashes anywhere in API copy', COPY.every((s) => !s.includes('—')), COPY.filter((s) => s.includes('—')));
  check('no exclamation marks in API copy', COPY.every((s) => !s.includes('!')), COPY.filter((s) => s.includes('!')));
  check('category vocabulary mirrors the N5 CHECK constraint exactly',
    svc.INTEREST_CATEGORIES.join(',') === 'sports_team,hobby,media_show,media_music,food,place,other_freeform',
    svc.INTEREST_CATEGORIES);
}

// ════════════════════════════════════════════════════════════════════════════
server.close();
p('');
if (failures === 0) p('ALL INTERESTS TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
