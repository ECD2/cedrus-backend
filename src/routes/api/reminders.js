import express, { Router } from 'express';
import crypto from 'node:crypto';
import { supabase } from '../../lib/supabase.js';
import { logger } from '../../utils/logger.js';
import { createRequireUser } from './auth.js';

// ─────────────────────────────────────────────────────────────────────────
// REMINDERS READ ROUTER (UI-09) — GET /api/reminders.
//
// A user-scoped, READ-ONLY projection: the upcoming reminders a user has,
// each annotated with its delivery state (did the SMS actually go out?).
// Contract: docs/REMINDERS_READ_CONTRACT.md. Mounting into src/index.js and
// the test-battery registration: docs/FLAGS_FROM_STATION6.md (this stream
// does not edit shared files, so the router lives in its own file and
// self-carries the /api shape rules).
//
// READ-ONLY, by construction:
//   • the only DB verb used is .select(); this file never writes a reminder
//     and never touches the dispatcher (src/jobs/reminders.js). It cannot
//     change reminder logic — it only reflects what the pipeline already
//     recorded.
//
// TWO TABLES, joined in JS (no reminder-logic change):
//   • reminders            — the schedule + lifecycle status
//                            (pending | sent | snoozed | canceled).
//   • messages             — the delivery ledger. A dispatched reminder
//     (src/jobs/reminders.js) links its outbound SMS via
//     reminders.sent_message_id → messages.id, and the Twilio delivery
//     callback (src/routes/deliveryStatus.js) writes the terminal state to
//     messages.provider_status. So a reminder's delivery state == the linked
//     message's provider_status (null until/unless dispatched).
//
// Same shape rules as routes/api/index.js and routes/api/interests.js,
// restated because this file cannot edit those (NEW FILES ONLY):
//   • the route sits behind requireUser (Supabase JWT → req.appUser);
//     identity is token-derived, never body-/query-derived (see ./auth.js).
//     Every read is .eq('user_id', req.appUser.id) — a foreign or forged id
//     can only ever behave as "not found".
//   • handler stays thin; it reads, shapes, and JSON-outs. There is no
//     business rule here beyond the projection, so it lives inline rather
//     than in a service (this stream ships a route file only).
//   • typed errors carry {status, code, publicMessage}; the wrapper turns
//     those into the contract's {error, message} shape. Any other throw is a
//     500 with generic copy — internals never leak.
//   • one correlation id per request via the WS-A logger context.
// ─────────────────────────────────────────────────────────────────────────

const MSG_INTERNAL = 'Something went wrong on my end. Try that again in a moment.';
export const MSG_BAD_STATUS = "I don't recognize that reminder filter.";

// The reminder lifecycle values the schema's CHECK constraint allows. The
// baseline had four (pending|sent|snoozed|canceled); the delivery-states
// migration (cedrus-supabase 20260719120001_reminder_delivery_states) widened
// it with 'sending' (dedicated in-flight lane) and 'failed' (explicit terminal
// state) — see src/jobs/reminders.js for the legacy 'snoozed'-as-in-flight
// note. Accepting all six is safe whether or not that migration is applied in
// a given environment: this is a READ filter, so it never touches the write
// CHECK, and if a status has no rows the filter simply matches nothing.
export const REMINDER_STATUSES = ['pending', 'sent', 'snoozed', 'canceled', 'sending', 'failed'];

// Default view = "upcoming reminders + their delivery states": every live or
// recently-acted reminder — yet to fire (pending), in-flight (snoozed/sending),
// delivered (sent), or dispatch-failed (failed). Only 'canceled' (user opted
// out / deleted — dead, never sends) is excluded. Pass ?status=pending for a
// strictly-not-yet-fired list, ?status=sent|failed for a delivery log, or
// ?status=all to include canceled too.
const DEFAULT_STATUSES = REMINDER_STATUSES.filter((s) => s !== 'canceled');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code, publicMessage: message });

// ?status → the status set to filter on, or null for "no status filter" (all).
// Unknown value is a 422, mirroring the interests list-filter validation.
export function resolveStatusFilter(raw) {
  if (raw == null || raw === '') return DEFAULT_STATUSES;
  const v = String(raw).toLowerCase();
  if (v === 'all') return null;
  if (REMINDER_STATUSES.includes(v)) return [v];
  throw httpError(422, 'invalid_request', MSG_BAD_STATUS);
}

