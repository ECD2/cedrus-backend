// Bundle 38 — Chief of Staff daily brief (jobs/cosDailyBrief.js).
// Run: bun test/cos-daily-brief.test.mjs
//
// What runs REAL here: the real job entry point runCosDailyBrief() exactly as
// the scheduler calls it, the real composer (services/cos/compose.js), the real
// renderer, the real ledger decision logic, the real Resend transport, the real
// client export surface, and the REAL scheduler guard() with the real
// JOB_REGISTRY. Nothing about the decisions under test is reimplemented here.
//
// Two seams are injected, each for a stated reason:
//   • the CoS gather + the model call — so a brief can be composed from a fixed
//     record set with no network and no CoS project. The fixture IS the set of
//     records "actually supplied", which is what makes the citation test mean
//     something.
//   • the ledger's `db` — a programmable fake Postgres with a REAL unique
//     constraint on system_flags.key, so the double-send test exercises the
//     23505 path rather than a mocked boolean.
//
// THE LOAD-BEARING ASSERTIONS, all four of them count sends on the wire:
//   • DISARMED             → transport factory never even consulted, ZERO sends
//   • invented citation    → brief REJECTED, ZERO sends, ZERO writebacks
//   • second run same day  → ledger 23505, ZERO additional sends
//   • budget tripped       → guard() never invokes the job, ZERO sends
//
// A "send" is counted at the fetch boundary inside the real ResendTransport, so
// every one of these is "did an HTTP request to Resend happen", not "did a
// function return false".
//
// Coverage:
//   • disarmed / partial-config / armed mode announcements
//   • dry run composes but does not send, does not write back, does not claim
//   • citation validation: unknown id, wrong type, zero-citation priority
//   • email records ARE citable (the deliberate extension) and DO reach input
//   • the 3-priority ceiling, urgency enum, confidence range
//   • 240-char excerpt bound and the 24k total with captures-first trimming
//   • no prompt / no raw response / no full body reaches the written row
//   • ledger: claim, double-send block, stuck-claim refusal, release-on-refusal
//   • Resend transport triple gate, and the verified sending subdomain
//   • the client module's export surface has no second write verb
//   • scheduler: cos-daily-brief is registered outbound and the gate stops it

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';


// DYNAMIC imports, deliberately. Static `import` is hoisted and evaluated
// BEFORE the process.env assignments above, so config.js's required() would
// abort the suite with "missing required env var SUPABASE_URL". Bundles 36 and
// 37 hit the same wall and solved it the same way; this is why the run-all.sh
// registration says "bun explicitly" — top-level await needs it.
const { runCosDailyBrief, isDryRun, isWritebackOnly, briefMode, briefModel } = await import('../src/jobs/cosDailyBrief.js');
const { guard, JOB_REGISTRY } = await import('../src/jobs/scheduler.js');
const compose = await import('../src/services/cos/compose.js');
const ledger = await import('../src/services/cos/ledger.js');
const clientMod = await import('../src/services/cos/client.js');
const readerCols = await import('../src/services/cos/reader.js');
const { ResendTransport, createResendTransport, deliveryEnv, DEFAULT_FROM } = await import('../src/services/cos/resendTransport.js');
const { renderBriefEmail, esc } = await import('../src/services/cos/renderer.js');

let failures = 0;
const p = (...a) => console.log(...a);
function ok(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}
const section = (n) => { p(''); p('— ' + n + ' —'); };

// ── fixtures: THE set of records "actually supplied" ────────────────────────
const IDS = {
  ws: '11111111-1111-1111-1111-111111111111',
  loop: '22222222-2222-2222-2222-222222222222',
  dec: '33333333-3333-3333-3333-333333333333',
  cap: '44444444-4444-4444-4444-444444444444',
  run: '55555555-5555-5555-5555-555555555555',
  mail: '66666666-6666-6666-6666-666666666666',
  anal: '77777777-7777-7777-7777-777777777777',
};
const GHOST = '99999999-9999-9999-9999-999999999999';
const SECRET_BODY = 'the full body text that must never be stored anywhere';

function rawData(over = {}) {
  return {
    workstreams: [{ id: IDS.ws, name: 'Cedrus launch', status: 'active', priority: 'high', health: 'ok', archived_at: null, created_at: '2026-08-16T00:00:00Z' }],
    open_loops: [{ id: IDS.loop, title: 'Confirm venue', status: 'open', priority: 'high', due_at: '2026-08-16T00:00:00Z', workstream_id: IDS.ws, created_at: '2026-08-15T00:00:00Z' }],
    decisions: [{ id: IDS.dec, question: 'Miami or NYC?', status: 'open', recommendation: 'Miami', recommendation_source: 'agent', created_at: '2026-08-15T00:00:00Z' }],
    captures: [{ id: IDS.cap, original_text: SECRET_BODY + ' '.repeat(5) + 'x'.repeat(600), created_at: '2026-08-17T00:00:00Z' }],
    agent_runs: [{ id: IDS.run, agent: 'scout', model: 'gpt', objective: 'survey', verification_state: 'self_reported', unresolved_findings: ['unclear'], original_body: SECRET_BODY + 'y'.repeat(600), created_at: '2026-08-17T00:00:00Z' }],
    email_messages: [{ id: IDS.mail, subject: 'Invoice overdue', sender_address: 'ap@vendor.test', original_recipient: 'support@cedrus.life', received_at: '2026-08-17T06:00:00Z', plain_text_excerpt: SECRET_BODY + 'z'.repeat(600), classification_status: 'unclassified', owner_review_status: 'unreviewed', has_attachments: false, is_demo: false }],
    email_ai_analyses: [{ id: IDS.anal, email_message_id: IDS.mail, status: 'completed', generation_mode: 'ai', suggested_classification: 'needs_response', suggested_priority: 'high', summary: 'Vendor wants payment', risks_or_uncertainties: ['amount unverified'], confidence: 0.7, created_at: '2026-08-17T06:05:00Z' }],
    ...over,
  };
}

function briefCiting(refs, over = {}) {
  return {
    schema_version: 'today_brief_v1',
    generated_at: '2026-08-17T11:00:00Z',
    summary: 'One overdue invoice and a venue decision.',
    top_priorities: [{
      rank: 1, title: 'Pay the vendor', reason: 'Invoice arrived and is overdue',
      recommended_action: 'Confirm the amount, then pay', urgency: 'high', confidence: 0.6,
      source_refs: refs,
    }],
    decisions_to_make: [], people_or_dependencies_waiting: [], risks: [],
    not_enough_evidence: [], model_disclaimer: 'ignored — overwritten by validateBrief',
    ...over,
  };
}

