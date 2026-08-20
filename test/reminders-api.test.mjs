// UI-09 — Reminders READ API: GET /api/reminders. Auth wall, user-scoping,
// the reminders↔messages delivery join, status filters, ordering, and the
// read-only guarantee. Run: bun test/reminders-api.test.mjs
//
// What runs REAL here: the express router + auth middleware exactly as
// production wires them (createRemindersRouter() with default deps). One seam
// is faked, via bun's mock.module: the Supabase client (in-memory tables from
// test/web-fakes.mjs — imported, not edited).
//
// Coverage (UI-09):
//   • JWT required; forged/absent/unlinked JWT rejected; a GET writes nothing
//   • default view = live reminders (pending/snoozed/sent), canceled excluded
//   • each reminder carries its delivery state from the linked outbound
//     message (delivered / failed+error_code / null when never dispatched)
//   • user A never sees user B's reminders; a reminder mis-linked to another
//     user's message reports delivery:null (message read is user-scoped too)
//   • ?status=pending|sent|snoozed|canceled|all filters; unknown ?status → 422
//   • ?limit clamps; ordering is trigger_at DESC
//   • response never leaks user_id / sent_message_id or other internals
//   • pure helpers: resolveStatusFilter / clampLimit / deliveryOf

import crypto from 'node:crypto';
import { mock } from 'bun:test';

// ── Env BEFORE any src import: config.js fail-closed-requires these. Dummy
// values only — the Supabase seam is faked, nothing can reach a real host.
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

import { makeFakeSupabase } from './web-fakes.mjs';

// ── Seed data ───────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID();
const uA = uid(), uB = uid();
const pA = uid(); // a person owned by A (person_id passthrough)

// messages = the delivery ledger. A dispatched reminder links its outbound SMS
// here; the Twilio callback writes provider_status.
const M = { delivered: uid(), failed: uid(), bMsg: uid() };
const msg = (id, user_id, extra) => ({
  id, user_id, direction: 'outbound', channel: 'sms', provider: 'twilio',
  message_type: 'reminder', sent_at: '2026-07-15T12:00:00.000Z', ...extra,
});

// reminders. Distinct trigger_at per row so DESC ordering is unambiguous.
const R = {
  pendingSoon: uid(), pendingOverdue: uid(), snoozed: uid(), sendingNow: uid(),
  sentDelivered: uid(), sentFailed: uid(), crossLinked: uid(), failedDispatch: uid(),
  canceled: uid(), bPending: uid(), bSent: uid(),
};
const rem = (id, user_id, status, trigger_at, extra = {}) => ({
  id, user_id, person_id: null, title: 'Reach out', note: null,
  reminder_type: 'custom', status, trigger_at, sent_message_id: null,
  created_by: 'cedrus', source_message_id: null,
  created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
  ...extra,
});

const db = {
  app_users: [
    { id: uA, auth_user_id: 'auth-a', name: 'Alba', phone: '15551110001', plan: 'trialing', onboarding_complete: true, opted_out: false },
    { id: uB, auth_user_id: 'auth-b', name: 'Bram', phone: '15551110002', plan: 'trialing', onboarding_complete: true, opted_out: false },
  ],
  messages: [
    msg(M.delivered, uA, { provider_status: 'delivered', provider_payload: { last_status: 'delivered', error_code: null } }),
    msg(M.failed, uA, { provider_status: 'failed', provider_payload: { last_status: 'failed', error_code: 30003 } }),
    msg(M.bMsg, uB, { provider_status: 'delivered', provider_payload: null }),
  ],
  reminders: [
    // user A — non-canceled (the default "live" view), newest trigger first.
    // Covers all five live states incl. the delivery-states migration's
    // 'sending' (in-flight) and 'failed' (dispatch reaped, never got a message).
    rem(R.pendingSoon, uA, 'pending', '2026-08-10T15:00:00.000Z', { person_id: pA, title: 'Call Mom' }),
    rem(R.sendingNow, uA, 'sending', '2026-08-07T15:00:00.000Z', { claimed_at: '2026-08-07T15:00:00.000Z', attempts: 1 }),
    rem(R.snoozed, uA, 'snoozed', '2026-08-05T15:00:00.000Z'),
    rem(R.pendingOverdue, uA, 'pending', '2026-07-20T15:00:00.000Z'),
    rem(R.crossLinked, uA, 'sent', '2026-07-18T15:00:00.000Z', { sent_message_id: M.bMsg }), // links B's msg on purpose
    rem(R.sentDelivered, uA, 'sent', '2026-07-15T15:00:00.000Z', { sent_message_id: M.delivered }),
    rem(R.sentFailed, uA, 'sent', '2026-07-10T15:00:00.000Z', { sent_message_id: M.failed }),
    rem(R.failedDispatch, uA, 'failed', '2026-07-05T15:00:00.000Z', { failed_at: '2026-07-05T15:05:00.000Z', failure_reason: 'stuck_claim_reaped', attempts: 1 }),
    // user A — canceled (excluded from default)
    rem(R.canceled, uA, 'canceled', '2026-06-01T15:00:00.000Z'),
    // user B — must never appear for A
    rem(R.bPending, uB, 'pending', '2026-08-01T15:00:00.000Z'),
    rem(R.bSent, uB, 'sent', '2026-07-22T15:00:00.000Z', { sent_message_id: M.bMsg }),
  ],
};

