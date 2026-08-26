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
const reader = await import('../src/services/cos/reader.js');
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
    email_messages: [{ id: IDS.mail, subject: 'Invoice overdue', sender_address: 'ap@vendor.test', original_recipient: 'support@cedrus.life', received_at: '2026-08-17T06:00:00Z', plain_text_excerpt: SECRET_BODY + 'z'.repeat(600), classification: 'support', triage_priority: 'urgent', action_status: 'action_needed', has_attachments: false, is_demo: false }],
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
    // Pointed at the same fake ledger as claim(). Left unset it falls back to
    // the real alreadySentToday(), which reaches for the real Supabase client
    // and burns ~7s per run timing out against http://supabase.invalid — a
    // suite that is green but takes minutes stops being run.
    precheck: (a) => ledger.alreadySentToday({ ...a, db }),
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

  // The model really did hallucinate this on 2026-08-20: generated_at
  // "2026-08-20T12:00:00Z" for a brief composed at 19:17Z. It passed validation
  // because the schema only requires a string. Nothing renders the field, which
  // is precisely why it would have stayed wrong.
  const REAL = new Date('2026-08-20T19:17:56.164Z');
  const lied = compose.validateBrief(
    briefCiting(refs, { generated_at: '2026-08-20T12:00:00Z' }), input, REAL);
  ok('a hallucinated generated_at is OVERWRITTEN with the real time',
    lied.brief.generated_at === REAL.toISOString(), lied.brief.generated_at);
  ok('...and the model\'s value does not survive anywhere in the brief',
    !JSON.stringify(lied.brief).includes('2026-08-20T12:00:00Z'), lied.brief.generated_at);

  // CONTROL: a model that happens to emit the CORRECT time is also overwritten,
  // not merely tolerated. Otherwise the assertion above would pass for a
  // validator that only rewrote values it judged wrong — which it cannot judge.
  const honest = compose.validateBrief(
    briefCiting(refs, { generated_at: REAL.toISOString() }), input, REAL);
  ok('CONTROL: generated_at is always authored, never accepted',
    honest.brief.generated_at === REAL.toISOString(), honest.brief.generated_at);

  // And a brief with NO generated_at at all still gets one.
  const missing = briefCiting(refs); delete missing.generated_at;
  const filled = compose.validateBrief(missing, input, REAL);
  ok('a brief missing generated_at gets the real time',
    filled.ok && filled.brief.generated_at === REAL.toISOString(), filled.brief && filled.brief.generated_at);
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
section('email selection — attention first, recency last');
{
  // Shapes taken from the seven real rows in CoS on 2026-08-21. Three are
  // unreviewed and ~152h old; four were dismissed by the owner in July, one of
  // them 'urgent'. The old reader saw NONE of them: a 36h window excluded every
  // one, so the brief silently contained zero email on every run.
  const REAL = [
    { id: 'a', received_at: '2026-08-17T19:09:23Z', action_status: 'unreviewed', triage_priority: 'normal', subject: 'TEST' },
    { id: 'b', received_at: '2026-08-17T18:50:28Z', action_status: 'unreviewed', triage_priority: 'normal', subject: 'Gmail Forwarding Confirmation' },
    { id: 'c', received_at: '2026-08-17T17:54:17Z', action_status: 'unreviewed', triage_priority: 'normal', subject: 'TEST' },
    { id: 'd', received_at: '2026-07-14T23:41:51Z', action_status: 'dismissed',  triage_priority: 'low',    subject: 'TEST' },
    { id: 'e', received_at: '2026-07-14T22:37:11Z', action_status: 'dismissed',  triage_priority: 'high',   subject: 'routing test' },
    { id: 'f', received_at: '2026-07-14T22:35:03Z', action_status: 'dismissed',  triage_priority: 'urgent', subject: 'routing test' },
    { id: 'g', received_at: '2026-07-14T22:02:45Z', action_status: 'dismissed',  triage_priority: 'low',    subject: 'Welcome to Purelymail' },
  ];
  const { selected, eligibleTotal } = reader.selectEmailMessages(REAL, 20);
  const ids = selected.map((r) => r.id);

  ok('the three unreviewed rows ARE selected despite being ~152h old',
    ids.includes('a') && ids.includes('b') && ids.includes('c'), ids);
  ok('dismissed rows are never surfaced, even the urgent one',
    !ids.includes('d') && !ids.includes('e') && !ids.includes('f') && !ids.includes('g'), ids);
  ok('eligible total counts only the unsettled rows', eligibleTotal === 3, eligibleTotal);

  // Ordering: action state beats priority, priority beats recency.
  const MIX = [
    { id: 'old_action', received_at: '2026-01-01T00:00:00Z', action_status: 'action_needed', triage_priority: 'low' },
    { id: 'new_reviewed', received_at: '2026-08-21T00:00:00Z', action_status: 'reviewed', triage_priority: 'low' },
    { id: 'urgent_unrev', received_at: '2026-02-01T00:00:00Z', action_status: 'unreviewed', triage_priority: 'urgent' },
    { id: 'normal_unrev', received_at: '2026-08-20T00:00:00Z', action_status: 'unreviewed', triage_priority: 'normal' },
  ];
  const order = reader.selectEmailMessages(MIX, 20).selected.map((r) => r.id);
  ok('action_needed outranks everything, however old', order[0] === 'old_action', order);
  ok('within unreviewed, urgent beats a newer normal', order[1] === 'urgent_unrev' && order[2] === 'normal_unrev', order);
  ok('a newer REVIEWED message ranks last, not first', order[3] === 'new_reviewed', order);

  // CONTROL: recency is still the tie-break, so equal rows are newest-first.
  const TIE = [
    { id: 'older', received_at: '2026-08-01T00:00:00Z', action_status: 'unreviewed', triage_priority: 'normal' },
    { id: 'newer', received_at: '2026-08-20T00:00:00Z', action_status: 'unreviewed', triage_priority: 'normal' },
  ];
  ok('CONTROL: recency still breaks ties within a tier',
    reader.selectEmailMessages(TIE, 20).selected.map((r) => r.id).join() === 'newer,older');

  // The cap applies AFTER ranking, so what survives is what matters.
  const MANY = Array.from({ length: 40 }, (_, i) => ({
    id: 'm' + i, received_at: '2026-08-0' + (i % 9 + 1) + 'T00:00:00Z',
    action_status: i === 39 ? 'action_needed' : 'reviewed', triage_priority: 'normal',
  }));
  const capped = reader.selectEmailMessages(MANY, 20);
  ok('the cap keeps 20', capped.selected.length === 20, capped.selected.length);
  ok('the one action_needed row survives a 40-row cull', capped.selected[0].id === 'm39', capped.selected[0].id);
  ok('eligibleTotal reports the true eligible count, not the cap', capped.eligibleTotal === 40, capped.eligibleTotal);

  ok('the lookback matches the daily cron cadence', reader.EMAIL_LOOKBACK_HOURS === 24, reader.EMAIL_LOOKBACK_HOURS);

  // The ranker keys off action_status and triage_priority. If the reader does
  // not REQUEST those columns they arrive undefined, every row ranks equal, and
  // the ordering silently degrades to input order — with no error anywhere.
  // Both column generations exist in CoS, so the live-schema battery stage
  // cannot catch this: classification_status is a real column, just the stale
  // one. Coupling the two lists is the only thing that can.
  const RANKED_ON = ['action_status', 'triage_priority', 'received_at'];
  for (const f of RANKED_ON) {
    ok(`the reader REQUESTS the column it ranks on: ${f}`,
      reader.READER_COLUMNS.email_messages.includes(f), reader.READER_COLUMNS.email_messages);
  }
  // And the stale generation is deliberately not requested: prod row 0f8ea600
  // reads triage_priority='urgent' while classification_status='unclassified',
  // so reading the old pair tells the brief the wrong thing about every row.
  // The composer must read the SAME columns the reader fetches. They drifted
  // once already: the reader was moved to the triage generation and the
  // composer left on the stale pair, so every field arrived undefined and
  // silently took a default — the model was told 'unclassified/unreviewed'
  // about a row that is really 'support/urgent'. No error, no test failure.
  {
    const shaped = compose.minimizeInput({
      workstreams: [], open_loops: [], decisions: [], captures: [], agent_runs: [],
      email_ai_analyses: [],
      email_messages: [{ id: 'e1', subject: 's', received_at: '2026-08-17T06:00:00Z',
        classification: 'support', triage_priority: 'urgent', action_status: 'action_needed' }],
    }, Date.parse('2026-08-17T11:00:00Z')).email_messages[0];
    for (const f of ['classification', 'triage_priority', 'action_status']) {
      ok(`the composer PASSES THROUGH the real ${f}, not a default`,
        shaped[f] !== undefined && reader.READER_COLUMNS.email_messages.includes(f), shaped[f]);
    }
    ok('a triage-urgent row reaches the model as urgent, not normal',
      shaped.triage_priority === 'urgent', shaped.triage_priority);
    ok('an action_needed row reaches the model as action_needed',
      shaped.action_status === 'action_needed', shaped.action_status);
    ok('the stale field names are gone from the minimized shape',
      !('classification_status' in shaped) && !('owner_review_status' in shaped), Object.keys(shaped));
  }

  ok('the STALE column pair is not requested',
    !reader.READER_COLUMNS.email_messages.includes('classification_status') &&
    !reader.READER_COLUMNS.email_messages.includes('owner_review_status'),
    reader.READER_COLUMNS.email_messages);
}