const ARMED_ENV = {
  COS_SUPABASE_URL: 'https://cos.invalid',
  COS_SERVICE_ROLE_KEY: 'cos-key',
  COS_BRIEF_LIVE: 'true',
  RESEND_API_KEY: 're_test',
  COS_BRIEF_TO: 'owner@example.test',
  COS_USER_ID: 'cos-owner-uuid',
};

// Every send is counted at the fetch boundary of the REAL ResendTransport.
let sends = [];
const countingFetch = async (url, init) => {
  sends.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ id: 'resend-msg-1' }) };
};

// A programmable fake Postgres for system_flags, with a REAL unique key.
function fakeDb() {
  const rows = new Map();
  return {
    rows,
    from(table) {
      if (table !== 'system_flags') throw new Error('unexpected table: ' + table);
      const api = {
        _key: null,
        select() { return api; },
        eq(_col, val) { api._key = val; return api; },
        maybeSingle: async () => ({ data: rows.has(api._key) ? { value: rows.get(api._key) } : null, error: null }),
        insert: async (row) => {
          if (rows.has(row.key)) return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          rows.set(row.key, row.value);
          return { error: null };
        },
        update: (patch) => ({ eq: async (_c, val) => { rows.set(val, patch.value); return { error: null } } }),
        delete: () => ({ eq: async (_c, val) => { rows.delete(val); return { error: null } } }),
      };
      return api;
    },
  };
}

