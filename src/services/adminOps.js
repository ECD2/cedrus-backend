import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { config } from '../config.js';
import adminRouter from '../routes/admin.js';

// ─────────────────────────────────────────────────────────────────────────
// Admin Panel operations (N1)
//
// Read-model + reset pass-through behind /admin/users*, /admin/testers.
// Contract: docs/ADMIN_API_CONTRACT.md (frozen for N4's mock UI).
//
// Two invariants every function here enforces, because the route layer must
// not be able to forget them:
//   • No full phone number and no message body ever appears in a return
//     value — phones leave as `phone_last4`, message rows are fetched
//     without their `body` column at all.
//   • The reset is NOT reimplemented. resetUserById() resolves id → phone
//     and dispatches the existing hardened POST /admin/reset-user handler
//     (src/routes/admin.js) in-process, so the TESTER_PHONES gate, the
//     consent/audit preservation list and the account-rewind semantics have
//     exactly one implementation. If that route ever changes, the panel
//     inherits the change with zero drift.
// ─────────────────────────────────────────────────────────────────────────

// Panel token: ADMIN_PANEL_TOKEN if set (rotatable independently of Emil's
// curl key, since this one will live in a browser), else ADMIN_KEY. Read
// lazily so a token rotation doesn't require a code change. Empty ⇒ the
// panel fails closed (routes 404; see adminPanel.js).
function panelToken() {
  const fromEnv = (typeof process !== 'undefined' && process.env)
    ? process.env.ADMIN_PANEL_TOKEN : undefined;
  return fromEnv || config.adminKey || '';
}

export function panelTokenConfigured() {
  return Boolean(panelToken());
}

// Same constant-time comparison pattern as routes/admin.js keyMatches():
// length mismatch returns early (length is not secret), byte comparison is
// crypto.timingSafeEqual so a prefix-guessing attacker learns nothing.
export function panelTokenMatches(provided) {
  const expected = panelToken();
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Strict uuid shape for :id params — rejects garbage before it reaches a
// Postgres uuid cast (which would 500 instead of 400).
export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function getUserById(userId) {
  const { data } = await supabase.from('app_users')
    .select('*').eq('id', userId).maybeSingle();
  return data || null;
}

async function countRows(table, userId) {
  const { count } = await supabase.from(table)
    .select('*', { count: 'exact', head: true }).eq('user_id', userId);
  return count || 0;
}

function last4(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.slice(-4);
}

// ── GET /admin/users ────────────────────────────────────────────────────
// Paginated roster, newest account first. Exact per-user head-counts:
// 3 count queries per row is fine at beta scale (revisit past ~200 users —
// noted in the contract).
export async function listUsers({ limit = 25, offset = 0 } = {}) {
  const { count: total } = await supabase.from('app_users')
    .select('*', { count: 'exact', head: true });
  const { data: rows } = await supabase.from('app_users')
    .select('id, phone, name, plan, billing_status, trial_ends_at, created_at, onboarding_complete, opted_out, last_active_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const users = await Promise.all((rows || []).map(async (u) => {
    const [people, facts, reminders] = await Promise.all([
      countRows('people', u.id), countRows('facts', u.id), countRows('reminders', u.id),
    ]);
    return {
      id: u.id,
      user_ref: 'u_' + u.id,
      phone_last4: last4(u.phone), // the full phone never leaves this function
      name: u.name ?? null,
      plan: u.plan,
      billing_status: u.billing_status,
      trial_ends_at: u.trial_ends_at ?? null,
      created_at: u.created_at,
      onboarding_complete: Boolean(u.onboarding_complete),
      opted_out: Boolean(u.opted_out),
      last_active_at: u.last_active_at ?? null,
      counts: { people, facts, reminders },
    };
  }));

  return { users, page: { limit, offset, total: total || 0 } };
}

// ── GET /admin/users/:id/health ─────────────────────────────────────────
// "Is Cedrus working for this tester": recent delivery outcomes (from the
// delivery-callback data recorded on messages.provider_status), reminder
// queue state, last inbound. Aggregation happens here in JS over one fetch
// per table instead of a count-query per status — fewer round trips, and
// the message `body` column is simply never selected.
const RECENT_OUTBOUND_CAP = 200;
const DELIVERY_KEYS = ['delivered', 'sent', 'queued', 'failed', 'undelivered'];