// ═══════════════════════════════════════════════════════════════════════════
section('state of the workspace — computed, not asked for');
{
  const NOW = Date.parse('2026-08-24T12:00:00Z');
  const raw = {
    workstreams: [
      // past target, no next action, has target_date
      { id: 'w1', name: 'Admin Panel', status: 'active', priority: 'high', health: 'ok',
        target_date: '2026-07-23', next_action: null, archived_at: null, created_at: '2026-06-01T00:00:00Z' },
      // no next action, no target date
      { id: 'w2', name: 'Cedrus Social', status: 'active', priority: 'low', health: 'ok',
        target_date: null, next_action: null, archived_at: null, created_at: '2026-06-01T00:00:00Z' },
      // healthy: has both
      { id: 'w3', name: 'Affiliate', status: 'active', priority: 'low', health: 'ok',
        target_date: '2026-12-01', next_action: 'draft the terms', archived_at: null, created_at: '2026-06-01T00:00:00Z' },
      // ALSO past target, but by less. Two past-target rows are required or
      // max() and min() are the same value and "furthest by" cannot be wrong —
      // a mutation flipping max to min stayed green with only one.
      { id: 'w4', name: 'Second overdue', status: 'active', priority: 'low', health: 'ok',
        target_date: '2026-08-14', next_action: 'ship it', archived_at: null, created_at: '2026-06-01T00:00:00Z' },
    ],
    open_loops: [
      { id: 'l1', title: 'no due date', status: 'open', priority: 'low', due_at: null, created_at: '2026-08-01T00:00:00Z' },
      { id: 'l2', title: 'overdue', status: 'open', priority: 'high', due_at: '2026-08-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z' },
    ],
    decisions: [], captures: [], agent_runs: [], email_ai_analyses: [],
    email_messages: [
      { id: 'm1', subject: 'a', received_at: '2026-08-17T19:09:23Z', action_status: 'unreviewed', triage_priority: 'normal' },
      { id: 'm2', subject: 'b', received_at: '2026-08-20T00:00:00Z', action_status: 'unreviewed', triage_priority: 'normal' },
      { id: 'm3', subject: 'c', received_at: '2026-08-21T00:00:00Z', action_status: 'reviewed',   triage_priority: 'normal' },
    ],
  };
  const input = compose.minimizeInput(raw, NOW);
  const state = compose.computeWorkspaceState(input, NOW);
  const text = state.join(' | ');

  // Counts must match the SUPPLIED records exactly.
  ok('counts the unreviewed email, not all email', /2 email messages are unreviewed/.test(text), text);
  ok('reports the OLDEST unreviewed age (6d, not the 3d one)', /oldest 6 days old/.test(text), text);
  ok('counts workstreams with no next action', /2 workstreams have no next action/.test(text), text);
  ok('counts workstreams with no target date', /1 workstream has no target date/.test(text), text);
  ok('counts workstreams past target with the WORST gap, not the smallest',
    /2 workstreams are past target, the furthest by 32 days/.test(text), text);
  ok('counts open loops with no due date', /1 open loop has no due date/.test(text), text);
  ok('counts overdue open loops', /1 open loop is overdue/.test(text), text);
  ok('states agent-run silence explicitly', /No agent run appears in the supplied records/.test(text), text);

  // Singular vs plural, because "1 workstreams have" reads as a bug to a human.
  ok('singular and plural agree', !/\b1 [a-z ]*s (have|are)\b/.test(text), text);

  // Zero-count facts are omitted, not printed as zeroes.
  const clean = compose.computeWorkspaceState(compose.minimizeInput({
    workstreams: [{ id: 'x', name: 'ok', status: 'active', priority: 'low', health: 'ok',
      target_date: '2026-12-01', next_action: 'do it', archived_at: null, created_at: '2026-08-01T00:00:00Z' }],
    open_loops: [], decisions: [], captures: [], email_messages: [], email_ai_analyses: [],
    agent_runs: [{ id: 'r', agent: 'a', verification_state: 'self_reported', created_at: '2026-08-24T00:00:00Z' }],
  }, NOW), NOW);
  ok('a healthy workspace prints no zero-count noise',
    !clean.some((l) => /^0 /.test(l)) && clean.length === 1, clean);
  ok('...and still reports the agent run recency', /agent run was today/.test(clean[0]), clean[0]);

  // THE STRUCTURAL PROPERTY: it can only see what the model saw. Computing from
  // the minimized input means a count can never describe a record that was
  // trimmed out of the payload. Still true for every count here EXCEPT the
  // pool-derived email one, which is the stated exception below.
  const trimmed = { ...input, email_messages: [] };
  const afterTrim = compose.computeWorkspaceState(trimmed, NOW);
  ok('a record trimmed from the payload is not counted',
    !/email messages are unreviewed/.test(afterTrim.join(' ')), afterTrim);

  // THE EXCEPTION, PINNED. With a pool figure present the two halves of the
  // sentence must move independently: the unreviewed count describes the
  // ELIGIBLE POOL and cannot change when the payload is trimmed (the pool did
  // not shrink — the payload did), while "K read" describes the payload and
  // MUST follow the trim. A count that quietly kept saying "3 read" after
  // enforceTotalSize dropped two rows would be the same falsehood this whole
  // change removes, one level down.
  const pooled = {
    ...input,
    email_selection: {
      considered: 3, total: 9, truncated: true, total_is_floor: false,
      unreviewed_total: 7, oldest_unreviewed_received_at: '2026-08-14T12:00:00Z',
    },
  };
  const beforeTrim = compose.computeWorkspaceState(pooled, NOW).join(' | ');
  const oneLeft = compose.computeWorkspaceState(
    { ...pooled, email_messages: pooled.email_messages.slice(0, 1) }, NOW).join(' | ');

  ok('pool-derived count is UNCHANGED when a considered row is trimmed',
    /7 email messages are unreviewed/.test(beforeTrim) && /7 email messages are unreviewed/.test(oneLeft),
    { beforeTrim, oneLeft });
  ok('...but the "K read" figure FOLLOWS the trim',
    /; 3 read\)/.test(beforeTrim) && /; 1 read\)/.test(oneLeft), { beforeTrim, oneLeft });
  ok('...and the eligible total, which is also pool-derived, does not move',
    /of 9 eligible/.test(beforeTrim) && /of 9 eligible/.test(oneLeft), { beforeTrim, oneLeft });
  ok('...with the age taken from the pool row, not from what survived',
    /the oldest 10 days old/.test(beforeTrim) && /the oldest 10 days old/.test(oneLeft), { beforeTrim, oneLeft });
}

