// Bundle 47 — the auth API: a Supabase JWT verified IN CODE, aal2 REQUIRED,
// and /api/interface scoped to the caller (A3.1 / A3.2).
// Run: bun test/auth-api.test.mjs
//
// WHAT THIS SUITE IS FOR
// Phase 3 gives Emil an address that knows who he is and shows only his day.
// Two claims have to be true for that, and both are proven here WITH
// CONTROLS, because a refusal on its own is indistinguishable from a broken
// endpoint (II.2):
//
//   1. A first-factor-only session is refused at a surface a full session
//      reaches. (aal1 → 401 mfa_required; the SAME claims at aal2 → 200.)
//   2. A second account's session sees none of the first's records, and its
//      own request returns ITS records. (Two users, two tokens, /workspace.)
//
// WHAT RUNS REAL HERE
//   • the real JWT verifier (services/auth/jwt.js, keys.js, verifier.js)
//     against synthetic keys: an HS256 TEST SECRET injected through the DI
//     seam, and a P-256 pair generated in-process for the ES256 path the
//     Cedrus project actually signs with. NO real key anywhere.
//   • the real choke point (routes/api/auth.js) and the real interface router
//     (routes/api/interface.js), booted on a real Express app over node:http.
//   • the real CoS client + reader (forUser, READER_COLUMNS) talking over HTTP
//     to a PostgREST DOUBLE in this file that honours `col=eq.v`, `order`,
//     `limit` and `select` the way PostgREST does — so the query the reader
//     really sends is what isolates the two users, not a mocked builder.
//   • the real composer/writer to build the stored brief fixture
//     (validateBrief + buildBriefRow), so /brief/today serves a row shaped
//     exactly as the daily job writes it.
// The only seams are the Cedrus database (an in-memory builder fake below)
// and the signing keys. No decision under test is reimplemented here.

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';

// DYNAMIC imports: config.js calls required() at module scope and static
// imports are hoisted above the env assignments (same as bundles 36–43).
const jwtMod = await import('../src/services/auth/jwt.js');
const keysMod = await import('../src/services/auth/keys.js');
const verifierMod = await import('../src/services/auth/verifier.js');
const assuranceMod = await import('../src/services/auth/assurance.js');
const capsMod = await import('../src/services/auth/capabilities.js');
const authMod = await import('../src/routes/api/auth.js');
const ifaceMod = await import('../src/routes/api/interface.js');
const reader = await import('../src/services/cos/reader.js');
const ledger = await import('../src/services/cos/ledger.js');
const compose = await import('../src/services/cos/compose.js');
const writer = await import('../src/services/cos/writer.js');
const programsToday = await import('../src/services/programs/today.js');
const express = (await import('express')).default;

const p = console.log;
let failures = 0;
function ok(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}
const section = (n) => { p(''); p('— ' + n + ' —'); };

p('=== Bundle 47 — auth API: JWT verified in code, aal2 required, /api/interface per person ===');

// ── a fixed clock, a test secret, a generated key pair ──────────────────────
const NOW_ISO = '2026-09-09T15:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const nowMs = () => NOW_MS;
const nowSec = Math.floor(NOW_MS / 1000);
const ISSUER = 'https://cedrus-test.invalid/auth/v1';
const TEST_SECRET = 'bundle-47-test-secret-never-a-real-key';
const KID = 'test-kid-1';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'ES256', use: 'sig' };
const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