export async function userHealth(userId, { days = 7 } = {}) {
  const user = await getUserById(userId);
  if (!user) return null;

  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();

  const { data: outboundRows } = await supabase.from('messages')
    .select('provider_status, provider_payload, sent_at, created_at, message_type')
    .eq('user_id', userId).eq('direction', 'outbound')
    .order('sent_at', { ascending: false }).limit(RECENT_OUTBOUND_CAP);
  const outbound = outboundRows || [];
  const stampOf = (r) => r.sent_at || r.created_at || '';
  const inWindow = outbound.filter((r) => stampOf(r) >= sinceIso);

  const counts = { delivered: 0, sent: 0, queued: 0, failed: 0, undelivered: 0, unknown: 0 };
  for (const r of inWindow) {
    const s = r.provider_status;
    if (DELIVERY_KEYS.includes(s)) counts[s] += 1;
    else counts.unknown += 1;
  }
  const failures = inWindow
    .filter((r) => r.provider_status === 'failed' || r.provider_status === 'undelivered')
    .sort((a, b) => (stampOf(b) < stampOf(a) ? -1 : 1));
  const worst = failures[0] || null;
  const lastFailure = worst ? {
    at: stampOf(worst) || null,
    status: worst.provider_status,
    error_code: (worst.provider_payload && worst.provider_payload.error_code != null)
      ? String(worst.provider_payload.error_code) : null,
    message_type: worst.message_type ?? null,
  } : null;
  const lastOutboundAt = outbound.reduce((m, r) => (stampOf(r) > m ? stampOf(r) : m), '') || null;

  const { data: reminderRows } = await supabase.from('reminders')
    .select('status, trigger_at').eq('user_id', userId);
  const reminders = reminderRows || [];
  const nowIso = new Date().toISOString();
  const rCounts = { pending: 0, sent: 0, snoozed: 0, canceled: 0 };
  for (const r of reminders) if (r.status in rCounts) rCounts[r.status] += 1;
  const pendingTimes = reminders.filter((r) => r.status === 'pending' && r.trigger_at).map((r) => r.trigger_at);
  const nextDueAt = pendingTimes.length ? pendingTimes.reduce((a, b) => (a < b ? a : b)) : null;
  const overduePending = pendingTimes.filter((t) => t <= nowIso).length;

  const { data: inboundRows } = await supabase.from('messages')
    .select('received_at').eq('user_id', userId).eq('direction', 'inbound')
    .order('received_at', { ascending: false }).limit(1);
  const lastInboundAt = (inboundRows || []).reduce(
    (m, r) => ((r.received_at || '') > m ? r.received_at : m), '') || null;

  return {
    found: true,
    user: {
      id: user.id,
      user_ref: 'u_' + user.id,
      name: user.name ?? null,
      plan: user.plan,
      opted_out: Boolean(user.opted_out),
      onboarding_complete: Boolean(user.onboarding_complete),
      last_active_at: user.last_active_at ?? null,
    },
    window_days: days,
    delivery: { counts, last_failure: lastFailure },
    reminders: { counts: rCounts, next_due_at: nextDueAt, overdue_pending: overduePending },
    last_inbound_at: lastInboundAt,
    last_outbound_at: lastOutboundAt,
  };
}

// ── GET /admin/users/:id/billing — Stripe section, STUB ────────────────
// Only fields that exist in the schema today. Stripe ids are reduced to
// presence booleans; the `stripe` block is an explicitly-marked placeholder
// so N4 can build the card now. No Stripe SDK, no keys, no API calls.
export async function userBilling(userId) {
  const user = await getUserById(userId);
  if (!user) return null;

  const { data: subRows } = await supabase.from('subscriptions')
    .select('plan, status, current_period_end, canceled_at, created_at, stripe_subscription_id')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
  const latest = (subRows || []).reduce(
    (a, b) => (!a || (b.created_at || '') > (a.created_at || '') ? b : a), null);

  return {
    found: true,
    user_ref: 'u_' + user.id,
    plan: user.plan,
    billing_status: user.billing_status,
    trial: {
      started_at: user.trial_started_at ?? null,
      ends_at: user.trial_ends_at ?? null,
      downgraded_at: user.trial_downgraded_at ?? null,
    },
    has_stripe_customer: Boolean(user.stripe_customer_id),
    sub_status: latest ? latest.status : null,
    subscription: latest ? {
      plan: latest.plan,
      status: latest.status,
      current_period_end: latest.current_period_end ?? null,
      canceled_at: latest.canceled_at ?? null,
      has_stripe_subscription: Boolean(latest.stripe_subscription_id),
    } : null,
    stripe: {
      integrated: false,
      placeholder: true,
      note: 'Shape reserved for the future Stripe integration; every field below is null until then.',
      planned: {
        customer_portal_url: null,
        payment_method_summary: null,
        next_invoice_at: null,
        mrr_cents: null,
      },
    },
  };
}

// ── POST /admin/users/:id/reset — pass-through to the existing tool ─────
// Synthesizes a minimal Express-shaped request against the founder-admin
// router and returns { status, body }. The x-admin-key header is supplied
// from config server-side (never round-tripped through the caller), so the
// inner route authenticates exactly as it would for curl. Everything the
// inner tool enforces — allowlist, consent preservation, audit entry —
// happens in the one existing implementation.
function dispatchFounderAdmin({ method, url, body }) {
  return new Promise((resolve) => {
    const headers = { 'x-admin-key': config.adminKey || '', 'content-type': 'application/json' };
    const req = {
      method,
      url,
      originalUrl: '/admin' + url,
      baseUrl: '',
      path: url.split('?')[0],
      headers,
      body: body || {},
      get(name) { return headers[String(name).toLowerCase()]; },
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(obj) { resolve({ status: this.statusCode, body: obj }); },
      send(text) { resolve({ status: this.statusCode, body: { error: String(text) } }); },
      end() { resolve({ status: this.statusCode, body: null }); },
    };
    adminRouter(req, res, () => resolve({ status: 404, body: { error: 'route not found' } }));
  });
}

export async function resetUserById(userId) {
  const target = await getUserById(userId);
  if (!target) return { status: 404, body: { found: false } };
  // The inner tool fails closed without its own key; report, never bypass.
  if (!config.adminKey) {
    return { status: 503, body: { reset: false, error: 'reset backend disabled: ADMIN_KEY is unset' } };
  }
  const inner = await dispatchFounderAdmin({
    method: 'POST', url: '/reset-user', body: { phone: target.phone },
  });
  return { status: inner.status, body: inner.body, user_ref: 'u_' + target.id };
}

// ── Tester allowlist view (env-only; see contract §7) ───────────────────
// TESTER_PHONES is parsed at boot in config.js; there is nothing to mutate
// at runtime, so the panel exposes a masked read-only view and the POST
// route answers 501 with the operator procedure.
export function testerAllowlistView() {
  const phones = config.testerPhones || [];
  return {
    source: 'env:TESTER_PHONES',
    count: phones.length,
    phones_last4: phones.map((p) => last4(p)),
  };
}