// ═══════════════════════════════════════════════════════════════════════════
section('honest email counts — the pool, not the slice');
{
  // The failure this section exists for: with 25 unreviewed messages and a
  // 20-row cap, the brief announced "20 email messages are unreviewed" and took
  // the oldest age from those 20. Both numbers were wrong in the SAME direction
  // — understating the backlog — and the second was wrong structurally, because
  // the ranker sorts newest-first inside a tier, so the oldest unreviewed
  // message is the row likeliest to be cut. The count stopped growing exactly
  // when the backlog did.
  const NOW_A = Date.parse('2026-08-26T12:00:00Z');
  const DAY = 86_400_000;

  // 25 rows, equal action state, equal priority, distinct received_at — so
  // recency is the ONLY thing separating them and the cap has to bite.
  const TWENTY_FIVE = Array.from({ length: 25 }, (_, i) => ({
    id: 'p' + i,
    subject: 'unreviewed ' + i,
    received_at: new Date(NOW_A - (i + 1) * DAY).toISOString(),
    action_status: 'unreviewed',
    triage_priority: 'normal',
  }));

  const picked = reader.selectEmailMessages(TWENTY_FIVE, 20);
  ok('the cap really bit: 20 of 25 selected', picked.selected.length === 20, picked.selected.length);
  ok('unreviewedTotal counts the POOL (25), not the slice (20)',
    picked.unreviewedTotal === 25, picked.unreviewedTotal);
  ok('the oldest unreviewed row is the one the selection EXCLUDED',
    !picked.selected.some((r) => r.id === 'p24') && picked.oldestUnreviewedReceivedAt === TWENTY_FIVE[24].received_at,
    { oldest: picked.oldestUnreviewedReceivedAt, selectedIds: picked.selected.map((r) => r.id) });

  // The REAL mapping into the composer's record — reader.buildEmailSelection is
  // the same function gatherCosInput calls, not a copy of it written here.
  const sel = reader.buildEmailSelection({ ...picked, rows: picked.selected, poolTruncated: false });
  ok('the selection record carries the pool count', sel.unreviewed_total === 25, sel);
  ok('...and the read count separately', sel.considered === 20, sel);
  ok('...and declares itself truncated', sel.truncated === true, sel);

  const inputA = compose.minimizeInput({
    workstreams: [], open_loops: [], decisions: [], captures: [], agent_runs: [],
    email_ai_analyses: [], email_messages: picked.selected, email_selection: sel,
  }, NOW_A);
  const lineA = compose.computeWorkspaceState(inputA, NOW_A).join(' | ');

  ok('the line reports 25 unreviewed, not 20', /25 email messages are unreviewed/.test(lineA), lineA);
  ok('the line names both scopes: eligible and read', /\(of 25 eligible; 20 read\)/.test(lineA), lineA);
  ok('the age comes from the EXCLUDED oldest row (25 days)', /the oldest 25 days old/.test(lineA), lineA);

  // CONTROLS. These are the exact answers the old code gave, and they are the
  // only thing that distinguishes "counted the pool" from "counted the slice":
  // both produce a plausible sentence, and only these say which one ran.
  ok('CONTROL: it does NOT report the slice count of 20', !/20 email messages are unreviewed/.test(lineA), lineA);
  const oldestSelectedAge = Math.max(...picked.selected.map(
    (r) => Math.floor((NOW_A - Date.parse(r.received_at)) / DAY)));
  ok('CONTROL: the slice-derived age would have been 20, and is not used',
    oldestSelectedAge === 20 && !/the oldest 20 days old/.test(lineA), { oldestSelectedAge, lineA });

  // ── (2) a candidate pool that filled ⇒ every pool figure is a FLOOR ───────
  const FULL_POOL = Array.from({ length: reader.EMAIL_CANDIDATE_POOL }, (_, i) => ({
    id: 'f' + i,
    received_at: new Date(NOW_A - (i + 1) * 3600_000).toISOString(),
    action_status: 'unreviewed',
    triage_priority: 'normal',
  }));
  ok('the fixture is exactly the candidate pool size', FULL_POOL.length === 200, FULL_POOL.length);
  const pickedFull = reader.selectEmailMessages(FULL_POOL, 20);
  // The same predicate readEmailMessages applies: the read came back full, so
  // there may be more behind it and the count can only be a lower bound.
  const poolTruncated = FULL_POOL.length >= reader.EMAIL_CANDIDATE_POOL;
  const selFloor = reader.buildEmailSelection({ ...pickedFull, rows: pickedFull.selected, poolTruncated });
  ok('total_is_floor is set when the pool filled', selFloor.total_is_floor === true, selFloor);

  const lineFloor = compose.computeWorkspaceState(compose.minimizeInput({
    workstreams: [], open_loops: [], decisions: [], captures: [], agent_runs: [],
    email_ai_analyses: [], email_messages: pickedFull.selected, email_selection: selFloor,
  }, NOW_A), NOW_A).join(' | ');
  ok('a floored count is announced as "at least N", never as exact',
    /at least 200 email messages are unreviewed/.test(lineFloor), lineFloor);
  ok('...and the eligible total is floored too, from the same capped read',
    /\(of at least 200 eligible; 20 read\)/.test(lineFloor), lineFloor);
  // The AGE is a lower bound for the same reason, and this is the subtle one.
  // The pool is read newest-first and capped, so the rows that did not fit are
  // the OLDER ones — the pool's oldest is a floor, not the real oldest. A bare
  // age here would understate exactly the number the owner is most likely to
  // act on, while the counts beside it hedged correctly.
  ok('...and so is the AGE, because the pool holds the 200 NEWEST rows',
    /the oldest at least /.test(lineFloor) && /the oldest at least 8 days old/.test(lineFloor), lineFloor);

  // CONTROL: the same rows with an unfilled pool say it plainly, no hedge. A
  // check that printed "at least" unconditionally would pass the assertion
  // above and prove nothing (Lesson 3).
  const selExact = reader.buildEmailSelection({ ...pickedFull, rows: pickedFull.selected, poolTruncated: false });
  const lineExact = compose.computeWorkspaceState(compose.minimizeInput({
    workstreams: [], open_loops: [], decisions: [], captures: [], agent_runs: [],
    email_ai_analyses: [], email_messages: pickedFull.selected, email_selection: selExact,
  }, NOW_A), NOW_A).join(' | ');
  ok('CONTROL: an unfilled pool prints no "at least" anywhere',
    !/at least/.test(lineExact) && /200 email messages are unreviewed/.test(lineExact), lineExact);
  ok('CONTROL: ...and the SAME age is stated flat when the pool did not fill',
    /the oldest 8 days old/.test(lineExact), lineExact);

  // ── (3) THE TWO-SPELLINGS RULE ───────────────────────────────────────────
  //
  // reader.js selects on UNREVIEWED_ACTION_STATUS and compose.js counts on it.
  // Until 2026-08-26 each held its own 'unreviewed' string literal, from
  // opposite ends of one pipeline. Nothing would have thrown if they drifted:
  // both spellings are valid strings, they simply match different rows, and the
  // brief would have reported a number the selection never produced (Lesson
  // 20). This drives the SAME row through both and requires both to see it, so
  // a divergence cannot stay green.
  ok('the constant is exported from the reader', typeof reader.UNREVIEWED_ACTION_STATUS === 'string',
    reader.UNREVIEWED_ACTION_STATUS);

  const SPELLED = [{
    id: 'sp1', subject: 'spelled with the shared constant',
    received_at: new Date(NOW_A - 3 * DAY).toISOString(),
    action_status: reader.UNREVIEWED_ACTION_STATUS,
    triage_priority: 'normal',
  }];

  const spelledPick = reader.selectEmailMessages(SPELLED, 20);
  ok('END 1 — selectEmailMessages counts a row spelled with the constant',
    spelledPick.unreviewedTotal === 1, spelledPick);

  // The FALLBACK branch on purpose: no email_selection, so computeWorkspaceState
  // must filter the rows itself and therefore must use the same spelling.
  const spelledInput = compose.minimizeInput({
    workstreams: [], open_loops: [], decisions: [], captures: [], agent_runs: [],
    email_ai_analyses: [], email_messages: SPELLED,
  }, NOW_A);
  ok('the default selection supplies NO pool figure, so the fallback runs',
    spelledInput.email_selection.unreviewed_total === null &&
    spelledInput.email_selection.oldest_unreviewed_received_at === null,
    spelledInput.email_selection);
  const spelledLine = compose.computeWorkspaceState(spelledInput, NOW_A).join(' | ');
  ok('END 2 — computeWorkspaceState counts the SAME spelling',
    /1 email message is unreviewed/.test(spelledLine), spelledLine);
  ok('...and the fallback names its own narrower scope',
    /\(of the 1 read\)/.test(spelledLine), spelledLine);
  ok('...and still dates it', /the oldest 3 days old/.test(spelledLine), spelledLine);

  // A row the constant does NOT describe must be counted by neither end.
  const OTHER = [{ ...SPELLED[0], id: 'sp2', action_status: 'waiting' }];
  ok('CONTROL: a non-unreviewed row is counted by neither end',
    reader.selectEmailMessages(OTHER, 20).unreviewedTotal === 0 &&
    !/email message is unreviewed/.test(compose.computeWorkspaceState(compose.minimizeInput({
      workstreams: [], open_loops: [], decisions: [], captures: [], agent_runs: [],
      email_ai_analyses: [], email_messages: OTHER,
    }, NOW_A), NOW_A).join(' | ')));

  // A null pool figure must never be read as zero: an unknown count falls back
  // and says so, rather than composing "no unreviewed mail" out of a failed read.
  const unknown = reader.buildEmailSelection({
    rows: SPELLED, eligibleTotal: null, unreviewedTotal: null,
    oldestUnreviewedReceivedAt: null, poolTruncated: false,
  });
  ok('an unknown pool count stays null, never 0',
    unknown.unreviewed_total === null && unknown.oldest_unreviewed_received_at === null, unknown);
}