const TOKENS = { 'tok-a': 'auth-a', 'tok-b': 'auth-b', 'tok-unlinked': 'auth-nobody' };

const fakeSupabase = makeFakeSupabase({ db, tokens: TOKENS });

// The one seam. Registered before anything imports src/, so every real module
// (router + auth middleware) gets the fake.
mock.module('../src/lib/supabase.js', () => ({ supabase: fakeSupabase }));

const express = (await import('express')).default;
const {
  createRemindersRouter, resolveStatusFilter, clampLimit, deliveryOf,
  MSG_BAD_STATUS, REMINDER_STATUSES,
} = await import('../src/routes/api/reminders.js');

// ── Harness ───────────────────────────────────────────────────────────────
let failures = 0;
const p = (...a) => console.log(...a);
function check(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}

// Production wiring: default deps, the fake arrives via the mocked lib module.
const app = express();
app.use(express.json({ limit: '100kb' })); // mirror index.js's app-wide parser
app.use('/api/reminders', createRemindersRouter());
const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api/reminders`;

async function call(path = '', { method = 'GET', token, rawAuth } = {}) {
  const headers = {};
  if (rawAuth) headers.authorization = rawAuth;
  else if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const ids = (res) => (res.json.reminders || []).map((r) => r.id);
const byId = (res, id) => (res.json.reminders || []).find((r) => r.id === id);

const PUBLIC_KEYS = ['created_at', 'delivery', 'id', 'note', 'person_id',
  'reminder_type', 'status', 'title', 'trigger_at'];
const DELIVERY_KEYS = ['error_code', 'message_type', 'sent_at', 'status'];
const keysOf = (o) => Object.keys(o).sort().join(',');

// ════════════════════════════════════════════════════════════════════════════
p('── 1. Auth wall: fail closed, GET writes nothing ──');
{
  const before = db.reminders.length;
  const noHeader = await call('', {});
  check('GET without header → 401 auth_required',
    noHeader.status === 401 && noHeader.json.error === 'auth_required', noHeader);
  const forged = await call('', { token: 'tok-forged' });
  check('forged token → 401', forged.status === 401 && forged.json.error === 'auth_required', forged);
  const badScheme = await call('', { rawAuth: 'Basic abc' });
  check('non-bearer scheme → 401', badScheme.status === 401, badScheme);
  const unlinked = await call('', { token: 'tok-unlinked' });
  check('valid token, no linked account → 403 no_linked_account',
    unlinked.status === 403 && unlinked.json.error === 'no_linked_account', unlinked);
  check('auth-wall probes wrote nothing', db.reminders.length === before, db.reminders.length);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 2. Default view: live reminders, canceled excluded, DESC order ──');
let A_default;
{
  A_default = await call('', { token: 'tok-a' });
  check('200 OK', A_default.status === 200, A_default.status);
  check('count matches body length',
    A_default.json.count === (A_default.json.reminders || []).length, A_default.json);
  check('exactly A\'s 8 non-canceled reminders',
    A_default.json.count === 8, A_default.json.count);
  check('canceled row excluded by default', !ids(A_default).includes(R.canceled), ids(A_default));
  check('default view surfaces in-flight (sending) + dispatch-failed (failed) states',
    ids(A_default).includes(R.sendingNow) && ids(A_default).includes(R.failedDispatch), ids(A_default));
  check('no user B rows leak',
    !ids(A_default).includes(R.bPending) && !ids(A_default).includes(R.bSent), ids(A_default));
  check('ordered trigger_at DESC',
    ids(A_default).join(',') === [R.pendingSoon, R.sendingNow, R.snoozed, R.pendingOverdue, R.crossLinked, R.sentDelivered, R.sentFailed, R.failedDispatch].join(','),
    ids(A_default));
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 3. Delivery join: state pulled from the linked message ──');
{
  const pend = byId(A_default, R.pendingSoon);
  check('pending reminder → delivery null (never dispatched)', pend.delivery === null, pend);
  check('pending reminder passes through person_id/title', pend.person_id === pA && pend.title === 'Call Mom', pend);

  const del = byId(A_default, R.sentDelivered);
  check('sent+delivered → delivery.status "delivered"', del.delivery && del.delivery.status === 'delivered', del);
  check('delivered → error_code null', del.delivery && del.delivery.error_code === null, del);
  check('delivered → message_type "reminder"', del.delivery && del.delivery.message_type === 'reminder', del);
  check('delivered → sent_at present', del.delivery && typeof del.delivery.sent_at === 'string', del);

  const fail = byId(A_default, R.sentFailed);
  check('sent+failed → delivery.status "failed"', fail.delivery && fail.delivery.status === 'failed', fail);
  check('failed → error_code stringified from provider_payload', fail.delivery && fail.delivery.error_code === '30003', fail);

  const snz = byId(A_default, R.snoozed);
  check('snoozed (legacy in-flight) → delivery null', snz.delivery === null, snz);

  // Two distinct failure surfaces: reminder.status='failed' (dispatch reaped,
  // no message) vs status='sent' + delivery.status='failed' (carrier failed).
  const fd = byId(A_default, R.failedDispatch);
  check('dispatch-failed reminder → status "failed", delivery null (never got a message)',
    fd.status === 'failed' && fd.delivery === null, fd);
  check('sentFailed differs: status "sent" but delivery.status "failed" (carrier-level)',
    byId(A_default, R.sentFailed).status === 'sent', byId(A_default, R.sentFailed));

  const sending = byId(A_default, R.sendingNow);
  check('in-flight reminder → status "sending", delivery null', sending.status === 'sending' && sending.delivery === null, sending);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 4. Cross-tenant isolation ──');
{
  const cross = byId(A_default, R.crossLinked);
  check('A\'s reminder mis-linked to B\'s message → delivery null (message read scoped to A)',
    cross.status === 'sent' && cross.delivery === null, cross);

  const B = await call('', { token: 'tok-b' });
  check('B sees only its own 2 reminders', B.json.count === 2, B.json.count);
  check('B\'s ids are exactly bPending + bSent',
    ids(B).sort().join(',') === [R.bPending, R.bSent].sort().join(','), ids(B));
  const bSent = byId(B, R.bSent);
  check('B\'s own linked message resolves → delivery "delivered"',
    bSent.delivery && bSent.delivery.status === 'delivered', bSent);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 5. ?status filter ──');
{
  const pending = await call('?status=pending', { token: 'tok-a' });
  check('?status=pending → only pending rows',
    ids(pending).join(',') === [R.pendingSoon, R.pendingOverdue].join(','), ids(pending));

  const sent = await call('?status=sent', { token: 'tok-a' });
  check('?status=sent → only sent rows (delivery log)',
    ids(sent).join(',') === [R.crossLinked, R.sentDelivered, R.sentFailed].join(','), ids(sent));

  const snoozed = await call('?status=snoozed', { token: 'tok-a' });
  check('?status=snoozed → only the legacy in-flight row',
    ids(snoozed).join(',') === [R.snoozed].join(','), ids(snoozed));

  const sending = await call('?status=sending', { token: 'tok-a' });
  check('?status=sending → only the in-flight (sending) row',
    ids(sending).join(',') === [R.sendingNow].join(','), ids(sending));

  const failed = await call('?status=failed', { token: 'tok-a' });
  check('?status=failed → only the dispatch-failed row',
    ids(failed).join(',') === [R.failedDispatch].join(','), ids(failed));

  const canceled = await call('?status=canceled', { token: 'tok-a' });
  check('?status=canceled → only the canceled row',
    ids(canceled).join(',') === [R.canceled].join(','), ids(canceled));

  const upper = await call('?status=SENT', { token: 'tok-a' });
  check('?status is case-insensitive', upper.json.count === 3, upper.json.count);

  const all = await call('?status=all', { token: 'tok-a' });
  check('?status=all → all 9 of A\'s rows (incl canceled)', all.json.count === 9, all.json.count);
  check('?status=all includes canceled', ids(all).includes(R.canceled), ids(all));

  const bogus = await call('?status=bogus', { token: 'tok-a' });
  check('?status=bogus → 422 invalid_request',
    bogus.status === 422 && bogus.json.error === 'invalid_request', bogus);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 6. ?limit clamps ──');
{
  const one = await call('?limit=1', { token: 'tok-a' });
  check('?limit=1 → 1 row', one.json.count === 1, one.json.count);
  const zero = await call('?limit=0', { token: 'tok-a' });
  check('?limit=0 → falls back to default (all 8)', zero.json.count === 8, zero.json.count);
  const junk = await call('?limit=abc', { token: 'tok-a' });
  check('?limit=abc → falls back to default (all 8)', junk.json.count === 8, junk.json.count);
  const huge = await call('?limit=9999', { token: 'tok-a' });
  check('?limit=9999 → no error, capped (still 8 rows exist)', huge.status === 200 && huge.json.count === 8, huge.json.count);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 7. No internal columns leak ──');
{
  for (const r of A_default.json.reminders) {
    check(`reminder ${r.id.slice(0, 8)} exposes only public keys`, keysOf(r) === PUBLIC_KEYS.join(','), keysOf(r));
    check(`reminder ${r.id.slice(0, 8)} hides user_id/sent_message_id`,
      r.user_id === undefined && r.sent_message_id === undefined
      && r.created_by === undefined && r.source_message_id === undefined && r.updated_at === undefined, Object.keys(r));
  }
  const del = byId(A_default, R.sentDelivered);
  check('delivery sub-object exposes only public keys', keysOf(del.delivery) === DELIVERY_KEYS.join(','), keysOf(del.delivery));
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 8. Read-only: no GET mutated the store ──');
{
  check('reminders row count unchanged after all reads', db.reminders.length === 11, db.reminders.length);
  const overdue = db.reminders.find((r) => r.id === R.pendingOverdue);
  check('overdue pending reminder NOT dispatched (still pending)', overdue.status === 'pending', overdue.status);
  const snz = db.reminders.find((r) => r.id === R.snoozed);
  check('snoozed reminder untouched', snz.status === 'snoozed', snz.status);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 9. Pure helpers ──');
{
  check('resolveStatusFilter(undefined) → default live set (all but canceled)',
    JSON.stringify(resolveStatusFilter(undefined)) === JSON.stringify(['pending', 'sent', 'snoozed', 'sending', 'failed']));
  check('resolveStatusFilter("all") → null (no filter)', resolveStatusFilter('all') === null);
  check('resolveStatusFilter("sent") → ["sent"]', JSON.stringify(resolveStatusFilter('sent')) === '["sent"]');
  check('resolveStatusFilter("SENT") case-insensitive', JSON.stringify(resolveStatusFilter('SENT')) === '["sent"]');
  let threw = false;
  try { resolveStatusFilter('nope'); } catch (e) { threw = e.status === 422 && e.code === 'invalid_request'; }
  check('resolveStatusFilter(bad) throws 422 invalid_request', threw);

  check('clampLimit(undefined) → 100', clampLimit(undefined) === 100);
  check('clampLimit("50") → 50', clampLimit('50') === 50);
  check('clampLimit("9999") → 200 (max)', clampLimit('9999') === 200);
  check('clampLimit("0") → 100 (default)', clampLimit('0') === 100);
  check('clampLimit("abc") → 100 (default)', clampLimit('abc') === 100);

  check('deliveryOf(null) → null', deliveryOf(null) === null);
  const d = deliveryOf({ provider_status: 'failed', provider_payload: { error_code: 30003 }, sent_at: 'x', message_type: 'reminder' });
  check('deliveryOf maps status + stringifies error_code',
    d.status === 'failed' && d.error_code === '30003' && d.sent_at === 'x' && d.message_type === 'reminder', d);
  const d2 = deliveryOf({ provider_status: 'queued', provider_payload: null });
  check('deliveryOf tolerates missing payload/fields',
    d2.status === 'queued' && d2.error_code === null && d2.sent_at === null && d2.message_type === null, d2);

  check('REMINDER_STATUSES mirrors the widened schema CHECK set (migration 20260719120001)',
    REMINDER_STATUSES.join(',') === 'pending,sent,snoozed,canceled,sending,failed', REMINDER_STATUSES);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 10. Voice: user-facing copy obeys the spec ──');
{
  check('MSG_BAD_STATUS has no em dash', !MSG_BAD_STATUS.includes('—'));
  check('MSG_BAD_STATUS has no exclamation mark', !MSG_BAD_STATUS.includes('!'));
}

// ════════════════════════════════════════════════════════════════════════════
server.close();
p('');
if (failures === 0) p('ALL REMINDERS-API TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