const b64u = jwtMod.b64urlEncode;
function signHS256(payload, secret, header = {}) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT', ...header }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${body}`).digest();
  return `${h}.${body}.${b64u(sig)}`;
}
function signES256(payload, key, kid = KID) {
  const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(`${h}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${h}.${body}.${b64u(sig)}`;
}
const without = (obj, key) => { const o = { ...obj }; delete o[key]; return o; };

function claims({
  sub, aal = 'aal2', exp = nowSec + 3600, iat = nowSec - 60, iss = ISSUER, aud = 'authenticated',
  role = 'authenticated', amr, session_id,
} = {}) {
  return {
    sub, aal, exp, iat, iss, aud, role,
    amr: amr ?? (aal === 'aal2'
      ? [{ method: 'totp', timestamp: iat }, { method: 'password', timestamp: iat - 5 }]
      : [{ method: 'password', timestamp: iat }]),
    session_id: session_id ?? ('sess-' + String(sub).slice(0, 8)),
  };
}

// ── the people ──────────────────────────────────────────────────────────────
const A = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', auth: '11111111-aaaa-4aaa-8aaa-111111111111', cos: 'c05a0000-aaaa-4aaa-8aaa-c05a0000aaaa' };
const B = { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', auth: '22222222-bbbb-4bbb-8bbb-222222222222', cos: 'c05b0000-bbbb-4bbb-8bbb-c05b0000bbbb' };
const CARA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', auth: '33333333-cccc-4ccc-8ccc-333333333333' };   // suspended
const DAN = { auth: '44444444-dddd-4ddd-8ddd-444444444444' };                                                   // no app_users row
const ERIN = { id: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee', auth: '55555555-eeee-4eee-8eee-555555555555' };   // account_status 'banana'
const FAY = { id: 'ffffffff-6666-4666-8666-ffffffffffff', auth: '66666666-ffff-4fff-8fff-666666666666' };    // active, no user_settings row

const aal2 = (u) => signHS256(claims({ sub: u.auth }), TEST_SECRET);
const aal1 = (u) => signHS256(claims({ sub: u.auth, aal: 'aal1' }), TEST_SECRET);

// ── the Cedrus database double (app_users, user_settings, user_capabilities, system_flags, rpc) ──
function fakeCedrusDb(seed) {
  const db = JSON.parse(JSON.stringify(seed));
  const faults = new Map();
  const seen = [];
  function table(name) {
    if (!db[name]) db[name] = [];
    const state = { filters: [], order: null, limit: null, single: false, maybe: false };
    const api = {
      select() { return api; },
      eq(f, v) { state.filters.push([f, v]); return api; },
      order(f, opts = {}) { state.order = { f, asc: opts.ascending !== false }; return api; },
      limit(n) { state.limit = n; return api; },
      single() { state.single = true; return api; },
      maybeSingle() { state.maybe = true; return api; },
      then(resolve, reject) {
        try { resolve(run()); } catch (e) { if (reject) reject(e); else throw e; }
      },
    };
    function run() {
      seen.push({ table: name, filters: state.filters.slice() });
      if (faults.has(name)) return { data: null, error: faults.get(name) };
      let rows = db[name].filter((r) => state.filters.every(([f, v]) => r[f] === v));
      if (state.order) {
        const { f, asc } = state.order;
        rows = [...rows].sort((a, b) => (a[f] < b[f] ? -1 : a[f] > b[f] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (state.limit != null) rows = rows.slice(0, state.limit);
      if (state.single) return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: `expected 1 row, got ${rows.length}` } };
      if (state.maybe) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    return api;
  }
  return {
    from: table,
    async rpc(fn, args) {
      seen.push({ rpc: fn, args });
      if (faults.has('rpc:' + fn)) return { data: null, error: faults.get('rpc:' + fn) };
      if (fn !== 'todays_program_items') return { data: null, error: { code: 'PGRST202', message: `function ${fn} not found` } };
      return { data: (db.program_items_today || []).filter((r) => r.user_id === args.p_user_id), error: null };
    },
    faults, seen, rows: db,
  };
}

const SEED = {
  app_users: [
    { id: A.id, auth_user_id: A.auth, name: 'Alice', display_name: 'Alice A.', phone: '15550000001', timezone: 'America/New_York', role: 'admin', account_status: 'active', sms_consent_at: '2026-07-10T12:00:00.000Z', opted_out: false, created_at: '2026-07-10T12:00:00.000Z' },
    { id: B.id, auth_user_id: B.auth, name: 'Bob', display_name: null, phone: null, timezone: 'Europe/Madrid', role: 'member', account_status: 'active', sms_consent_at: null, opted_out: false, created_at: '2026-09-01T12:00:00.000Z' },
    { id: CARA.id, auth_user_id: CARA.auth, name: 'Cara', timezone: 'America/New_York', role: 'member', account_status: 'suspended' },
    { id: ERIN.id, auth_user_id: ERIN.auth, name: 'Erin', timezone: 'America/New_York', role: 'member', account_status: 'banana' },
    { id: FAY.id, auth_user_id: FAY.auth, name: 'Fay', timezone: 'America/Chicago', role: 'member', account_status: 'active' },
  ],
  user_settings: [
    { user_id: A.id, brief_email: 'alice@example.test', brief_enabled: true, brief_hour_utc: 11, cos_user_id: A.cos, usage_user_id: A.id, timezone: 'America/New_York' },
    { user_id: B.id, brief_email: null, brief_enabled: false, brief_hour_utc: 11, cos_user_id: B.cos, usage_user_id: null, timezone: 'Europe/Madrid' },
  ],
  user_capabilities: [
    { user_id: A.id, capability: 'run_agents', granted: true },
    { user_id: A.id, capability: 'receive_brief', granted: true },
    { user_id: A.id, capability: 'write_workspace', granted: false },
    // receive_sms: NO row for Alice — absent must read false.
    // Bob: no rows at all.
  ],
  system_flags: [],
  program_items_today: [
    { user_id: A.id, program_id: 'prog-a', program_title: 'Miami Man 2026', program_kind: 'training', time_zone: 'America/New_York', local_date: '2026-09-09', category: 'swim', title: 'Endurance swim', planned_start_local: '06:30', planned_duration_minutes: 45, status: 'planned', instructions: null },
    { user_id: A.id, program_id: 'prog-a', program_title: 'Miami Man 2026', program_kind: 'training', time_zone: 'America/New_York', local_date: '2026-09-09', category: 'run', title: 'Easy run', planned_start_local: null, planned_duration_minutes: 30, status: 'planned', instructions: 'zone 2' },
  ],
};
// Alice's ledger row for today, built with the Engine's OWN key function so
// the test cannot drift from the real key format.
SEED.system_flags.push({
  key: ledger.ledgerKey({ userId: A.cos, now: new Date(NOW_MS) }),
  value: { status: 'sent', sent_at: '2026-09-09T11:00:07.000Z' },
});

// ── the CoS PostgREST double ────────────────────────────────────────────────
//
// THE LOAD-BEARING DOUBLE. supabase-js talks HTTP to it exactly as it would to
// CoS. It honours `col=eq.v`, `order=col.dir`, `limit=n` and `select=a,b`.
// If it ignored the user filter every isolation assertion below would fail
// loudly; if it returned nothing they would PASS for the wrong reason — so the
// control half of every test, and a SELF-CHECK, prove it discriminates.
async function startPostgrestDouble(tables) {
  const requests = [];
  const faults = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/rest\/v1\/([A-Za-z_]+)$/);
    requests.push({ method: req.method, path: url.pathname, search: url.search, params: [...url.searchParams] });
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!m) return json(404, { code: 'PGRST205', message: 'not a table', details: null, hint: null });
    const table = m[1];
    if (faults.has(table)) { const f = faults.get(table); return json(f.status, f.body); }
    if (!(table in tables)) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}'`, details: null, hint: null });
    let rows = tables[table].slice();
    let select = null; let order = null; let limit = null;
    for (const [k, v] of url.searchParams) {
      if (k === 'select') select = v.split(',').map((s) => s.trim()).filter(Boolean);
      else if (k === 'order') order = v;
      else if (k === 'limit') limit = Number(v);
      else if (k === 'offset') continue;
      else {
        const mm = v.match(/^eq\.(.*)$/);
        if (!mm) return json(400, { code: 'PGRST100', message: `unsupported operator in ${k}=${v}` });
        rows = rows.filter((r) => String(r[k]) === mm[1]);
      }
    }
    if (order) {
      const [col, dir] = order.split('.');
      rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    if (limit != null) rows = rows.slice(0, limit);
    if (select && !select.includes('*')) rows = rows.map((r) => Object.fromEntries(select.map((c) => [c, r[c] === undefined ? null : r[c]])));
    json(200, rows);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, faults, close: () => new Promise((r) => server.close(r)) };
}

// ── CoS rows for two people, in the reader's own column shapes ──────────────
const WS_A1 = 'a1a1a1a1-0000-4000-8000-000000000a01';
const WS_A2 = 'a2a2a2a2-0000-4000-8000-000000000a02';
const WS_B1 = 'b1b1b1b1-0000-4000-8000-000000000b01';
const GEN_AT_A = '2026-09-09T11:00:05.000Z';   // 07:00 in New York on the 9th — today for Alice
const GEN_AT_B = '2026-09-08T11:00:05.000Z';   // the 8th everywhere — NOT today for Bob
const cosTables = {
  workstreams: [
    { id: WS_A1, user_id: A.cos, name: "Alice's launch", status: 'active', priority: 'high', health: 'green', objective: 'Ship', current_stage: 'build', next_action: 'Land Bundle 47', target_date: '2026-09-12', archived_at: null, created_at: '2026-09-01T00:00:00.000Z' },
    { id: WS_A2, user_id: A.cos, name: "Alice's care routine", status: 'active', priority: 'medium', health: null, objective: null, current_stage: null, next_action: null, target_date: null, archived_at: null, created_at: '2026-09-02T00:00:00.000Z' },
    { id: WS_B1, user_id: B.cos, name: "Bob's move", status: 'active', priority: 'high', health: 'amber', objective: 'Move house', current_stage: 'plan', next_action: 'Call movers', target_date: null, archived_at: null, created_at: '2026-09-03T00:00:00.000Z' },
  ],
  open_loops: [
    { id: 'ol-a1', user_id: A.cos, title: 'Waiting on legal', status: 'open', priority: 'high', waiting_on: 'Legal', next_action: null, due_at: null, workstream_id: WS_A1, created_at: '2026-09-04T00:00:00.000Z' },
    { id: 'ol-b1', user_id: B.cos, title: 'Movers quote', status: 'open', priority: 'medium', waiting_on: 'Movers', next_action: 'Chase', due_at: '2026-09-10T00:00:00.000Z', workstream_id: WS_B1, created_at: '2026-09-04T00:00:00.000Z' },
  ],
  decisions: [
    { id: 'dc-a1', user_id: A.cos, question: 'ES256 or HS256?', status: 'decided', recommendation: 'ES256', recommendation_source: 'ai', decided_at: '2026-09-09T00:00:00.000Z', workstream_id: WS_A1, created_at: '2026-09-05T00:00:00.000Z' },
    { id: 'dc-b1', user_id: B.cos, question: 'Which flat?', status: 'open', recommendation: null, recommendation_source: null, decided_at: null, workstream_id: WS_B1, created_at: '2026-09-05T00:00:00.000Z' },
    { id: 'dc-b2', user_id: B.cos, question: 'Sell the car?', status: 'open', recommendation: null, recommendation_source: null, decided_at: null, workstream_id: null, created_at: '2026-09-06T00:00:00.000Z' },
  ],
  agent_runs: [
    { id: 'ar-a1', user_id: A.cos, agent: 'observer', model: 'test', objective: 'digest', verification_state: 'verified', unresolved_findings: 0, recommended_next_action: null, original_body: 'ok', created_at: '2026-09-09T09:00:00.000Z' },
  ],
  today_briefs: [],
};

// The stored brief fixture, built by the REAL composer + writer from the rows
// above, exactly as the daily job does it (validateBrief, then todays_program,
// then buildBriefRow). Not a hand-written sentence.
function buildStoredBrief({ cosUserId, summary, refId, generatedAt, programRows }) {
  const raw = {
    workstreams: cosTables.workstreams.filter((w) => w.user_id === cosUserId),
    open_loops: cosTables.open_loops.filter((r) => r.user_id === cosUserId),
    decisions: cosTables.decisions.filter((r) => r.user_id === cosUserId),
    captures: [], agent_runs: cosTables.agent_runs.filter((r) => r.user_id === cosUserId),
    email_messages: [], email_ai_analyses: [],
  };
  const minimized = compose.enforceTotalSize(compose.minimizeInput(raw, Date.parse(generatedAt)));
  const model = {
    schema_version: compose.BRIEF_SCHEMA_VERSION, generated_at: 'whatever-the-model-said',
    summary,
    top_priorities: [{ rank: 1, title: 'Top item', reason: 'Because', recommended_action: 'Do it', urgency: 'high', confidence: 0.8, source_refs: [{ type: 'workstream', id: refId }] }],
    decisions_to_make: [], people_or_dependencies_waiting: [], risks: [], not_enough_evidence: [], model_disclaimer: 'model wrote this',
  };
  const validation = compose.validateBrief(model, minimized, new Date(generatedAt));
  if (!validation.ok) throw new Error('fixture brief did not validate: ' + validation.detail);
  const brief = { ...validation.brief, todays_program: programsToday.computeTodaysProgram(programRows) };
  return writer.buildBriefRow({ userId: cosUserId, brief, minimizedInput: minimized, model: 'test-model', latencyMs: 1200, tokens: 3000, now: new Date(generatedAt) });
}
const BRIEF_A_ID = 'br-a-today';
const BRIEF_B_ID = 'br-b-yesterday';
cosTables.today_briefs.push({ id: BRIEF_A_ID, generated_at: GEN_AT_A, ...buildStoredBrief({ cosUserId: A.cos, summary: "Alice: land the auth API.", refId: WS_A1, generatedAt: GEN_AT_A, programRows: SEED.program_items_today }) });
cosTables.today_briefs.push({ id: BRIEF_B_ID, generated_at: GEN_AT_B, ...buildStoredBrief({ cosUserId: B.cos, summary: "Bob: chase the movers.", refId: WS_B1, generatedAt: GEN_AT_B, programRows: [] }) });
// An ERROR row for Alice, NEWER than her ok row: it has no structured_output
// and must never be served as today's brief.
cosTables.today_briefs.push({ id: 'br-a-error', user_id: A.cos, generated_at: '2026-09-09T11:30:00.000Z', schema_version: compose.BRIEF_SCHEMA_VERSION, generation_mode: 'ai', model: 'test-model', status: 'error', error_category: 'model_failed', structured_output: null, source_refs: [], expires_at: null });

const cos = await startPostgrestDouble(cosTables);
const COS_ENV = { COS_SUPABASE_URL: cos.url, COS_SERVICE_ROLE_KEY: 'cos-key-not-real', COS_USER_ID: A.cos };
// COS_USER_ID is deliberately SET to Alice's id, as it is on the production
// deploy today (single-owner). The API must never read it; Bundle 47's
// mutation harness turns the /workspace handler onto it and proves it leaks.

// ── the app under test ──────────────────────────────────────────────────────
const dbA = fakeCedrusDb(SEED);
const verifier = verifierMod.createTokenVerifier({ hmacSecret: TEST_SECRET, jwks: [publicJwk], issuer: ISSUER, now: nowMs });
function boot(deps) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/interface', ifaceMod.createInterfaceRouter(deps));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/interface`;
  const call = async (path, { token, rawAuth, headers = {} } = {}) => {
    const h = { ...headers };
    if (rawAuth) h.authorization = rawAuth;
    else if (token) h.authorization = `Bearer ${token}`;
    const res = await fetch(base + path, { headers: h });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html 404 etc */ }
    return { status: res.status, json, text };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}
const app = boot({ db: dbA, env: COS_ENV, now: () => new Date(NOW_MS), verifier });

// ═══════════════════════════════════════════════════════════════════════════
section('1. the verifier: signature, then claims — every refusal named, the token never echoed');
{
  const v = (token, opts = {}) => jwtMod.verifyJwt(token, { hmacSecret: TEST_SECRET, resolveJwk: async (kid, alg) => keysMod.selectJwk([publicJwk], kid, alg), issuer: ISSUER, now: nowMs, ...opts });
  const good = await v(aal2(A));
  ok('HS256 signed with the test secret verifies', good.ok === true && good.claims.sub === A.auth, good);
  ok('CONTROL: the same token with the WRONG secret is bad_signature', (await v(signHS256(claims({ sub: A.auth }), 'not-the-secret'))).reason === 'bad_signature');

  // The claim an attacker most wants to change. Re-encode the payload with
  // aal2 under a signature made over aal1: the signature must fail BEFORE
  // the claim is ever read.
  const t1 = aal1(A);
  const [h, , s] = t1.split('.');
  const forgedAal = `${h}.${b64u(JSON.stringify(claims({ sub: A.auth, aal: 'aal2' })))}.${s}`;
  const forged = await v(forgedAal);
  ok('a payload re-written to aal2 under an aal1 signature is bad_signature, not accepted', forged.ok === false && forged.reason === 'bad_signature', forged);

  ok('expired (exp == now) is refused as expired', (await v(signHS256(claims({ sub: A.auth, exp: nowSec }), TEST_SECRET))).reason === 'expired');
  ok('CONTROL: exp one second in the future verifies', (await v(signHS256(claims({ sub: A.auth, exp: nowSec + 1 }), TEST_SECRET))).ok === true);
  ok('nbf in the future is not_yet_valid', (await v(signHS256({ ...claims({ sub: A.auth }), nbf: nowSec + 60 }, TEST_SECRET))).reason === 'not_yet_valid');
  ok('no exp at all is no_expiry', (await v(signHS256(without(claims({ sub: A.auth }), 'exp'), TEST_SECRET))).reason === 'no_expiry');
  ok('wrong issuer is bad_issuer', (await v(signHS256(claims({ sub: A.auth, iss: 'https://other.invalid/auth/v1' }), TEST_SECRET))).reason === 'bad_issuer');
  ok('aud anon is bad_audience', (await v(signHS256(claims({ sub: A.auth, aud: 'anon' }), TEST_SECRET))).reason === 'bad_audience');
  ok('aud as an array containing authenticated verifies', (await v(signHS256(claims({ sub: A.auth, aud: ['authenticated', 'x'] }), TEST_SECRET))).ok === true);
  // A service_role key is a JWT signed by the same project. It is not a person.
  const svc = signHS256({ iss: ISSUER, role: 'service_role', aud: 'authenticated', exp: nowSec + 3600, iat: nowSec }, TEST_SECRET);
  ok('a service_role JWT is bad_role — never a person', (await v(svc)).reason === 'bad_role');
  ok('missing sub is no_subject', (await v(signHS256(without(claims({ sub: A.auth }), 'sub'), TEST_SECRET))).reason === 'no_subject');
  ok('a non-UUID sub is no_subject', (await v(signHS256(claims({ sub: 'admin' }), TEST_SECRET))).reason === 'no_subject');

  ok("alg 'none' is unsupported_alg", (await v(signHS256(claims({ sub: A.auth }), TEST_SECRET, { alg: 'none' }))).reason === 'unsupported_alg');
  ok('alg HS512 is unsupported_alg', (await v(signHS256(claims({ sub: A.auth }), TEST_SECRET, { alg: 'HS512' }))).reason === 'unsupported_alg');
  ok('HS256 with NO secret configured is no_key_for_alg (never silently accepted)', (await v(aal2(A), { hmacSecret: null })).reason === 'no_key_for_alg');
  for (const bad of ['', 'not-a-jwt', 'a.b', 'a.b.c', 'tok-a', `${b64u('[]')}.${b64u('{}')}.${b64u('x')}`]) {
    ok(`malformed: ${JSON.stringify(bad)}`, (await v(bad)).reason === 'malformed');
  }

  // ES256 — the algorithm the Cedrus project signs with (one P-256 key in its
  // public JWKS on 2026-09-09).
  const es = await v(signES256(claims({ sub: A.auth }), privateKey));
  ok('ES256 signed with the generated pair verifies against its public JWK', es.ok === true && es.header.alg === 'ES256', es);
  ok('CONTROL: ES256 signed with a DIFFERENT pair is bad_signature', (await v(signES256(claims({ sub: A.auth }), other.privateKey))).reason === 'bad_signature');
  ok('an unknown kid is unknown_key', (await v(signES256(claims({ sub: A.auth }), privateKey, 'no-such-kid'))).reason === 'unknown_key');
  ok('ES256 with NO key resolver is no_key_for_alg', (await v(signES256(claims({ sub: A.auth }), privateKey), { resolveJwk: null })).reason === 'no_key_for_alg');
  // Algorithm confusion: sign HS256 with the PUBLIC key material as the
  // secret. The HMAC path never reads the JWK, so this can only ever be
  // bad_signature (a secret is configured) or no_key_for_alg (none is).
  const confusion = signHS256(claims({ sub: A.auth }), JSON.stringify(publicJwk));
  ok('HS256 signed with the public JWK as secret is bad_signature (no algorithm confusion)', (await v(confusion)).reason === 'bad_signature');
  ok('…and no_key_for_alg when no HMAC secret is configured', (await v(confusion, { hmacSecret: null })).reason === 'no_key_for_alg');
  ok('a resolver that THROWS is key_unavailable (transport, not a bad token)', (await v(signES256(claims({ sub: A.auth }), privateKey), { resolveJwk: async () => { throw new Error('boom'); } })).reason === 'key_unavailable');

  // The reason never echoes the token. Every failing verdict, stringified,
  // must not contain the token or any of its three segments.
  const tokens = [aal1(A), forgedAal, svc, signES256(claims({ sub: A.auth }), other.privateKey)];
  let leaked = 0;
  for (const t of tokens) {
    const r = JSON.stringify(await v(t, { hmacSecret: 'wrong', resolveJwk: null }));
    for (const seg of [t, ...t.split('.')]) if (seg.length > 8 && r.includes(seg)) leaked++;
  }
  ok('no failing verdict contains the token or a segment of it', leaked === 0, leaked);
}

// ═══════════════════════════════════════════════════════════════════════════
section('2. the JWKS source: fetched once, cached, refreshed once on an unknown kid, cooled down');
{
  let calls = 0;
  let doc = { keys: [publicJwk] };
  let fail = false;
  const fetchFake = async () => { calls++; if (fail) throw new Error('network down'); return { ok: true, status: 200, json: async () => doc }; };
  let t = NOW_MS;
  const src = keysMod.createJwksSource({ url: 'https://jwks.test/auth/v1/.well-known/jwks.json', fetch: fetchFake, now: () => t });
  ok('resolves the key by kid after one fetch', (await src.resolve(KID, 'ES256'))?.kid === KID && calls === 1, calls);
  await src.resolve(KID, 'ES256');
  ok('a second resolve inside the TTL does not fetch again', calls === 1, calls);
  ok('an unknown kid triggers exactly ONE early refresh', (await src.resolve('rotated', 'ES256')) === null && calls === 2, calls);
  ok('another unknown kid inside the cooldown does NOT fetch (no JWKS-fetch loop)', (await src.resolve('rotated-again', 'ES256')) === null && calls === 2, calls);
  // A rotation lands: the document gains the new key, the cooldown passes.
  const rotated = { ...publicJwk, kid: 'rotated' };
  doc = { keys: [publicJwk, rotated] };
  t += keysMod.JWKS_REFRESH_COOLDOWN_MS + 1;
  ok('after the cooldown the rotated key is picked up', (await src.resolve('rotated', 'ES256'))?.kid === 'rotated' && calls === 3, calls);
  t += keysMod.JWKS_TTL_MS + 1;
  await src.resolve(KID, 'ES256');
  ok('the TTL expiring triggers a refresh', calls === 4, calls);
  ok('selectJwk with no kid and ONE candidate picks it', keysMod.selectJwk([publicJwk], null, 'ES256')?.kid === KID);
  ok('selectJwk with no kid and TWO candidates refuses (ambiguity is not guessed)', keysMod.selectJwk([publicJwk, rotated], null, 'ES256') === null);
  ok('jwksUrlFor and issuerFor derive from SUPABASE_URL, trailing slash tolerated',
    keysMod.jwksUrlFor('https://x.supabase.co/') === 'https://x.supabase.co/auth/v1/.well-known/jwks.json' && keysMod.issuerFor('https://x.supabase.co') === 'https://x.supabase.co/auth/v1');

  // The production constructor, driven with a fake fetch: a real ES256 token
  // verifies through it, and a network failure is key_unavailable.
  const prod = verifierMod.createSupabaseTokenVerifier({ env: { SUPABASE_URL: 'https://cedrus-test.invalid' }, fetch: fetchFake, now: () => t });
  const d = prod.describe();
  ok('createSupabaseTokenVerifier: JWKS on, HS256 off without SUPABASE_JWT_SECRET, issuer pinned', d.jwks === true && d.hs256 === false && d.issuer === ISSUER, d);
  ok('…and verifies an ES256 token through the fetched JWKS', (await prod.verify(signES256(claims({ sub: A.auth }), privateKey))).ok === true);
  ok('…and HS256 is no_key_for_alg on that deploy', (await prod.verify(aal2(A))).reason === 'no_key_for_alg');
  const withSecret = verifierMod.createSupabaseTokenVerifier({ env: { SUPABASE_URL: 'https://cedrus-test.invalid', SUPABASE_JWT_SECRET: TEST_SECRET }, fetch: fetchFake, now: () => t });
  ok('with SUPABASE_JWT_SECRET set, HS256 verifies too', (await withSecret.verify(aal2(A))).ok === true);
  fail = true; t += keysMod.JWKS_TTL_MS + 1;
  ok('JWKS unreachable ⇒ key_unavailable', (await prod.verify(signES256(claims({ sub: A.auth }), privateKey))).reason === 'key_unavailable');
  let threw = null;
  try { verifierMod.createTokenVerifier({}); } catch (e) { threw = e.message; }
  ok('a verifier with NO key at all refuses to construct', /no verification key/.test(threw || ''), threw);
}

// ═══════════════════════════════════════════════════════════════════════════
section('3. the assurance policy is one function, and it fails closed');
{
  ok('aal2 is enough', assuranceMod.assessAssurance({ aal: 'aal2' }).ok === true);
  ok('aal1 is refused as aal2_required', assuranceMod.assessAssurance({ aal: 'aal1' }).reason === 'aal2_required');
  ok('a missing aal claim is refused as aal_missing (never read as aal1, never as aal2)', assuranceMod.assessAssurance({}).reason === 'aal_missing');
  ok("an unknown level ('aal3') is refused as aal_unknown", assuranceMod.assessAssurance({ aal: 'aal3' }).reason === 'aal_unknown');
  ok('authMethods lists amr methods in order', JSON.stringify(assuranceMod.authMethods(claims({ sub: A.auth }))) === '["totp","password"]');
}

// ═══════════════════════════════════════════════════════════════════════════
section('4. the choke point over HTTP: aal1 refused where aal2 reaches, with every control');
{
  const mounted = await app.call('/session', { token: aal2(A) });
  const control = await app.call('/nope', { token: aal2(A) });
  ok('the router is mounted: /session is 200 with an aal2 token', mounted.status === 200, mounted);
  ok('CONTROL: an unmounted path under the same router and token is 404, not 200', control.status === 404, control.status);

  const none = await app.call('/session');
  ok('no Authorization header → 401 auth_required', none.status === 401 && none.json?.error === 'auth_required' && none.json?.reason === 'no_bearer', none.json);
  const basic = await app.call('/session', { rawAuth: 'Basic abc' });
  ok('a non-bearer scheme → 401 auth_required', basic.status === 401 && basic.json?.error === 'auth_required', basic.json);

  // THE A3.1 PROOF. Same subject, same signer, same everything — only the
  // assurance level differs.
  const first = await app.call('/session', { token: aal1(A) });
  ok('aal1 → 401 mfa_required, reason aal2_required', first.status === 401 && first.json?.error === 'mfa_required' && first.json?.reason === 'aal2_required', first.json);
  ok('CONTROL: aal2 for the SAME person → 200', mounted.status === 200 && mounted.json?.user?.id === A.id, mounted.json);
  ok('the aal1 refusal names the second step, not "sign in"', /second/.test(first.json?.message || ''), first.json);

  const expired = await app.call('/session', { token: signHS256(claims({ sub: A.auth, exp: nowSec - 1 }), TEST_SECRET) });
  ok('expired token → 401 auth_required, reason expired', expired.status === 401 && expired.json?.reason === 'expired', expired.json);
  const badSig = signHS256(claims({ sub: A.auth }), 'wrong-secret');
  const bad = await app.call('/session', { token: badSig });
  ok('bad signature → 401 auth_required, reason bad_signature', bad.status === 401 && bad.json?.reason === 'bad_signature', bad.json);
  ok('the 401 body never echoes the token', !bad.text.includes(badSig) && !badSig.split('.').some((seg) => bad.text.includes(seg)), bad.text);
  const svc = await app.call('/session', { token: signHS256({ iss: ISSUER, role: 'service_role', aud: 'authenticated', exp: nowSec + 3600 }, TEST_SECRET) });
  ok('a service_role JWT → 401 bad_role (a key is not a person)', svc.status === 401 && svc.json?.reason === 'bad_role', svc.json);

  const es = await app.call('/session', { token: signES256(claims({ sub: A.auth }), privateKey) });
  ok('ES256 (the production algorithm) reaches 200 through the same choke point', es.status === 200 && es.json?.user?.id === A.id, es.json);
  const esOther = await app.call('/session', { token: signES256(claims({ sub: A.auth }), other.privateKey) });
  ok('CONTROL: ES256 from a different pair → 401 bad_signature', esOther.status === 401 && esOther.json?.reason === 'bad_signature', esOther.json);

  // Proof A6: suspended is refused everywhere, with a present-unknown value
  // refused too and an active control.
  const cara = await app.call('/session', { token: aal2(CARA) });
  ok('suspended account with a valid aal2 token → 403 account_suspended', cara.status === 403 && cara.json?.error === 'account_suspended', cara.json);
  const erin = await app.call('/session', { token: aal2(ERIN) });
  ok("account_status 'banana' (present, unknown) → 403 account_suspended", erin.status === 403 && erin.json?.error === 'account_suspended', erin.json);
  ok('CONTROL: an active account with the identical token shape → 200', mounted.status === 200);
  const dan = await app.call('/session', { token: aal2(DAN) });
  ok('verified identity with no linked app_users row → 403 no_linked_account', dan.status === 403 && dan.json?.error === 'no_linked_account', dan.json);
  for (const path of ['/status', '/brief/today', '/workspace']) {
    const r = await app.call(path, { token: aal1(A) });
    ok(`aal1 is refused on ${path} too`, r.status === 401 && r.json?.error === 'mfa_required', r.json);
    const s = await app.call(path, { token: aal2(CARA) });
    ok(`suspended is refused on ${path} too`, s.status === 403 && s.json?.error === 'account_suspended', s.json);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('5. the non-JWT seam is closed in production and announced elsewhere');
{
  const gotrue = { getUser: async (t) => (t === 'tok-alice' ? { data: { user: { id: A.auth } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }) };
  const test = boot({ db: dbA, env: COS_ENV, now: () => new Date(NOW_MS), verifier, auth: gotrue, production: false });
  const prod = boot({ db: dbA, env: COS_ENV, now: () => new Date(NOW_MS), verifier, auth: gotrue, production: true });
  const open = await test.call('/session', { token: 'tok-alice' });
  ok('CONTROL: outside production an opaque token the fake GoTrue accepts reaches 200 (the pre-A3.1 suites)', open.status === 200 && open.json?.session?.aal === null, open.json);
  const closed = await prod.call('/session', { token: 'tok-alice' });
  ok('in production the SAME opaque token is 401 malformed — the seam is shut', closed.status === 401 && closed.json?.reason === 'malformed', closed.json);
  const jwtStill = await test.call('/session', { token: aal1(A) });
  ok('a real JWT NEVER takes the seam: aal1 is still mfa_required even with the seam open', jwtStill.status === 401 && jwtStill.json?.error === 'mfa_required', jwtStill.json);
  const jwtProd = await prod.call('/session', { token: aal2(A) });
  ok('CONTROL: in production the verified aal2 JWT reaches 200', jwtProd.status === 200, jwtProd.json);
  await test.close(); await prod.close();
}

// ═══════════════════════════════════════════════════════════════════════════
section('6. /session — who am I, from the verified session and the closed vocabulary');
{
  const r = (await app.call('/session', { token: aal2(A) })).json;
  ok('user is the linked app_users row, curated', r.user.id === A.id && r.user.name === 'Alice' && r.user.display_name === 'Alice A.' && r.user.timezone === 'America/New_York' && r.user.role === 'admin', r.user);
  ok('session reports aal2, the methods, and expiry from the token', r.session.aal === 'aal2' && JSON.stringify(r.session.methods) === '["totp","password"]' && r.session.expires_at === new Date((nowSec + 3600) * 1000).toISOString() && r.session.session_id === 'sess-' + A.auth.slice(0, 8), r.session);
  ok('capabilities: granted true, explicit false, ABSENT false — the four names and no others',
    JSON.stringify(r.capabilities) === JSON.stringify({ run_agents: true, write_workspace: false, receive_brief: true, receive_sms: false }), r.capabilities);
  ok('preferences.skin is the null slot', r.preferences && r.preferences.skin === null && Object.keys(r.preferences).length === 1, r.preferences);
  ok('no raw row fields leak (no phone, no auth_user_id, no account_status)', !('phone' in r.user) && !('auth_user_id' in r.user) && !('account_status' in r.user), Object.keys(r.user));
  const b = (await app.call('/session', { token: aal2(B) })).json;
  ok('CONTROL: Bob, with no capability rows, gets all four false — and is Bob', b.user.id === B.id && Object.values(b.capabilities).every((v) => v === false), b);

  // A capabilities read that ERRORS is a 503, never "all false".
  dbA.faults.set('user_capabilities', { code: '42P01', message: 'relation does not exist' });
  const failed = await app.call('/session', { token: aal2(A) });
  dbA.faults.delete('user_capabilities');
  ok('a failed capability read → 503 capabilities_unreadable (not a 200 of falses)', failed.status === 503 && failed.json?.error === 'capabilities_unreadable', failed.json);
  ok('CONTROL: the same request without the fault → 200', (await app.call('/session', { token: aal2(A) })).status === 200);
}

// ═══════════════════════════════════════════════════════════════════════════
section('7. /workspace — two users, two tokens: each sees only its own rows, and DOES see its own');
{
  const a = await app.call('/workspace', { token: aal2(A) });
  const b = await app.call('/workspace', { token: aal2(B) });
  ok('Alice: 200, available', a.status === 200 && a.json?.available === true, a.json);
  ok('Bob:   200, available', b.status === 200 && b.json?.available === true, b.json);
  const aIds = a.json.workstreams.map((w) => w.id);
  const bIds = b.json.workstreams.map((w) => w.id);
  ok("Alice's workstreams are exactly hers, newest first", JSON.stringify(aIds) === JSON.stringify([WS_A2, WS_A1]), aIds);
  ok("Bob's workstreams are exactly his", JSON.stringify(bIds) === JSON.stringify([WS_B1]), bIds);
  ok("Bob's response contains NONE of Alice's ids, in any of the three lists",
    !JSON.stringify(b.json).includes(WS_A1) && !JSON.stringify(b.json).includes(WS_A2) && !JSON.stringify(b.json).includes('ol-a1') && !JSON.stringify(b.json).includes('dc-a1'));
  ok("Alice's response contains NONE of Bob's ids", !JSON.stringify(a.json).includes(WS_B1) && !JSON.stringify(a.json).includes('ol-b1') && !JSON.stringify(a.json).includes('dc-b'));
  ok('CONTROL: both are non-empty (a broken endpoint would return nothing to both)', aIds.length === 2 && bIds.length === 1 && a.json.open_loops.length === 1 && b.json.decisions.length === 2);
  ok('rows carry exactly the reader\'s projection (READER_COLUMNS), no user_id',
    JSON.stringify(Object.keys(a.json.workstreams[0])) === JSON.stringify([...reader.READER_COLUMNS.workstreams]) &&
    JSON.stringify(Object.keys(a.json.open_loops[0])) === JSON.stringify([...reader.READER_COLUMNS.open_loops]) &&
    JSON.stringify(Object.keys(b.json.decisions[0])) === JSON.stringify([...reader.READER_COLUMNS.decisions]), Object.keys(a.json.workstreams[0]));
  ok('limits are the reader\'s own caps', a.json.limits.workstreams === reader.COS_LIMITS.workstreams && a.json.limits.open_loops === reader.COS_LIMITS.open_loops && a.json.limits.decisions === reader.COS_LIMITS.decisions, a.json.limits);

  // What actually went over the wire: every CoS request carried the caller's
  // user_id filter. This is the reader's real query, not a builder fake.
  const wsReqs = cos.requests.filter((r) => r.path === '/rest/v1/workstreams');
  ok('every workstreams request to CoS carried a user_id=eq.<caller> filter',
    wsReqs.length >= 2 && wsReqs.every((r) => r.params.some(([k, v]) => k === 'user_id' && /^eq\./.test(v))), wsReqs.map((r) => r.search));
  ok('…one for Alice and one for Bob, each with its OWN id',
    wsReqs.some((r) => r.params.some(([k, v]) => k === 'user_id' && v === 'eq.' + A.cos)) && wsReqs.some((r) => r.params.some(([k, v]) => k === 'user_id' && v === 'eq.' + B.cos)));
  // SELF-CHECK on the double: with NO filter it returns everyone's rows, so
  // "Bob got only his" is the filter's doing and not the double's emptiness.
  const unfiltered = await (await fetch(cos.url + '/rest/v1/workstreams?select=id')).json();
  ok('SELF-CHECK: the PostgREST double returns all three workstreams when unfiltered', unfiltered.length === 3, unfiltered);

  // A3 regression guard: a forged id in the query, and in headers, is ignored.
  const forged = await app.call(`/workspace?user_id=${B.id}&cos_user_id=${B.cos}&auth_user_id=${B.auth}`, { token: aal2(A), headers: { 'x-user-id': B.id, 'x-cedrus-user': B.cos } });
  ok("a forged user id in query and headers is ignored — Alice's token still returns Alice's rows",
    forged.status === 200 && JSON.stringify(forged.json.workstreams.map((w) => w.id)) === JSON.stringify([WS_A2, WS_A1]) && !JSON.stringify(forged.json).includes(WS_B1), forged.json);

  const fay = await app.call('/workspace', { token: aal2(FAY) });
  ok('a person with no CoS link gets available:false cos_not_linked (honest, not empty)', fay.status === 200 && fay.json?.available === false && fay.json?.reason === 'cos_not_linked', fay.json);
  const disarmed = boot({ db: dbA, env: {}, now: () => new Date(NOW_MS), verifier });
  const dis = await disarmed.call('/workspace', { token: aal2(A) });
  ok('a deploy with no CoS credentials gets available:false cos_disarmed', dis.status === 200 && dis.json?.available === false && dis.json?.reason === 'cos_disarmed', dis.json);
  await disarmed.close();

  // A CoS read that fails is a 503, never an empty 200.
  cos.faults.set('open_loops', { status: 500, body: { code: '42703', message: 'column does not exist' } });
  const broken = await app.call('/workspace', { token: aal2(A) });
  cos.faults.delete('open_loops');
  ok('a failed CoS read → 503 workspace_unreadable (fail closed)', broken.status === 503 && broken.json?.error === 'workspace_unreadable', broken.json);
  ok('CONTROL: the same request without the fault → 200', (await app.call('/workspace', { token: aal2(A) })).status === 200);
}

// ═══════════════════════════════════════════════════════════════════════════
section("8. /brief/today — the real stored composition for this person, or an honest 'no brief today'");
{
  const a = await app.call('/brief/today', { token: aal2(A) });
  ok('Alice: available, dated today in HER timezone', a.status === 200 && a.json?.available === true && a.json.date === '2026-09-09' && a.json.timezone === 'America/New_York', a.json);
  ok("it is her ok row, not the newer ERROR row", a.json.id === BRIEF_A_ID && a.json.generated_at === GEN_AT_A && a.json.model === 'test-model', { id: a.json.id });
  const brief = a.json.brief;
  ok('brief is today_brief_v1 as the composer validated it', brief.schema_version === compose.BRIEF_SCHEMA_VERSION && brief.summary === "Alice: land the auth API." && brief.model_disclaimer === compose.MODEL_DISCLAIMER && brief.composed_by === compose.COMPOSED_BY && brief.source_system === 'cedrus', brief);
  ok('top_priorities cite a real record of hers', brief.top_priorities.length === 1 && brief.top_priorities[0].source_refs[0].id === WS_A1);
  ok('workspace_state is the computed block (one workstream with no next action, no target date; an agent run today)',
    Array.isArray(brief.workspace_state) && brief.workspace_state.some((l) => /1 workstream has no next action/.test(l)) && brief.workspace_state.some((l) => /agent run was today/.test(l)), brief.workspace_state);
  ok("todays_program is the computed block from her program items", Array.isArray(brief.todays_program) && brief.todays_program.length === 3 && /Miami Man 2026/.test(brief.todays_program[0]), brief.todays_program);
  ok('expires_at and schema_version come from the row', typeof a.json.expires_at === 'string' && a.json.schema_version === compose.BRIEF_SCHEMA_VERSION);

  const b = await app.call('/brief/today', { token: aal2(B) });
  ok("Bob: available:false not_generated_today, naming his latest brief's date — never Alice's", b.status === 200 && b.json?.available === false && b.json.reason === 'not_generated_today' && b.json.latest_generated_at === GEN_AT_B && b.json.timezone === 'Europe/Madrid', b.json);
  ok("Bob's response contains nothing of Alice's brief", !JSON.stringify(b.json).includes(BRIEF_A_ID) && !JSON.stringify(b.json).includes('land the auth API'));
  const fay = await app.call('/brief/today', { token: aal2(FAY) });
  ok('unlinked person → available:false cos_not_linked', fay.json?.available === false && fay.json?.reason === 'cos_not_linked', fay.json);

  const briefReqs = cos.requests.filter((r) => r.path === '/rest/v1/today_briefs');
  ok('every today_briefs request carried the caller\'s user_id filter and asked for exactly BRIEF_READ_COLUMNS',
    briefReqs.length >= 2 && briefReqs.every((r) => r.params.some(([k, v]) => k === 'user_id' && /^eq\./.test(v)) && r.params.some(([k, v]) => k === 'select' && v === ifaceMod.BRIEF_READ_COLUMNS.join(','))), briefReqs.map((r) => r.search));

  // "Today" is the person's day, not the server's UTC day.
  ok('resolveDate: 22:30Z on the 8th is the 9th in Madrid', ifaceMod.resolveDate(new Date('2026-09-08T22:30:00.000Z'), 'Europe/Madrid').date === '2026-09-09');
  ok('resolveDate: an unknown zone falls back to UTC and SAYS so', JSON.stringify(ifaceMod.resolveDate(new Date(NOW_MS), 'Not/AZone')) === JSON.stringify({ date: '2026-09-09', timezone: 'UTC' }));

  cos.faults.set('today_briefs', { status: 500, body: { code: '42P01', message: 'relation missing' } });
  const broken = await app.call('/brief/today', { token: aal2(A) });
  cos.faults.delete('today_briefs');
  ok('a failed today_briefs read → 503 brief_unreadable, not "no brief today"', broken.status === 503 && broken.json?.error === 'brief_unreadable', broken.json);
}

// ═══════════════════════════════════════════════════════════════════════════
section('9. /status — per-service state for THIS person, from rows and the Engine\'s own reads');
{
  const a = (await app.call('/status', { token: aal2(A) })).json;
  ok('generated_at is the injected clock', a.generated_at === NOW_ISO, a.generated_at);
  ok('brief: settings row, enabled, address, hour, capability, and TODAY = sent from the per-user ledger',
    a.services.brief.settings_row === true && a.services.brief.enabled === true && a.services.brief.email === 'alice@example.test' && a.services.brief.hour_utc === 11 &&
    a.services.brief.timezone === 'America/New_York' && a.services.brief.capability === true && a.services.brief.today === 'sent' && a.services.brief.sent_at === '2026-09-09T11:00:07.000Z', a.services.brief);
  ok('cos: linked and the reader armed', a.services.cos.linked === true && a.services.cos.reader === 'armed', a.services.cos);
  ok("programs: today's items counted through the rpc", a.services.programs.state === 'ok' && a.services.programs.today_items === 2 && a.services.programs.error === null, a.services.programs);
  ok('sms: phone linked, consent recorded, capability absent ⇒ false', a.services.sms.phone_linked === true && a.services.sms.consent_recorded_at === '2026-07-10T12:00:00.000Z' && a.services.sms.opted_out === false && a.services.sms.capability === false, a.services.sms);
  ok('agents: capability, ok, last run from her CoS agent_runs', a.services.agents.capability === true && a.services.agents.state === 'ok' && a.services.agents.last_run_at === '2026-09-09T09:00:00.000Z', a.services.agents);
  const rpcCalls = dbA.seen.filter((s) => s.rpc === 'todays_program_items');
  ok('the program read named HER app_users id, never a request value', rpcCalls.length >= 1 && rpcCalls.every((c) => c.args.p_user_id === A.id), rpcCalls);

  const b = (await app.call('/status', { token: aal2(B) })).json;
  ok('CONTROL Bob: not enabled, not sent, zero program items, no phone, no runs — and not Alice\'s values',
    b.services.brief.enabled === false && b.services.brief.today === 'not_sent' && b.services.brief.email === null && b.services.programs.today_items === 0 &&
    b.services.sms.phone_linked === false && b.services.agents.state === 'ok' && b.services.agents.last_run_at === null && b.services.brief.timezone === 'Europe/Madrid', b.services);
  const f = (await app.call('/status', { token: aal2(FAY) })).json;
  ok('Fay (no settings row): settings_row false, today unknown, cos unlinked, agents unlinked, timezone from app_users',
    f.services.brief.settings_row === false && f.services.brief.today === 'unknown' && f.services.cos.linked === false && f.services.agents.state === 'unlinked' && f.services.brief.timezone === 'America/Chicago', f.services);

  dbA.faults.set('rpc:todays_program_items', { code: '42883', message: 'function does not exist' });
  const pr = (await app.call('/status', { token: aal2(A) })).json;
  dbA.faults.delete('rpc:todays_program_items');
  ok('an unreadable program read is reported as such, with its code, never as zero items', pr.services.programs.state === 'unreadable' && pr.services.programs.today_items === null && pr.services.programs.error === '42883', pr.services.programs);
  dbA.faults.set('user_settings', { code: '42P01', message: 'relation missing' });
  const st = await app.call('/status', { token: aal2(A) });
  dbA.faults.delete('user_settings');
  ok('an unreadable user_settings → 503 settings_unreadable', st.status === 503 && st.json?.error === 'settings_unreadable', st.json);
}

// ═══════════════════════════════════════════════════════════════════════════
section('10. pins: the vocabulary, the brief columns, the shapes file, the mount order');
{
  // The closed vocabulary is COPIED from the migration's CHECK constraint.
  // Read the constraint out of the migration file itself so the copy cannot
  // drift (Lesson 20: read the system's own description of itself).
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260830120000_multiuser_foundation.sql', import.meta.url), 'utf8');
  const m = sql.match(/check\s*\(\s*capability\s+in\s*\(([^)]*)\)\s*\)/i);
  const fromSql = m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : null;
  ok('CAPABILITY_VOCABULARY equals the migration\'s CHECK list, in order', fromSql && JSON.stringify(fromSql) === JSON.stringify([...capsMod.CAPABILITY_VOCABULARY]), { fromSql, code: capsMod.CAPABILITY_VOCABULARY });

  // Every column /brief/today asks CoS for is one the Engine already reads
  // (READER_COLUMNS.today_briefs, schema-checked) or writes (buildBriefRow).
  const writtenKeys = Object.keys(writer.buildBriefRow({ userId: A.cos, brief: cosTables.today_briefs[0].structured_output, minimizedInput: {}, model: 'm', latencyMs: 1 }));
  const known = new Set([...reader.READER_COLUMNS.today_briefs, ...writtenKeys]);
  const unknown = ifaceMod.BRIEF_READ_COLUMNS.filter((c) => !known.has(c));
  ok('BRIEF_READ_COLUMNS ⊆ READER_COLUMNS.today_briefs ∪ keys(buildBriefRow)', unknown.length === 0, unknown);
  ok('…and it actually includes structured_output and expires_at', ifaceMod.BRIEF_READ_COLUMNS.includes('structured_output') && ifaceMod.BRIEF_READ_COLUMNS.includes('expires_at'));

  // Every key each handler returns (two levels deep) is declared in the
  // shapes file. Loose on purpose — A3.3 freezes the shapes properly.
  const dts = fs.readFileSync(new URL('../src/routes/api/interface.shapes.d.ts', import.meta.url), 'utf8');
  const declared = (name) => new RegExp(`(^|[\\s{;])${name}\\??:`).test(dts);
  const responses = {
    session: (await app.call('/session', { token: aal2(A) })).json,
    status: (await app.call('/status', { token: aal2(A) })).json,
    brief_today: (await app.call('/brief/today', { token: aal2(A) })).json,
    brief_today_unavailable: (await app.call('/brief/today', { token: aal2(B) })).json,
    workspace: (await app.call('/workspace', { token: aal2(A) })).json,
    workspace_unavailable: (await app.call('/workspace', { token: aal2(FAY) })).json,
  };
  const missing = [];
  const walk = (obj, path, depth) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth === 0) return;
    for (const k of Object.keys(obj)) {
      if (!declared(k)) missing.push(path + '.' + k);
      walk(obj[k], path + '.' + k, depth - 1);
    }
  };
  for (const [name, body] of Object.entries(responses)) walk(body, name, 3);
  ok('every key each handler returns (three levels) is declared in interface.shapes.d.ts', missing.length === 0, missing);
  for (const k of ['error', 'reason', 'message']) ok(`the error shape declares ${k}`, declared(k));

  // The mount: /api/interface is registered BEFORE the authed /api catch-all,
  // or the catch-all's own requireUser would answer first. A property only
  // src/index.js can tell.
  const idx = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const at = idx.indexOf("app.use('/api/interface', interfaceRouter)");
  const catchAll = idx.indexOf("app.use('/api', apiRouter)");
  ok("src/index.js mounts '/api/interface' before the '/api' catch-all", at !== -1 && catchAll !== -1 && at < catchAll, { at, catchAll });
  ok('INTERFACE_ROUTES names the four reads', JSON.stringify([...ifaceMod.INTERFACE_ROUTES]) === JSON.stringify(['/session', '/status', '/brief/today', '/workspace']));
}

// ═══════════════════════════════════════════════════════════════════════════
await app.close();
await cos.close();
p('');
if (failures) { p(`${failures} CHECK(S) FAILED`); process.exit(1); }
p('ALL BUNDLE 47 CHECKS PASSED');
process.exit(0);