// ═══════════════════════════════════════════════════════════════════════════
section('the state section is surfaced deterministically');
{
  const NOW = new Date('2026-08-24T12:00:00Z');
  const input = compose.enforceTotalSize(compose.minimizeInput(rawData(), NOW.getTime()));
  const refs = [{ type: 'open_loop', id: IDS.loop }];

  const v = compose.validateBrief(briefCiting(refs, { not_enough_evidence: ['model said this'] }), input, NOW);
  ok('workspace_state is a first-class field', Array.isArray(v.brief.workspace_state) && v.brief.workspace_state.length > 0, v.brief.workspace_state);
  ok('the model\'s own evidence entries survive', v.brief.not_enough_evidence.includes('model said this'));
  ok('the state is MIRRORED into not_enough_evidence, so CoS renders it',
    v.brief.workspace_state.every((x) => v.brief.not_enough_evidence.includes(x)), v.brief.not_enough_evidence);

  // A model returning nothing cannot suppress it.
  const emptied = compose.validateBrief(briefCiting(refs, { not_enough_evidence: [] }), input, NOW);
  ok('a model returning no evidence gaps still gets the state section',
    emptied.brief.workspace_state.length > 0 && emptied.brief.not_enough_evidence.length > 0, emptied.brief.not_enough_evidence);

  // A model inventing its own workspace_state cannot override ours.
  const faked = compose.validateBrief(
    briefCiting(refs, { workspace_state: ['everything is fine, nothing to see'] }), input, NOW);
  ok('a model-supplied workspace_state is OVERWRITTEN, not trusted',
    !faked.brief.workspace_state.includes('everything is fine, nothing to see'), faked.brief.workspace_state);

  // The renderer shows it once, not twice.
  const out = renderBriefEmail(v.brief, NOW);
  ok('the email renders a State of the workspace section', /STATE OF THE WORKSPACE/.test(out.text), out.text.slice(0, 200));
  ok('html renders it too', /State of the workspace/.test(out.html));
  const line = v.brief.workspace_state[0];
  const occurrences = out.text.split(line).length - 1;
  ok('each state line appears EXACTLY ONCE in the email, despite the mirror',
    occurrences === 1, { line, occurrences });
  ok('the model\'s own gap still renders under Not enough evidence',
    /NOT ENOUGH EVIDENCE/.test(out.text) && out.text.includes('model said this'), out.text.slice(-400));
}