function makeDeps({ data = rawData(), brief = null, db = fakeDb(), modelThrows = false } = {}) {
  const written = [];
  const deps = {
    gather: async () => ({ ok: true, data }),
    callModel: async () => {
      if (modelThrows) throw new Error('upstream boom');
      return { parsed: brief, model: 'gpt-4.1-mini', usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
    },
    transportFactory: (env) => createResendTransport(env, { fetchImpl: countingFetch }),
    claim: (a) => ledger.claimSend({ ...a, db }),
    mark: (a) => ledger.markSent({ ...a, db }),
    release: (a) => ledger.releaseClaim({ ...a, db }),
    write: async (a) => { written.push(a); return { id: 'cos-brief-1', skipped: false, reason: null }; },
    logRun: async () => {},
  };
  return { deps, written, db };
}

const reset = () => { sends = []; };

// Capture what the job ANNOUNCES. The mode line is a product surface here, not
// decoration: it is how a human knows which rung they are standing on, and
// Lesson 7 is precisely about a guard that cannot say which mode it ran in.
// logger.emit() routes through console.log / warn / error, so all three are
// intercepted.
async function captureLogs(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const grab = (x) => { lines.push(String(x)); };
  console.log = grab; console.warn = grab; console.error = grab;
  try { await fn(); } finally { Object.assign(console, orig); }
  return lines
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}
const eventNamed = (evts, name) => evts.find((e) => e.event === name) || null;

// ═══════════════════════════════════════════════════════════════════════════
section('DISARMED — the default state sends nothing');
{
  reset();
  let factoryCalls = 0;
  const { deps } = makeDeps({ brief: briefCiting([{ type: 'email_message', id: IDS.mail }]) });
  deps.transportFactory = (env) => { factoryCalls++; return createResendTransport(env, { fetchImpl: countingFetch }); };
  deps.gather = async () => { throw new Error('gather must never run while disarmed'); };

  const r = await runCosDailyBrief({ env: {}, now: new Date('2026-08-17T11:00:00Z'), deps });
  ok('disarmed: job reports ran:false / reason disarmed', r.ran === false && r.reason === 'disarmed', r);
  ok('disarmed: ZERO sends on the wire', sends.length === 0, sends.length);
  ok('disarmed: transport factory never consulted', factoryCalls === 0, factoryCalls);
  ok('disarmed: nothing written back', r.written === false);

  // Partial config is DISARMED too, and is a distinct reportable state.
  const partial = clientMod.cosEnv({ COS_SUPABASE_URL: 'https://cos.invalid' });
  ok('partial config: armed false, partial true', partial.armed === false && partial.partial === true, partial);
  const both = clientMod.cosEnv(ARMED_ENV);
  ok('both credentials: armed true, partial false', both.armed === true && both.partial === false);
}

// ═══════════════════════════════════════════════════════════════════════════
section('citations — a brief may cite ONLY records actually supplied');
{
  const input = compose.enforceTotalSize(compose.minimizeInput(rawData(), Date.parse('2026-08-17T11:00:00Z')));

  const good = compose.validateBrief(briefCiting([
    { type: 'open_loop', id: IDS.loop }, { type: 'email_message', id: IDS.mail },
  ]), input);
  ok('CONTROL: a brief citing only supplied records is ACCEPTED', good.ok === true, good.detail);

  // NOTE the `detail` assertions. Category alone cannot tell these two apart:
  // if the unknown-id branch is deleted, `known.get()` returns undefined and
  // the WRONG-TYPE branch catches the same input with the same category. The
  // mutation run proved that mask exists (a deleted unknown-id return left the
  // suite green), so the branch is pinned by its own message.
  const ghost = compose.validateBrief(briefCiting([{ type: 'open_loop', id: GHOST }]), input);
  ok('invented record id ⇒ invalid_citations, via the UNKNOWN-ID branch',
    ghost.ok === false && ghost.category === 'invalid_citations' && ghost.detail === 'cites an unknown record id', ghost);

  const wrongType = compose.validateBrief(briefCiting([{ type: 'workstream', id: IDS.loop }]), input);
  ok('real id cited as the WRONG type ⇒ invalid_citations, via the WRONG-TYPE branch',
    wrongType.ok === false && wrongType.category === 'invalid_citations' && wrongType.detail === 'cites a record as the wrong type', wrongType);

  const nothing = compose.validateBrief(briefCiting([]), input);
  ok('a priority citing NOTHING ⇒ rejected', nothing.ok === false, nothing);

  // The deliberate extension: both email types are citable.
  for (const [type, id] of [['email_message', IDS.mail], ['email_analysis', IDS.anal]]) {
    const r = compose.validateBrief(briefCiting([{ type, id }]), input);
    ok(`${type} is a citable source type`, r.ok === true, r.detail);
  }
  // ...and a ghost of the NEW types is rejected exactly like the old ones.
  const ghostMail = compose.validateBrief(briefCiting([{ type: 'email_message', id: GHOST }]), input);
  ok('invented email_message id ⇒ still invalid_citations', ghostMail.ok === false && ghostMail.category === 'invalid_citations');

  // Citations in the non-priority sections are validated too.
  const badRisk = compose.validateBrief(briefCiting(
    [{ type: 'open_loop', id: IDS.loop }],
    { risks: [{ risk: 'invented', source_refs: [{ type: 'decision', id: GHOST }] }] },
  ), input);
  ok('an invented citation inside risks[] is caught', badRisk.ok === false && badRisk.category === 'invalid_citations');

  // And the whole path: a rejected brief sends nothing and writes nothing.
  reset();
  const { deps, written } = makeDeps({ brief: briefCiting([{ type: 'open_loop', id: GHOST }]) });
  const r = await runCosDailyBrief({ env: ARMED_ENV, now: new Date('2026-08-17T11:00:00Z'), deps });
  ok('END TO END: invented citation ⇒ ZERO sends', sends.length === 0, sends.length);
  ok('END TO END: invented citation ⇒ ZERO writebacks', written.length === 0, written.length);
  ok('END TO END: reported as invalid_citations', r.reason === 'invalid_citations', r.reason);
}

// ═══════════════════════════════════════════════════════════════════════════
section('contract — the CoS today_brief_v1 shape is honoured');
{
  const input = compose.enforceTotalSize(compose.minimizeInput(rawData(), Date.parse('2026-08-17T11:00:00Z')));
  const refs = [{ type: 'open_loop', id: IDS.loop }];

  ok('schema_version is exactly today_brief_v1', compose.BRIEF_SCHEMA_VERSION === 'today_brief_v1');
  const wrongVersion = compose.validateBrief(briefCiting(refs, { schema_version: 'today_brief_v2' }), input);
  ok('a different schema_version is rejected', wrongVersion.ok === false);

  const four = compose.validateBrief(briefCiting(refs, {
    top_priorities: [1, 2, 3, 4].map((n) => briefCiting(refs).top_priorities[0]),
  }), input);
  ok('FOUR priorities breaches the ceiling of 3', four.ok === false && /too many/.test(four.detail), four);

  const three = compose.validateBrief(briefCiting(refs, {
    top_priorities: [1, 2, 3].map((n) => ({ ...briefCiting(refs).top_priorities[0], rank: n })),
  }), input);
  ok('CONTROL: exactly three priorities is allowed', three.ok === true, three.detail);

  ok('urgency outside the enum is rejected',
    compose.validateBrief(briefCiting(refs, { top_priorities: [{ ...briefCiting(refs).top_priorities[0], urgency: 'spicy' }] }), input).ok === false);
  ok('confidence > 1 is rejected',
    compose.validateBrief(briefCiting(refs, { top_priorities: [{ ...briefCiting(refs).top_priorities[0], confidence: 1.5 }] }), input).ok === false);
  ok('confidence < 0 is rejected',
    compose.validateBrief(briefCiting(refs, { top_priorities: [{ ...briefCiting(refs).top_priorities[0], confidence: -0.1 }] }), input).ok === false);

  const accepted = compose.validateBrief(briefCiting(refs), input);
  ok('the disclaimer is OURS, not the model\'s',
    accepted.brief.model_disclaimer === compose.MODEL_DISCLAIMER, accepted.brief.model_disclaimer);
  ok('provenance marker records that Cedrus composed it',
    accepted.brief.composed_by === compose.COMPOSED_BY && accepted.brief.source_system === 'cedrus');

  // The JSON schema handed to the model must offer the email types, or the
  // model can never legally cite the thing this whole job exists for.
  const schema = compose.briefJsonSchema();
  const enumTypes = schema.properties.top_priorities.items.properties.source_refs.items.properties.type.enum;
  ok('schema exposes all 5 CoS ref types', ['workstream', 'open_loop', 'decision', 'capture', 'agent_run'].every((t) => enumTypes.includes(t)), enumTypes);
  ok('schema exposes both email ref types', enumTypes.includes('email_message') && enumTypes.includes('email_analysis'), enumTypes);
  ok('schema caps priorities at 3', schema.properties.top_priorities.maxItems === 3);
}

// ═══════════════════════════════════════════════════════════════════════════
section('input bounding — 240-char excerpts, 24k total, captures trimmed first');
{
  const min = compose.minimizeInput(rawData(), Date.parse('2026-08-17T11:00:00Z'));

  ok('capture excerpt bounded to 240', min.captures[0].excerpt.length <= 240, min.captures[0].excerpt.length);
  ok('agent-run excerpt bounded to 240', min.agent_runs[0].excerpt.length <= 240, min.agent_runs[0].excerpt.length);
  ok('email excerpt bounded to 240', min.email_messages[0].excerpt.length <= 240, min.email_messages[0].excerpt.length);
  ok('a truncated excerpt is marked with an ellipsis', min.captures[0].excerpt.endsWith('…'));
  ok('email IS present in the minimized input (CoS\'s own brief has none)',
    min.email_messages.length === 1 && min.email_ai_analyses.length === 1);
  ok('agent verification_state is carried through, never defaulted away',
    min.agent_runs[0].verification_state === 'self_reported');
  ok('decision recommendation_source is carried through',
    min.decisions[0].recommendation_source === 'agent');

  // metadata-only mode really does drop the words
  const noText = compose.minimizeInput(rawData(), Date.now(), false);
  ok('includeExcerpts=false drops every excerpt',
    !noText.captures[0].excerpt && !noText.agent_runs[0].excerpt && !noText.email_messages[0].excerpt);

  // Trimming order: overflow with many of each, assert captures die first.
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const big = rawData({
    captures: many(60, (i) => ({ id: `c${i}`, original_text: 'c'.repeat(240), created_at: '2026-08-17T00:00:00Z' })),
    agent_runs: many(60, (i) => ({ id: `r${i}`, agent: 'a', verification_state: 'self_reported', original_body: 'r'.repeat(240), created_at: '2026-08-17T00:00:00Z' })),
    email_messages: many(60, (i) => ({ id: `m${i}`, subject: 's', plain_text_excerpt: 'm'.repeat(240), received_at: '2026-08-17T06:00:00Z' })),
    open_loops: many(60, (i) => ({ id: `l${i}`, title: 'loop ' + i, status: 'open', priority: 'high', created_at: '2026-08-15T00:00:00Z' })),
  });
  const before = compose.minimizeInput(big, Date.parse('2026-08-17T11:00:00Z'));
  ok('CONTROL: the oversized fixture really does exceed 24k',
    JSON.stringify(before).length > compose.LIMITS.total_input_chars, JSON.stringify(before).length);

  const after = compose.enforceTotalSize(before);
  ok('trimmed payload fits the 24k budget',
    JSON.stringify(after).length <= compose.LIMITS.total_input_chars, JSON.stringify(after).length);
  ok('captures are trimmed FIRST (emptied before email is touched)',
    after.captures.length === 0 && after.email_messages.length > 0,
    { captures: after.captures.length, email: after.email_messages.length });
  ok('open_loops survive — CoS calls them the point of the brief',
    after.open_loops.length === before.open_loops.length,
    { after: after.open_loops.length, before: before.open_loops.length });
}

// ═══════════════════════════════════════════════════════════════════════════
section('no prompt, no raw response, no full body is ever written');
{
  reset();
  const { deps, written } = makeDeps({ brief: briefCiting([{ type: 'email_message', id: IDS.mail }]) });
  const r = await runCosDailyBrief({ env: ARMED_ENV, now: new Date('2026-08-17T11:00:00Z'), deps });
  ok('CONTROL: the happy path did write a brief back', written.length === 1 && r.written === true, r);

  const payload = JSON.stringify(written[0].brief);
  ok('the written brief contains NO full body text', !payload.includes(SECRET_BODY), payload.slice(0, 120));
  ok('the written brief contains no system prompt line',
    !compose.SYSTEM_RULES.some((line) => payload.includes(line)));
  ok('the written row carries structured_output only, not a raw response',
    written[0].brief.schema_version === 'today_brief_v1' && written[0].brief.top_priorities.length === 1);

  // The minimized input DOES carry a bounded excerpt (that is the point) —
  // but the excerpt, not the body.
  const inputPayload = JSON.stringify(written[0].minimizedInput);
  ok('the fingerprinted input carries the bounded excerpt, not the full body',
    inputPayload.includes(SECRET_BODY.slice(0, 30)) && !inputPayload.includes('z'.repeat(400)));
}

// ═══════════════════════════════════════════════════════════════════════════
section('the ledger blocks a double send');
{
  reset();
  const db = fakeDb();
  const brief = briefCiting([{ type: 'open_loop', id: IDS.loop }]);
  const now = new Date('2026-08-17T11:00:00Z');

  const first = makeDeps({ brief, db });
  const r1 = await runCosDailyBrief({ env: ARMED_ENV, now, deps: first.deps });
  ok('CONTROL: the first run of the day SENDS', sends.length === 1 && r1.sent === true, { sends: sends.length, r1 });
  ok('the send really hit the Resend endpoint', sends[0].url === 'https://api.resend.com/emails', sends[0].url);
  ok('ledger row marked sent', db.rows.get(ledger.ledgerKey(now)).status === 'sent', db.rows.get(ledger.ledgerKey(now)));

  const second = makeDeps({ brief, db });
  const r2 = await runCosDailyBrief({ env: ARMED_ENV, now, deps: second.deps });
  ok('SECOND run the same day sends NOTHING MORE', sends.length === 1, sends.length);
  ok('second run reports already_sent', r2.reason === 'already_sent', r2.reason);
  ok('second run writes nothing back either', second.written.length === 0, second.written.length);

  // Distinguish the READ path from the 23505 path. Deleting the read check
  // still refuses (the INSERT collides), so `reason` alone cannot tell them
  // apart — the mutation run proved that mask. Only the read path can return
  // the stored sent_at, because the collision path never saw the row.
  const readPath = await ledger.claimSend({ now, db });
  ok('the already-sent check answers from the READ path, not the collision',
    readPath.claimed === false && readPath.reason === 'already_sent' && typeof readPath.sentAt === 'string',
    readPath);

  // A different UTC day is a different key, so tomorrow is not blocked.
  const tomorrow = new Date('2026-08-18T11:00:00Z');
  const third = makeDeps({ brief, db });
  await runCosDailyBrief({ env: ARMED_ENV, now: tomorrow, deps: third.deps });
  ok('the NEXT UTC day sends again (the block is per-day, not forever)', sends.length === 2, sends.length);

  // Two claims in sequence: the second sees the un-finished row and refuses.
  const raceDb = fakeDb();
  const k = ledger.ledgerKey(now);
  const a = await ledger.claimSend({ now, db: raceDb });
  const b = await ledger.claimSend({ now, db: raceDb });
  ok('first claim wins', a.claimed === true && a.key === k);
  ok('a second claim over an unfinished one REFUSES', b.claimed === false && b.claimed !== true, b);

  // The true race: both callers read BEFORE either inserted, so the read shows
  // nothing and only the PRIMARY KEY can separate them. This is the branch the
  // sequential case above never reaches, and it is the one that actually makes
  // two concurrent scheduler ticks safe.
  const collideDb = (() => {
    const rows = new Map();
    return {
      rows,
      from() {
        const api = {
          select: () => api,
          eq: () => api,
          // Always "no row yet" — simulates both callers reading first.
          maybeSingle: async () => ({ data: null, error: null }),
          insert: async (row) => (rows.has(row.key)
            ? { error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
            : (rows.set(row.key, row.value), { error: null })),
        };
        return api;
      },
    };
  })();
  const [ra, rb] = await Promise.all([
    ledger.claimSend({ now, db: collideDb }),
    ledger.claimSend({ now, db: collideDb }),
  ]);
  const winners = [ra, rb].filter((x) => x.claimed).length;
  ok('TRUE RACE: exactly ONE of two concurrent claims wins', winners === 1, { ra, rb });
  ok('TRUE RACE: the loser lost on 23505, not on a read',
    [ra, rb].some((x) => !x.claimed && x.reason === 'already_sent'), { ra, rb });

  // A stuck 'claimed' row fails CLOSED rather than risking a duplicate.
  const stuckDb = fakeDb();
  stuckDb.rows.set(k, { status: 'claimed', claimed_at: now.toISOString() });
  const stuck = await ledger.claimSend({ now, db: stuckDb });
  ok('a stuck in-flight claim refuses to send (fails closed)', stuck.claimed === false && stuck.reason === 'in_flight', stuck);

  // An unreadable ledger also fails closed — the opposite of the budget guard,
  // and deliberately so.
  const brokenDb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42P01', message: 'no such table' } }) }) }) }) };
  const broken = await ledger.claimSend({ now, db: brokenDb });
  ok('an unreadable ledger fails CLOSED (no send)', broken.claimed === false && broken.reason === 'ledger_unreadable', broken);
}

// ═══════════════════════════════════════════════════════════════════════════
section('budget tripped ⇒ the job never runs, so nothing is sent');
{
  reset();
  const reg = JOB_REGISTRY.find((j) => j.name === 'cos-daily-brief');
  ok('cos-daily-brief IS registered in the scheduler', Boolean(reg), JOB_REGISTRY.map((j) => j.name));
  ok('it is registered as outbound (so the kill switch gates it)', reg.outbound === true, reg);
  ok('it runs daily at 11:00 UTC', reg.spec === '0 11 * * *', reg.spec);
  ok('it is wired to the real job entry point', reg.fn === runCosDailyBrief);

  // Drive the REAL guard with a tripped gate.
  let ran = 0;
  await guard('cos-daily-brief', async () => { ran++; }, { outbound: true, gate: async () => false });
  ok('budget TRIPPED: the job body never executes', ran === 0, ran);
  ok('budget TRIPPED: ZERO sends', sends.length === 0, sends.length);

  // The control: the same guard with an open gate DOES run it.
  await guard('cos-daily-brief', async () => { ran++; }, { outbound: true, gate: async () => true });
  ok('CONTROL: budget OK ⇒ the job body executes', ran === 1, ran);

  // And the whole job through a tripped gate sends nothing on the wire.
  const { deps } = makeDeps({ brief: briefCiting([{ type: 'open_loop', id: IDS.loop }]) });
  await guard('cos-daily-brief', () => runCosDailyBrief({ env: ARMED_ENV, now: new Date('2026-08-19T11:00:00Z'), deps }), { outbound: true, gate: async () => false });
  ok('END TO END: tripped budget ⇒ the real job sends nothing', sends.length === 0, sends.length);
}

// ═══════════════════════════════════════════════════════════════════════════
section('dry run composes but does not send, write, or consume the day');
{
  reset();
  const db = fakeDb();
  const { deps, written } = makeDeps({ brief: briefCiting([{ type: 'email_message', id: IDS.mail }]), db });
  const env = { ...ARMED_ENV, COS_BRIEF_DRY_RUN: 'true' };
  ok('isDryRun reads its OWN flag', isDryRun(env) === true && isDryRun({ ...env, COS_BRIEF_DRY_RUN: 'false' }) === false);
  ok('BRIEF_DRY_RUN is NOT consulted by this job',
    isDryRun({ BRIEF_DRY_RUN: 'true' }) === false);

  const r = await runCosDailyBrief({ env, now: new Date('2026-08-17T11:00:00Z'), deps });
  ok('dry run composed a brief', Boolean(r.brief) && r.reason === 'dry_run', r.reason);
  ok('dry run sent NOTHING', sends.length === 0, sends.length);
  ok('dry run wrote NOTHING back to CoS', written.length === 0, written.length);
  ok('dry run did NOT consume the day\'s ledger slot', db.rows.size === 0, [...db.rows.keys()]);
}

// ═══════════════════════════════════════════════════════════════════════════
section('agent_runs excerpt column — regression pin for the 2026-08-20 incident');
{
  // The reader asked CoS for 'report_body'. CoS's column is 'original_body'
  // (its own minimizeInput reads s(r.original_body)). Every read of agent_runs
  // failed with 42703 the first time rung 1 ran against production.
  //
  // BE CLEAR ABOUT WHAT THIS PIN CAN AND CANNOT DO. It cannot detect the bug
  // that actually happened: the reader requested report_body, the composer read
  // r.report_body, and the FIXTURE supplied report_body — all three agreed with
  // each other and all three were wrong. No test written from the same
  // assumption as the code can catch that; only a read against the real schema
  // can, which is what the live-schema battery stage exists for.
  //
  // What this pin does catch is a naive revert to the old name, and it records
  // the incident where someone changing this line will see it.
  // Assert on the reader's exported column DATA, not on source text. The first
  // version of this pin grepped the whole file and broke the moment a comment
  // mentioned the old name while describing the incident — a textual pin cannot
  // tell a code reference from prose about it.
  const agentCols = readerCols.READER_COLUMNS.agent_runs;
  ok('reader requests original_body for agent_runs', agentCols.includes('original_body'), agentCols);
  ok('reader no longer requests report_body', !agentCols.includes('report_body'), agentCols);

  // And the behaviour, not just the strings: a row carrying original_body must
  // produce an excerpt.
  const withBody = compose.minimizeInput({
    workstreams: [], open_loops: [], decisions: [], captures: [],
    agent_runs: [{ id: IDS.run, agent: 'scout', verification_state: 'self_reported',
                   original_body: 'x'.repeat(600), created_at: '2026-08-17T00:00:00Z' }],
    email_messages: [], email_ai_analyses: [],
  }, Date.parse('2026-08-17T11:00:00Z'));
  ok('an agent_run with original_body yields a bounded excerpt',
    withBody.agent_runs[0].excerpt && withBody.agent_runs[0].excerpt.length <= 240,
    withBody.agent_runs[0].excerpt);

  // CONTROL: the OLD column name must now produce NO excerpt. Without this, the
  // assertion above would also pass if minimizeInput read both names.
  const withOld = compose.minimizeInput({
    workstreams: [], open_loops: [], decisions: [], captures: [],
    agent_runs: [{ id: IDS.run, agent: 'scout', verification_state: 'self_reported',
                   report_body: 'x'.repeat(600), created_at: '2026-08-17T00:00:00Z' }],
    email_messages: [], email_ai_analyses: [],
  }, Date.parse('2026-08-17T11:00:00Z'));
  ok('CONTROL: a row with the OLD column name yields no excerpt',
    withOld.agent_runs[0].excerpt === undefined, withOld.agent_runs[0].excerpt);
}

// ═══════════════════════════════════════════════════════════════════════════
section('WRITEBACK-ONLY — the rung that proves the CoS insert without sending');
{
  reset();
  const db = fakeDb();
  const { deps, written } = makeDeps({ brief: briefCiting([{ type: 'email_message', id: IDS.mail }]), db });
  const env = { ...ARMED_ENV, COS_BRIEF_WRITEBACK_ONLY: 'true' };

  let r;
  const events = await captureLogs(async () => {
    r = await runCosDailyBrief({ env, now: new Date('2026-08-17T11:00:00Z'), deps });
  });
  ok('writeback-only ANNOUNCES its mode by name',
    (eventNamed(events, 'cos.delivery.mode') || {}).outcome === 'writeback_only',
    eventNamed(events, 'cos.delivery.mode'));
  ok('writeback-only DID write the row to CoS', written.length === 1 && r.written === true, r);
  ok('writeback-only sent NOTHING', sends.length === 0, sends.length);
  ok('writeback-only reports its own mode', r.reason === 'writeback_only', r.reason);
  ok('writeback-only did NOT claim the day\'s send slot', db.rows.size === 0, [...db.rows.keys()]);
  ok('the row it wrote is a real brief, not a placeholder',
    written[0].brief.schema_version === 'today_brief_v1' && written[0].brief.top_priorities.length === 1);

  // THE POINT OF THE RUNG: a failing writeback is caught here, with no email
  // sent and no ledger row — i.e. on a run where the failure is free.
  reset();
  const failDb = fakeDb();
  const failing = makeDeps({ brief: briefCiting([{ type: 'open_loop', id: IDS.loop }]), db: failDb });
  failing.deps.write = async () => ({ id: null, skipped: true, reason: 'write_failed' });
  const rf = await runCosDailyBrief({ env, now: new Date('2026-08-17T11:00:00Z'), deps: failing.deps });
  ok('a FAILING writeback is reported, not swallowed', rf.written === false && rf.reason === 'writeback_only', rf);
  ok('a failing writeback sent no email', sends.length === 0, sends.length);
  ok('a failing writeback left no ledger row to unstick', failDb.rows.size === 0, [...failDb.rows.keys()]);

  // Precedence, both directions. These are the rules most likely to rot.
  ok('DRY_RUN wins over WRITEBACK_ONLY (the safer mode wins)',
    isDryRun({ COS_BRIEF_DRY_RUN: 'true', COS_BRIEF_WRITEBACK_ONLY: 'true' }) === true);
  reset();
  const bothDb = fakeDb();
  const both = makeDeps({ brief: briefCiting([{ type: 'open_loop', id: IDS.loop }]), db: bothDb });
  let rb;
  const bothEvents = await captureLogs(async () => {
    rb = await runCosDailyBrief({
      env: { ...ARMED_ENV, COS_BRIEF_DRY_RUN: 'true', COS_BRIEF_WRITEBACK_ONLY: 'true' },
      now: new Date('2026-08-17T11:00:00Z'), deps: both.deps,
    });
  });
  ok('both flags set ⇒ DRY RUN, so nothing is written', rb.reason === 'dry_run' && both.written.length === 0, rb);
  ok('both flags set ⇒ nothing sent', sends.length === 0, sends.length);
  // The behaviour above is decided by statement ORDER (the dry-run branch
  // returns first), so `reason` alone cannot catch a broken precedence rule in
  // the mode variable. The ANNOUNCED mode can, and a log that names the wrong
  // rung is its own defect.
  ok('both flags set ⇒ the job ANNOUNCES dry_run, not writeback_only',
    (eventNamed(bothEvents, 'cos.delivery.mode') || {}).outcome === 'dry_run',
    eventNamed(bothEvents, 'cos.delivery.mode'));

  // WRITEBACK_ONLY must beat LIVE — the rung has to stay safe if the live flag
  // is set early, which is precisely the mistake it exists to catch.
  reset();
  const liveDb = fakeDb();
  const withLive = makeDeps({ brief: briefCiting([{ type: 'open_loop', id: IDS.loop }]), db: liveDb });
  const rl = await runCosDailyBrief({
    env: { ...ARMED_ENV, COS_BRIEF_LIVE: 'true', COS_BRIEF_WRITEBACK_ONLY: 'true' },
    now: new Date('2026-08-17T11:00:00Z'), deps: withLive.deps,
  });
  ok('WRITEBACK_ONLY overrides a live flag set early', rl.reason === 'writeback_only' && rl.sent === false, rl);
  ok('...and ZERO email left the wire despite COS_BRIEF_LIVE=true', sends.length === 0, sends.length);
  ok('...and the row was still written', withLive.written.length === 1);

  ok('isWritebackOnly reads its own flag', isWritebackOnly({ COS_BRIEF_WRITEBACK_ONLY: 'true' }) === true
    && isWritebackOnly({}) === false && isWritebackOnly({ COS_BRIEF_LIVE: 'true' }) === false);

  // briefMode() is the ONE place precedence lives. Pin the whole table: an
  // earlier shape encoded this three times over and no mutation could reach it.
  const LIVE3 = { COS_BRIEF_LIVE: 'true', RESEND_API_KEY: 'k', COS_BRIEF_TO: 'a@b.test' };
  ok('mode: nothing set ⇒ not_configured', briefMode({}) === 'not_configured', briefMode({}));
  ok('mode: full delivery ⇒ live', briefMode(LIVE3) === 'live', briefMode(LIVE3));
  ok('mode: writeback flag ⇒ writeback_only', briefMode({ COS_BRIEF_WRITEBACK_ONLY: 'true' }) === 'writeback_only');
  ok('mode: dry-run flag ⇒ dry_run', briefMode({ COS_BRIEF_DRY_RUN: 'true' }) === 'dry_run');
  ok('mode: dry_run BEATS writeback_only',
    briefMode({ COS_BRIEF_DRY_RUN: 'true', COS_BRIEF_WRITEBACK_ONLY: 'true' }) === 'dry_run');
  ok('mode: dry_run BEATS live',
    briefMode({ ...LIVE3, COS_BRIEF_DRY_RUN: 'true' }) === 'dry_run');
  ok('mode: writeback_only BEATS live',
    briefMode({ ...LIVE3, COS_BRIEF_WRITEBACK_ONLY: 'true' }) === 'writeback_only');
  ok('mode: all three flags ⇒ the SAFEST one wins',
    briefMode({ ...LIVE3, COS_BRIEF_DRY_RUN: 'true', COS_BRIEF_WRITEBACK_ONLY: 'true' }) === 'dry_run');

  // CONTROL: with neither flag, the same fixture DOES send. Without this, every
  // "sent nothing" above could be an artifact of a broken fixture.
  reset();
  const ctrlDb = fakeDb();
  const ctrl = makeDeps({ brief: briefCiting([{ type: 'open_loop', id: IDS.loop }]), db: ctrlDb });
  await runCosDailyBrief({ env: ARMED_ENV, now: new Date('2026-08-17T11:00:00Z'), deps: ctrl.deps });
  ok('CONTROL: the same fixture with no mode flag DOES send', sends.length === 1, sends.length);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Resend transport — three gates, verified sending domain');
{
  const full = { COS_BRIEF_LIVE: 'true', RESEND_API_KEY: 'k', COS_BRIEF_TO: 'a@b.test' };
  ok('CONTROL: fully configured ⇒ transport is built', createResendTransport(full, { fetchImpl: countingFetch }) !== null);

  for (const [missing, env] of [
    ['COS_BRIEF_LIVE', { RESEND_API_KEY: 'k', COS_BRIEF_TO: 'a@b.test' }],
    ['RESEND_API_KEY', { COS_BRIEF_LIVE: 'true', COS_BRIEF_TO: 'a@b.test' }],
    ['COS_BRIEF_TO', { COS_BRIEF_LIVE: 'true', RESEND_API_KEY: 'k' }],
  ]) {
    ok(`missing ${missing} ⇒ no transport`, createResendTransport(env) === null);
    ok(`missing ${missing} ⇒ deliveryEnv reports it by name`, deliveryEnv(env).missing.some((m) => m.startsWith(missing)), deliveryEnv(env).missing);
    let threw = false;
    try { new ResendTransport(env); } catch (e) { threw = /COS_BRIEF_LIVE|RESEND_API_KEY|COS_BRIEF_TO/.test(e.message); }
    ok(`constructing without ${missing} throws a NAMED error`, threw);
  }

  // Double gate: an instance built while live still refuses if the flag flips.
  const mutable = { ...full };
  const t = new ResendTransport(mutable, { fetchImpl: countingFetch });
  mutable.COS_BRIEF_LIVE = 'false';
  reset();
  let refused = false;
  try { await t.send({ subject: 's', html: 'h', text: 't' }); } catch { refused = true; }
  ok('flag flipped after construction ⇒ send still refuses', refused === true);
  ok('and nothing reached the wire', sends.length === 0, sends.length);

  ok('default From is on the Resend-VERIFIED subdomain, not the root domain',
    DEFAULT_FROM.includes('@updates.cedrus.life') && !/@cedrus\.life>/.test(DEFAULT_FROM), DEFAULT_FROM);
}

// ═══════════════════════════════════════════════════════════════════════════
section('read retry — transient recovers, deterministic fails immediately');
{
  const { withReadRetry, isRetryableReadError, RETRYABLE_READ_CODES, READ_RETRY } = clientMod;

  // Which codes are retryable at all.
  ok('PGRST303 (JWT issued at future) is retryable', isRetryableReadError({ code: 'PGRST303' }));
  ok('42703 (column does not exist) is NOT retryable', !isRetryableReadError({ code: '42703' }));
  ok('42P01 (relation does not exist) is NOT retryable', !isRetryableReadError({ code: '42P01' }));
  ok('42501 (permission denied) is NOT retryable', !isRetryableReadError({ code: '42501' }));
  ok('an unknown code is NOT retryable', !isRetryableReadError({ code: 'WHATEVER' }));
  ok('a null error is not retryable', !isRetryableReadError(null));
  ok('the allowlist is deliberately tiny', RETRYABLE_READ_CODES.length === 1, RETRYABLE_READ_CODES);

  const noSleep = { sleep: async () => {} };
  const flaky2 = () => { let n = 0; return async () => (++n < 2
    ? { data: null, error: { code: 'PGRST303', message: 'JWT issued at future' } }
    : { data: [{ id: 'a' }], error: null }); };

  // TRANSIENT that recovers — the real PGRST303 case from rung 1.
  let calls = 0;
  const flaky = async () => {
    calls++;
    return calls < 3 ? { data: null, error: { code: 'PGRST303', message: 'JWT issued at future' } }
                     : { data: [{ id: 'a' }], error: null };
  };
  let r = await withReadRetry(flaky, noSleep);
  ok('a transient failure that recovers returns DATA, not an error', !r.error && r.data.length === 1, r);
  ok('...and reports the attempt it succeeded on', r.attempts === 3, r.attempts);
  ok('...having actually retried', calls === 3, calls);

  // DETERMINISTIC — must fail on the FIRST attempt, wasting no retries.
  calls = 0;
  const permanent = async () => {
    calls++;
    return { data: null, error: { code: '42703', message: 'column agent_runs.report_body does not exist' } };
  };
  r = await withReadRetry(permanent, noSleep);
  ok('a deterministic failure returns the error', Boolean(r.error) && r.error.code === '42703', r);
  ok('a deterministic failure is tried exactly ONCE', r.attempts === 1 && calls === 1, { attempts: r.attempts, calls });

  // CONTROL: with the SAME harness a transient error really does retry more
  // than once. Without this, "tried once" above could pass simply because the
  // retry loop was broken for everything.
  calls = 0;
  const alwaysTransient = async () => { calls++; return { data: null, error: { code: 'PGRST303', message: 'skew' } }; };
  r = await withReadRetry(alwaysTransient, noSleep);
  ok('CONTROL: a transient error DOES exhaust the budget', calls === READ_RETRY.attempts && r.attempts === READ_RETRY.attempts, calls);
  ok('...and still fails closed once exhausted', Boolean(r.error), r);

  // Success first time: no retries, no waiting.
  calls = 0;
  r = await withReadRetry(async () => { calls++; return { data: [], error: null }; }, noSleep);
  ok('a clean read is tried once', r.attempts === 1 && calls === 1);

  // Backoff must actually be awaited between transient attempts.
  const waits = [];
  await withReadRetry(alwaysTransient, { sleep: async (ms) => { waits.push(ms); } });
  ok('backoff is applied between attempts, not after the last',
    waits.length === READ_RETRY.attempts - 1, waits);
  ok('backoff increases', waits.length === 2 && waits[1] > waits[0], waits);

  // A RECOVERY MUST ANNOUNCE ITSELF. A retry that silently succeeds looks
  // exactly like a read that never had trouble, so a credential degrading
  // toward failure stays invisible until it fails outright.
  calls = 0;
  const recovEvents = await captureLogs(async () => { await withReadRetry(flaky2(), { ...noSleep, label: 'agent_runs' }); });
  const recov = eventNamed(recovEvents, 'cos.read.retried');
  ok('a recovered read announces cos.read.retried', Boolean(recov), recovEvents.map((e) => e.event));
  // retry_count, not `attempts`: buildLogRecord allowlists structural fields and
  // silently DROPS anything else, so an invented field name would vanish from
  // the log while the test still passed on the message text alone.
  ok('...naming the table and the retry count', recov && recov.retry_count === 1 && /agent_runs/.test(recov.message), recov);

  // CONTROL: a first-try success announces NOTHING, or the event would be noise
  // and could not distinguish a recovery from a healthy read.
  const cleanEvents = await captureLogs(async () => { await withReadRetry(async () => ({ data: [], error: null }), noSleep); });
  ok('CONTROL: a clean read announces no retry event',
    !eventNamed(cleanEvents, 'cos.read.retried'), cleanEvents.map((e) => e.event));

  // And a deterministic error waits not at all.
  const noWaits = [];
  await withReadRetry(permanent, { sleep: async (ms) => { noWaits.push(ms); } });
  ok('a deterministic failure never sleeps', noWaits.length === 0, noWaits);
}

// ═══════════════════════════════════════════════════════════════════════════
section('the reader module is structurally write-only-to-today_briefs');
{
  const exported = Object.keys(clientMod);
  const writeVerbs = exported.filter((n) => /insert|update|upsert|delete|rpc|write/i.test(n));
  ok('exactly ONE exported write verb', writeVerbs.length === 1, writeVerbs);
  ok('and it is pinned to today_briefs by name', writeVerbs[0] === 'cosInsertTodayBrief', writeVerbs);
  ok('the writable table constant is today_briefs', clientMod.WRITABLE_TABLE === 'today_briefs');
  ok('the raw supabase client is NOT exported', !exported.some((n) => /^(client|supabase|db)$/i.test(n)), exported);

  ok('all eight tables are readable', clientMod.READABLE_TABLES.length === 8);
  for (const t of ['workstreams', 'open_loops', 'decisions', 'captures', 'agent_runs', 'email_messages', 'email_ai_analyses', 'today_briefs']) {
    ok(`readable: ${t}`, clientMod.READABLE_TABLES.includes(t));
  }
  // A table not on the list cannot be reached at all — it throws rather than
  // silently returning nothing.
  let refusedTable = false;
  try { await clientMod.cosSelect('email_sources', (q) => q, { env: ARMED_ENV }); }
  catch (e) { refusedTable = /not in READABLE_TABLES/.test(e.message); }
  ok('a non-allowlisted table is REFUSED, not silently empty', refusedTable);
}

// ═══════════════════════════════════════════════════════════════════════════
section('renderer — escaping and the caveats that must never be dropped');
{
  const input = compose.enforceTotalSize(compose.minimizeInput(rawData(), Date.parse('2026-08-17T11:00:00Z')));
  const v = compose.validateBrief(briefCiting([{ type: 'email_message', id: IDS.mail }]), input);
  const out = renderBriefEmail(v.brief, new Date('2026-08-17T11:00:00Z'));

  ok('subject carries the date and the top priority', out.subject.includes('2026-08-17') && out.subject.includes('Pay the vendor'), out.subject);
  ok('html renders the disclaimer', out.html.includes(compose.MODEL_DISCLAIMER));
  ok('text renders the disclaimer', out.text.includes(compose.MODEL_DISCLAIMER));
  ok('html renders the confidence caveat', /how well your records support this/.test(out.html));
  ok('text renders the confidence caveat', /how well your records support this/.test(out.text));
  ok('citations render the email type as readable words', out.text.includes('email message'), out.text.slice(0, 200));
  ok('the off-switch is stated in the email', /COS_BRIEF_LIVE/.test(out.text) && /COS_BRIEF_LIVE/.test(out.html));

  // Model output is untrusted text that came from an inbox.
  const evil = compose.validateBrief(briefCiting([{ type: 'open_loop', id: IDS.loop }], {
    summary: '<img src=x onerror="alert(1)">',
  }), input);
  const evilOut = renderBriefEmail(evil.brief, new Date());
  ok('model output is HTML-escaped in the email body', !evilOut.html.includes('<img src=x'), evilOut.html.slice(0, 200));
  ok('esc() handles all five entities', esc(`<>&"'`) === '&lt;&gt;&amp;&quot;&#39;');
}

// ═══════════════════════════════════════════════════════════════════════════
section('failure paths degrade honestly');
{
  reset();
  // An unreadable CoS table aborts rather than composing from partial data.
  const { deps } = makeDeps({ brief: briefCiting([{ type: 'open_loop', id: IDS.loop }]) });
  deps.gather = async () => ({ ok: false, reason: 'read_failed', tables: ['email_ai_analyses'] });
  const r = await runCosDailyBrief({ env: ARMED_ENV, now: new Date('2026-08-17T11:00:00Z'), deps });
  ok('an unreadable table ⇒ no brief, no send', r.ran === false && r.reason === 'read_failed' && sends.length === 0, r);

  // A model failure is reported, not swallowed into a fake brief.
  reset();
  const m = makeDeps({ brief: null, modelThrows: true });
  const r2 = await runCosDailyBrief({ env: ARMED_ENV, now: new Date('2026-08-17T11:00:00Z'), deps: m.deps });
  ok('a model failure ⇒ reason model_failed, ZERO sends', r2.reason === 'model_failed' && sends.length === 0, r2);

  // Empty input is a valid answer, not an error.
  reset();
  const e = makeDeps({ data: { workstreams: [], open_loops: [], decisions: [], captures: [], agent_runs: [], email_messages: [], email_ai_analyses: [] } });
  const r3 = await runCosDailyBrief({ env: ARMED_ENV, now: new Date('2026-08-17T11:00:00Z'), deps: e.deps });
  ok('an empty day ⇒ ran:true, reason no_input, no send', r3.ran === true && r3.reason === 'no_input' && sends.length === 0, r3);

  // Model default names the model that actually ran, not CoS's.
  ok('briefModel defaults to this repo\'s configured model', briefModel({}) === 'gpt-4.1-mini', briefModel({}));
  ok('briefModel is overridable', briefModel({ COS_BRIEF_MODEL: 'x' }) === 'x');
}

p('');
if (failures === 0) p('ALL COS DAILY BRIEF TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