// ?limit → clamped to [1, MAX_LIMIT]; anything unparseable falls back to the
// default rather than erroring (a soft paging knob, not a validated field).
export function clampLimit(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// Project a messages row into the public delivery sub-object. error_code is
// pulled from provider_payload exactly like the admin health view
// (src/services/adminOps.js) so the two surfaces read the same failure.
export function deliveryOf(msg) {
  if (!msg) return null;
  const errorCode = msg.provider_payload && msg.provider_payload.error_code != null
    ? String(msg.provider_payload.error_code)
    : null;
  return {
    status: msg.provider_status ?? null,
    error_code: errorCode,
    sent_at: msg.sent_at ?? null,
    message_type: msg.message_type ?? null,
  };
}

// Explicit allow-list so internal columns (user_id, sent_message_id,
// source_message_id, created_by, updated_at) never leak — the delivery join
// is surfaced as `delivery`, the raw link id is not.
function shapeReminder(r, msgById) {
  const msg = r.sent_message_id ? msgById.get(r.sent_message_id) : null;
  return {
    id: r.id,
    title: r.title ?? null,
    note: r.note ?? null,
    person_id: r.person_id ?? null,
    reminder_type: r.reminder_type ?? null,
    status: r.status ?? null,
    trigger_at: r.trigger_at ?? null,
    created_at: r.created_at ?? null,
    delivery: deliveryOf(msg),
  };
}

// Read the user's reminders (optionally status-filtered) and their linked
// delivery rows. One reminders query + one batched messages query (.in on the
// collected sent_message_ids) — no N+1. Ordering is trigger_at DESC with an
// id tiebreak applied in JS so the page is deterministic regardless of the
// driver's tie behavior.
async function listReminders({ user, statusFilter, limit }, db) {
  let q = db.from('reminders')
    .select('id, person_id, title, note, reminder_type, status, trigger_at, created_at, sent_message_id')
    .eq('user_id', user.id);
  if (statusFilter) q = q.in('status', statusFilter);
  const { data: rows, error } = await q
    .order('trigger_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const reminders = rows || [];

  const sentIds = [...new Set(reminders.map((r) => r.sent_message_id).filter(Boolean))];
  const msgById = new Map();
  if (sentIds.length) {
    // Re-scope the delivery lookup to the same user: a reminder already
    // belongs to req.appUser, but scoping the message read too means a
    // mis-linked id can never surface another user's message.
    const { data: msgs, error: mErr } = await db.from('messages')
      .select('id, provider_status, provider_payload, sent_at, message_type')
      .eq('user_id', user.id)
      .in('id', sentIds);
    if (mErr) throw mErr;
    for (const m of (msgs || [])) msgById.set(m.id, m);
  }

  const shaped = reminders.map((r) => shapeReminder(r, msgById));
  shaped.sort((a, b) => {
    const at = a.trigger_at || '';
    const bt = b.trigger_at || '';
    if (at !== bt) return at < bt ? 1 : -1;       // trigger_at DESC (nulls last)
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); // id ASC tiebreak
  });
  return shaped;
}

export function createRemindersRouter(deps = {}) {
  const db = deps.db || supabase;
  const router = Router();

  // Self-contained JSON parsing (same 100kb cap as the app-wide parser in
  // index.js; harmless double-mount — body-parser skips an already-read
  // body), so the router also works mounted standalone in tests.
  router.use(express.json({ limit: '100kb' }));
  router.use(createRequireUser(deps.auth || deps.db ? { auth: deps.auth, db: deps.db } : {}));

  // Wrap a handler with correlation context + the contract's error shape.
  // Same wrapper as routes/api/index.js / interests.js `handle` (not exported
  // there); keep the three in step if either changes.
  const handle = (name, fn) => async (req, res) => {
    const t0 = Date.now();
    await logger.runWithContext(
      { correlation_id: crypto.randomUUID(), request_id: crypto.randomUUID() },
      async () => {
        logger.addContext({ user_ref: 'u_' + req.appUser.id });
        try {
          const result = await fn(req);
          res.json(result);
          logger.event(`web.${name}.handled`, {
            status_code: 200, outcome: 'accepted', latency_ms: Date.now() - t0,
          });
        } catch (err) {
          const known = err && err.status && err.code && err.publicMessage;
          const status = known ? err.status : 500;
          res.status(status).json({
            error: known ? err.code : 'internal',
            message: known ? err.publicMessage : MSG_INTERNAL,
          });
          logger.event(`web.${name}.rejected`, {
            level: status >= 500 ? 'error' : 'warn',
            error_category: status >= 500 ? 'internal' : 'validation',
            status_code: status, latency_ms: Date.now() - t0,
            message: known ? err.code : (err && err.message) || String(err),
          });
        }
      },
    );
  };

  // GET /api/reminders — upcoming reminders + delivery state (contract §2).
  router.get('/', handle('reminders.list', async (req) => {
    const statusFilter = resolveStatusFilter(req.query.status);
    const limit = clampLimit(req.query.limit);
    const reminders = await listReminders({ user: req.appUser, statusFilter, limit }, db);
    return { count: reminders.length, reminders };
  }));

  return router;
}

// Production router: real Supabase auth + db, per the mount instructions in
// docs/FLAGS_FROM_STATION6.md.
export default createRemindersRouter();