// ═══════════════════════════════════════════════════════════════════════════
section('truncation is announced, never silent');
{
  const input = compose.enforceTotalSize(compose.minimizeInput(rawData(), Date.parse('2026-08-17T11:00:00Z')));
  const refs = [{ type: 'open_loop', id: IDS.loop }];

  const truncated = { ...input, email_selection: { considered: 20, total: 63, truncated: true, total_is_floor: false } };
  const v = compose.validateBrief(briefCiting(refs, { not_enough_evidence: ['something else'] }), truncated);
  const note = v.brief.not_enough_evidence.join(' | ');
  ok('the brief states how many of how many were considered', /20 of 63/.test(note), note);
  ok('...and says the rest were not read', /not read/.test(note), note);
  ok('the model\'s own not_enough_evidence entries survive alongside it',
    v.brief.not_enough_evidence.includes('something else'), v.brief.not_enough_evidence);

  // The model cannot suppress it by returning an empty section.
  const emptied = compose.validateBrief(briefCiting(refs, { not_enough_evidence: [] }), truncated);
  ok('a model returning NO evidence gaps still gets the truncation note',
    /20 of 63/.test(emptied.brief.not_enough_evidence.join(' ')), emptied.brief.not_enough_evidence);

  // CONTROL: no truncation ⇒ no note. Otherwise every brief would claim one.
  const whole = { ...input, email_selection: { considered: 7, total: 7, truncated: false, total_is_floor: false } };
  const clean = compose.validateBrief(briefCiting(refs, { not_enough_evidence: [] }), whole);
  // Assert the absence of the TRUNCATION note specifically, not that the array
  // is empty: not_enough_evidence also carries the mirrored workspace_state, so
  // "length === 0" would fail for a reason that has nothing to do with
  // truncation. Assert on what only this feature can produce.
  ok('CONTROL: nothing truncated ⇒ no truncation note invented',
    !clean.brief.not_enough_evidence.some((x) => /eligible email messages were considered/.test(x)),
    clean.brief.not_enough_evidence);

  // A floored total must not be presented as exact.
  const floored = { ...input, email_selection: { considered: 20, total: 200, truncated: true, total_is_floor: true } };
  const f = compose.validateBrief(briefCiting(refs), floored);
  ok('a floored total says "at least"', /at least 200/.test(f.brief.not_enough_evidence.join(' ')), f.brief.not_enough_evidence);

  ok('withEmailTruncationNote tolerates a missing selection',
    compose.withEmailTruncationNote(['x'], undefined).join() === 'x');
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
section('derived facts — the model is handed conclusions, not raw dates');
{
  const NOW = Date.parse('2026-08-20T19:00:00Z');

  // The real 2026-08-20 case: Admin Panel, target 2026-07-23, a month gone.
  // The model read that date, repeated it, and never noticed it had passed.
  const min = compose.minimizeInput({
    workstreams: [
      { id: 'w1', name: 'Admin Panel', status: 'active', priority: 'high', health: 'ok',
        target_date: '2026-07-23', archived_at: null, created_at: '2026-06-01T00:00:00Z' },
      { id: 'w2', name: 'Future thing', status: 'active', priority: 'low', health: 'ok',
        target_date: '2026-12-01', archived_at: null, created_at: '2026-06-01T00:00:00Z' },
      { id: 'w3', name: 'No target', status: 'active', priority: 'low', health: 'ok',
        target_date: null, archived_at: null, created_at: '2026-06-01T00:00:00Z' },
    ],
    open_loops: [
      { id: 'l1', title: 'Overdue loop', status: 'open', priority: 'high',
        due_at: '2026-08-10T00:00:00Z', created_at: '2026-07-01T00:00:00Z' },
      { id: 'l2', title: 'Not due yet', status: 'open', priority: 'low',
        due_at: '2026-09-30T00:00:00Z', created_at: '2026-08-15T00:00:00Z' },
      { id: 'l3', title: 'No due date', status: 'open', priority: 'low',
        due_at: null, created_at: '2026-05-20T00:00:00Z' },
    ],
    decisions: [], captures: [], agent_runs: [], email_messages: [], email_ai_analyses: [],
  }, NOW);

  const w = Object.fromEntries(min.workstreams.map((x) => [x.id, x]));
  ok('a month-past target is quantified, not just present',
    w.w1.target_date_days_past === 28, w.w1.target_date_days_past);
  ok('a FUTURE target yields null, not a negative number',
    w.w2.target_date_days_past === null, w.w2.target_date_days_past);
  ok('no target date yields null', w.w3.target_date_days_past === null, w.w3.target_date_days_past);
  ok('the raw target_date is still carried alongside', w.w1.target_date === '2026-07-23');

  const l = Object.fromEntries(min.open_loops.map((x) => [x.id, x]));
  ok('an overdue loop says HOW overdue', l.l1.overdue === true && l.l1.overdue_days === 10,
    { overdue: l.l1.overdue, days: l.l1.overdue_days });
  ok('a not-yet-due loop has overdue_days null',
    l.l2.overdue === false && l.l2.overdue_days === null, l.l2.overdue_days);
  ok('every loop carries its age', l.l3.age_days === 92, l.l3.age_days);
  ok('age is independent of a due date', l.l2.age_days === 5, l.l2.age_days);

  // A resolved loop is not overdue however old its due date — the existing
  // isOverdue rule must still hold now that overdue_days keys off it.
  const resolved = compose.minimizeInput({
    workstreams: [], open_loops: [{ id: 'lr', title: 'Done', status: 'resolved', priority: 'low',
      due_at: '2026-01-01T00:00:00Z', created_at: '2025-12-01T00:00:00Z' }],
    decisions: [], captures: [], agent_runs: [], email_messages: [], email_ai_analyses: [],
  }, NOW);
  ok('CONTROL: a resolved loop is dropped as noise, so cannot be reported overdue',
    resolved.open_loops.length === 0, resolved.open_loops);

  ok('daysPast handles an unparseable date', compose.daysPast('not-a-date', NOW) === null);
  ok('daysPast handles null', compose.daysPast(null, NOW) === null);

  // The rules must TELL the model these exist, or it will keep doing its own
  // arithmetic and keep getting it wrong.
  const rules = compose.SYSTEM_RULES.join('\n');
  ok('the prompt names the derived fields', /target_date_days_past/.test(rules) && /overdue_days/.test(rules) && /age_days/.test(rules));
  ok('the prompt forbids the model doing its own date arithmetic', /[Dd]o not do date arithmetic/.test(rules));

  // Anti-padding. "At most 3" reads to a model as a target to fill: the
  // 2026-08-20 run returned three priorities from eight thin records and the
  // third restated a workstream title three times over.
  ok('the prompt asks for FEWER than three when unsupported', /FEWER than three/.test(rules), 'missing');
  ok('the prompt says one well-evidenced beats three thin', /One well-evidenced priority is a better brief/.test(rules), 'missing');
  ok('the prompt names title-restatement as padding', /only restates a record's title/.test(rules), 'missing');
  // The ceiling itself must survive — a prompt that discourages three must not
  // also stop enforcing the maximum.
  ok('CONTROL: the three-priority ceiling is still stated', /at most 3 priorities/i.test(rules), 'missing');
  ok('CONTROL: the ceiling is still ENFORCED in code', compose.LIMITS.max_priorities === 3);
}

// ═══════════════════════════════════════════════════════════════════════════
section('no prompt, no raw response, no full body is ever written');
{
  reset();
  const { deps, written } = makeDeps({ brief: briefCiting([{ type: 'email_message', id: IDS.mail }]) });
  const r = await runCosDailyBrief({ env: ARMED_ENV, now: new Date('2026-08-17T11:00:00Z'), deps });
  ok('CONTROL: the happy path did write a brief back', written.length === 1 && r.written === true, r);

  // The brief's generated_at must be the JOB'S clock, not a later one snapped
  // inside the validator. Both it and the row's expires_at derive from `now`,
  // so they must agree; letting validateBrief default would drift them apart by
  // however long the model call took (~9s in production).
  ok('the brief carries the JOB\'s now, not a later instant',
    r.brief.generated_at === '2026-08-17T11:00:00.000Z', r.brief.generated_at);

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
section('the writeback row — a contract with CoS\'s own persist()');
{
  const writer = await import('../src/services/cos/writer.js');
  const input = compose.enforceTotalSize(compose.minimizeInput(rawData(), Date.parse('2026-08-17T11:00:00Z')));
  const v = compose.validateBrief(briefCiting([{ type: 'open_loop', id: IDS.loop }]), input);
  const row = writer.buildBriefRow({
    userId: 'cos-owner-uuid', brief: v.brief, minimizedInput: input,
    model: 'gpt-4.1-mini', latencyMs: 8633, tokens: 2029,
    now: new Date('2026-08-20T19:17:56.164Z'),
  });

  // generated_at belongs to the CoS DATABASE. Writing it from this runtime put
  // a 29-second falsehood in the 2026-08-20 row, and latestStoredBrief() orders
  // by that column.
  ok('generated_at is NOT in the row', !('generated_at' in row), Object.keys(row));

  // CONTROL: expires_at IS still set from this clock, because CoS does the same.
  // Without this, "generated_at absent" would also pass if the builder had
  // simply stopped emitting timestamps altogether.
  ok('CONTROL: expires_at IS set (CoS computes it the same way)',
    row.expires_at === '2026-08-21T07:17:56.164Z', row.expires_at);

  // Every column CoS's own persist() writes, present and correctly shaped.
  ok('generation_mode is ai (or the app never selects it)', row.generation_mode === 'ai');
  ok('schema_version matches', row.schema_version === 'today_brief_v1');
  ok('model is carried', row.model === 'gpt-4.1-mini');
  ok('input_fingerprint is a sha256 hex digest', /^[0-9a-f]{64}$/.test(row.input_fingerprint), row.input_fingerprint);
  ok('structured_output is the validated brief', row.structured_output === v.brief);
  ok('source_refs is an array', Array.isArray(row.source_refs));
  ok('status ok', row.status === 'ok');
  ok('error_category absent (status=ok ⇒ must be null)', !('error_category' in row));
  ok('latency_bucket uses CoS buckets', row.latency_bucket === '5-15s', row.latency_bucket);
  ok('token_bucket uses CoS buckets', row.token_bucket === '1-5k', row.token_bucket);

  // The exact column set, so an accidental addition or removal is caught.
  const expected = ['user_id','schema_version','generation_mode','model','input_fingerprint',
    'structured_output','source_refs','status','latency_bucket','token_bucket','expires_at'];
  ok('the row has EXACTLY the CoS column set', JSON.stringify(Object.keys(row).sort()) === JSON.stringify(expected.sort()), Object.keys(row));
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

  // THE PRECHECK IS FORCED OPEN FOR THIS RUN, DELIBERATELY.
  //
  // The cheap SELECT added in 2026-08-26 would stop this second run before it
  // gathered anything, and the assertions below would then pass while proving
  // NOTHING about the mechanism they exist for. The precheck is a cost gate,
  // not a lock: two concurrent ticks can both read "nothing sent" and both
  // proceed, and only the PRIMARY KEY separates them. Driving it open puts this
  // run back inside exactly that window, so what refuses the second send here
  // is still the ledger's 23505 collision — which is the thing that actually
  // makes two scheduler ticks safe.
  const second = makeDeps({ brief, db });
  second.deps.precheck = async () => ({ blocked: false });
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
  third.deps.precheck = async () => ({ blocked: false });
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
section('pre-check — a day already sent costs nothing to refuse');
{
  // Before this, a second tick after a completed send read eight CoS tables and
  // paid for a full billable model call before the ledger told it no. The
  // precheck is a READ placed ahead of that work. It is NOT a lock and does not
  // replace the atomic claim — see the double-send section, which drives it
  // open on purpose to keep testing the 23505 race it cannot cover.
  const brief = briefCiting([{ type: 'open_loop', id: IDS.loop }]);
  const NOW_P = new Date('2026-08-26T11:00:00Z');
  const KEY = ledger.ledgerKey(NOW_P);

  // Counts the two expensive steps the precheck exists to skip.
  function countingDeps(opts) {
    const made = makeDeps(opts);
    const counts = { gathers: 0, models: 0 };
    const g = made.deps.gather;
    const m = made.deps.callModel;
    made.deps.gather = async (a) => { counts.gathers++; return g(a); };
    made.deps.callModel = async (a) => { counts.models++; return m(a); };
    return { ...made, counts };
  }

  // ── (5) a sent row for today stops the run before anything is spent ───────
  reset();
  const dbSent = fakeDb();
  dbSent.rows.set(KEY, { status: 'sent', sent_at: '2026-08-26T11:00:02Z' });
  const sentRun = countingDeps({ brief, db: dbSent });
  let r5;
  const evts5 = await captureLogs(async () => {
    r5 = await runCosDailyBrief({ env: ARMED_ENV, now: NOW_P, deps: sentRun.deps });
  });

  ok('sent row: gather is never called', sentRun.counts.gathers === 0, sentRun.counts);
  ok('sent row: the model is never called — nothing billed', sentRun.counts.models === 0, sentRun.counts);
  ok('sent row: ZERO sends on the wire', sends.length === 0, sends.length);
  ok('sent row: nothing written back', sentRun.written.length === 0, sentRun.written.length);
  ok('sent row: reported as already_sent, flagged as a precheck stop',
    r5.ran === true && r5.reason === 'already_sent' && r5.sent === false &&
    r5.written === false && r5.precheck === true, r5);
  ok('sent row: the stop is ANNOUNCED, not silent',
    Boolean(eventNamed(evts5, 'cos.brief.skipped_precheck')) &&
    eventNamed(evts5, 'cos.brief.skipped_precheck').outcome === 'already_sent',
    eventNamed(evts5, 'cos.brief.skipped_precheck'));

  // THE READ-ONLY PROPERTY. A precheck that wrote would consume the day's slot
  // on a run that composed nothing — the stuck-'claimed' state the ledger
  // header says needs a human to clear.
  ok('the precheck INSERTED nothing and UPDATED nothing',
    dbSent.rows.size === 1 && dbSent.rows.get(KEY).status === 'sent' &&
    dbSent.rows.get(KEY).sent_at === '2026-08-26T11:00:02Z', [...dbSent.rows.entries()]);

  // A row still 'claimed' blocks too, under its own distinguishable reason.
  reset();
  const dbClaimed = fakeDb();
  dbClaimed.rows.set(KEY, { status: 'claimed', claimed_at: NOW_P.toISOString() });
  const claimedRun = countingDeps({ brief, db: dbClaimed });
  const rClaimed = await runCosDailyBrief({ env: ARMED_ENV, now: NOW_P, deps: claimedRun.deps });
  ok('an unfinished claim also stops the run, as already_claimed',
    rClaimed.reason === 'already_claimed' && rClaimed.precheck === true &&
    claimedRun.counts.models === 0 && sends.length === 0, { rClaimed, counts: claimedRun.counts });

  // CONTROL: with an EMPTY ledger the identical setup runs all the way through
  // and sends. Without this, every assertion above would also pass for a
  // precheck that blocked unconditionally (Lesson 3).
  reset();
  const dbEmpty = fakeDb();
  const openRun = countingDeps({ brief, db: dbEmpty });
  const rOpen = await runCosDailyBrief({ env: ARMED_ENV, now: NOW_P, deps: openRun.deps });
  ok('CONTROL: an empty ledger gathers, calls the model ONCE, and sends',
    openRun.counts.gathers === 1 && openRun.counts.models === 1 &&
    sends.length === 1 && rOpen.sent === true,
    { counts: openRun.counts, sends: sends.length, rOpen });

  // ── (6) the precheck's read throws ⇒ continue exactly as before ───────────
  //
  // Fails OPEN here and only here. claimSend() reads the same table further
  // down and fails CLOSED on the same fault, so the no-duplicate guarantee is
  // untouched — this run just pays full price to be refused there instead.
  const throwingRead = {
    from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => { throw new Error('ledger read exploded'); },
    }) }) }),
  };
  reset();
  const dbGood = fakeDb();
  const thrown = countingDeps({ brief, db: dbGood });
  thrown.deps.precheck = (a) => ledger.alreadySentToday({ ...a, db: throwingRead });
  let r6;
  const evts6 = await captureLogs(async () => {
    r6 = await runCosDailyBrief({ env: ARMED_ENV, now: NOW_P, deps: thrown.deps });
  });
  ok('a throwing precheck does NOT abort the run', r6.ran === true && r6.reason === 'ok', r6);
  ok('...the model is still called exactly ONCE', thrown.counts.models === 1, thrown.counts);
  ok('...the claim path runs as before and the send happens',
    sends.length === 1 && r6.sent === true, { sends: sends.length, r6 });
  ok('...and the day is claimed and marked by the normal path',
    dbGood.rows.get(KEY) && dbGood.rows.get(KEY).status === 'sent', [...dbGood.rows.entries()]);
  const unavail = eventNamed(evts6, 'cos.precheck.unavailable');
  ok('...the failure is ANNOUNCED at warn, never swallowed',
    Boolean(unavail) && unavail.level === 'warn', unavail);
  ok('...and the announcement carries the real error text (Lesson 17)',
    Boolean(unavail) && /ledger read exploded/.test(String(unavail.message)), unavail && unavail.message);

  // The unit-level contract, driven directly: any error ⇒ unavailable, never
  // blocked, and never a write.
  const errRead = {
    from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: null, error: { code: '42P01', message: 'no such table' } }),
    }) }) }),
  };
  const unavailable = await ledger.alreadySentToday({ now: NOW_P, db: errRead });
  ok('alreadySentToday: an error is unavailable, NOT blocked',
    unavailable.blocked === false && unavailable.unavailable === true &&
    unavailable.errorCode === '42P01', unavailable);
  const clean = await ledger.alreadySentToday({ now: NOW_P, db: fakeDb() });
  ok('CONTROL: a clean empty ledger is simply not blocked',
    clean.blocked === false && clean.unavailable === undefined, clean);

  // ── (7) yesterday's key does not block today ──────────────────────────────
  reset();
  const dbYesterday = fakeDb();
  const YESTERDAY = new Date('2026-08-25T11:00:00Z');
  const YKEY = ledger.ledgerKey(YESTERDAY);
  ok('the two days really are different keys', YKEY !== KEY, { YKEY, KEY });
  dbYesterday.rows.set(YKEY, { status: 'sent', sent_at: YESTERDAY.toISOString() });
  const dayRun = countingDeps({ brief, db: dbYesterday });
  const r7 = await runCosDailyBrief({ env: ARMED_ENV, now: NOW_P, deps: dayRun.deps });
  ok("yesterday's sent row does not block today", r7.sent === true && sends.length === 1, { r7, sends: sends.length });
  ok('...the model was called for today', dayRun.counts.models === 1, dayRun.counts);
  ok("...and yesterday's row is untouched",
    dbYesterday.rows.get(YKEY).sent_at === YESTERDAY.toISOString(), dbYesterday.rows.get(YKEY));
  const yCheck = await ledger.alreadySentToday({ now: NOW_P, db: dbYesterday });
  ok('the precheck reads TODAY\'s key only', yCheck.blocked === true && yCheck.reason === 'already_sent', yCheck);

  // ── (8) the rehearsal rungs ignore the precheck entirely ─────────────────
  //
  // Neither claims the ledger and neither sends, so an existing row says
  // nothing about whether they should run. Blocking them would make a rehearsal
  // depend on a real send having happened — which is the one thing a rehearsal
  // must not need.
  for (const [flag, expected] of [
    ['COS_BRIEF_WRITEBACK_ONLY', 'writeback_only'],
    ['COS_BRIEF_DRY_RUN', 'dry_run'],
  ]) {
    reset();
    const dbRehearse = fakeDb();
    dbRehearse.rows.set(KEY, { status: 'sent', sent_at: '2026-08-26T11:00:02Z' });
    const run = countingDeps({ brief, db: dbRehearse });
    const rr = await runCosDailyBrief({
      env: { ...ARMED_ENV, [flag]: 'true' }, now: NOW_P, deps: run.deps,
    });
    ok(`${expected}: a sent row does NOT stop it — the model is still called`,
      run.counts.models === 1 && run.counts.gathers === 1, run.counts);
    ok(`${expected}: it reports its own mode, not already_sent`,
      rr.reason === expected && rr.precheck === undefined, rr);
    ok(`${expected}: still sends nothing`, sends.length === 0, sends.length);
    ok(`${expected}: leaves the ledger row exactly as it found it`,
      dbRehearse.rows.size === 1 && dbRehearse.rows.get(KEY).status === 'sent',
      [...dbRehearse.rows.entries()]);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('timing — the model call and the send each report what they cost');
{
  // Until now the only record of a model call's cost was the spend row, and
  // that is written ONLY when COS_BRIEF_USAGE_USER_ID is set — so on the
  // current deploy, where it is unset, the job's latency and token count
  // existed nowhere at all.
  reset();
  const { deps } = makeDeps({ brief: briefCiting([{ type: 'open_loop', id: IDS.loop }]), db: fakeDb() });
  let rT;
  const evtsT = await captureLogs(async () => {
    rT = await runCosDailyBrief({ env: ARMED_ENV, now: new Date('2026-08-26T11:00:00Z'), deps });
  });
  ok('CONTROL: the run really did compose and send', rT.sent === true && sends.length === 1, rT);

  const composed = eventNamed(evtsT, 'cos.compose.ok');
  ok('cos.compose.ok carries a FINITE latency_ms',
    Boolean(composed) && Number.isFinite(composed.latency_ms), composed);
  ok('...and names the outcome, the tokens and the model that actually ran',
    Boolean(composed) && composed.outcome === 'composed' &&
    composed.tokens === 150 && composed.model === 'gpt-4.1-mini', composed);

  const sentEvt = eventNamed(evtsT, 'cos.send.ok');
  ok('cos.send.ok carries a FINITE latency_ms',
    Boolean(sentEvt) && Number.isFinite(sentEvt.latency_ms), sentEvt);
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
