import { Router } from 'express';
import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { config } from '../config.js';
import { normalizePhone } from '../utils/phone.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────
// FOUNDER ADMIN (v2 — hardened, WS-A items 5 & 9)
//
// What changed vs the old browser-URL panel, and why (audit A3):
//  • Auth is a HEADER (`x-admin-key`), never a query-string key. Key-in-URL
//    leaks to Railway request logs, browser history, proxies and Referer.
//  • The compare is constant-time (crypto.timingSafeEqual), not `!==`.
//  • The destructive GET /admin/reset is REMOVED. A destructive GET is
//    CSRF-able and prefetchable (a link-preview bot could wipe an account).
//    Its safe replacement is POST /admin/reset-user (below).
//  • Every reset writes a structured AUDIT log entry. The old reset was
//    "self-erasing": it deleted the very messages/agent_runs that were the
//    evidence of what it did. The new reset preserves the audit/compliance
//    trail and records the action independently (STRUCTURED_LOGGING_SPEC §8
//    designates the JSON log stream as the durable, DB-independent audit sink;
//    a DB-side admin_audit table is flagged to WS-C).
//
// If ADMIN_KEY is unset, every route here returns 404 — the panel doesn't exist.
// Browser-URL access is intentionally gone; use curl/the Cycle-2 admin panel:
//   curl -sS -X POST https://YOUR-DOMAIN/admin/reset-user \
//        -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
//        -d '{"phone":"7869727469"}'
// ─────────────────────────────────────────────────────────────────────────

const router = Router();

// Constant-time key comparison. Returns false on any length/type mismatch
// without leaking timing about how much of the key matched.
function keyMatches(provided) {
  const expected = config.adminKey;
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.use((req, res, next) => {
  if (!config.adminKey) return res.status(404).send('Not found');
  const provided = req.get('x-admin-key');
  if (!keyMatches(provided)) {
    logger.event('admin.auth.rejected', { level: 'warn', error_category: 'auth', status_code: 403, message: req.method + ' ' + req.path });
    return res.status(403).send('Forbidden');
  }
  next();
});

async function findUserByPhone(rawPhone, res) {
  const phone = normalizePhone(rawPhone);
  if (!phone) { res.status(400).json({ error: 'phone is required' }); return null; }
  const { data: user } = await supabase.from('app_users').select('*').eq('phone', phone).maybeSingle();
  if (!user) { res.status(404).json({ found: false }); return null; }
  return user;
}

async function countFor(table, userId) {
  const { count } = await supabase.from(table)
    .select('*', { count: 'exact', head: true }).eq('user_id', userId);
  return count || 0;
}

// POST /admin/user — snapshot of what Cedrus knows about an account.
// POST (not GET) + body so the phone never rides in a URL/query string.
router.post('/user', async (req, res) => {
  const user = await findUserByPhone(req.body?.phone, res);
  if (!user) return;
  const [people, facts, messages, reminders] = await Promise.all([
    countFor('people', user.id), countFor('facts', user.id),
    countFor('messages', user.id), countFor('reminders', user.id),
  ]);
  logger.event('admin.user.viewed', { user_ref: 'u_' + user.id });
  res.json({
    found: true,
    user_ref: 'u_' + user.id, // no raw phone in the response body
    name: user.name,
    plan: user.plan,
    onboarding_complete: user.onboarding_complete,
    trial_ends_at: user.trial_ends_at,
    counts: { people, facts, messages, reminders },
  });
});

// Product-memory tables cleared by a reset, in child-first order so FK
// constraints are satisfied. This is the FULL enumeration required by item 9.
//
// PRESERVED (never deleted) — audit / compliance / billing evidence:
//   • consent_events   — opt-in/opt-out compliance history (non-negotiable)
//   • subscriptions    — billing/entitlement evidence
//   • agent_runs       — LLM cost/latency audit (item 5: stop wiping this)
//   • integrations     — external-account links (not product memory)
// The account row (app_users) is KEPT and rewound (identity + web-login link
// stay); people rows are cleared except the is_self row, which is blanked.
const RESET_TABLES = [
  'pending_prompts', 'nudges', 'brief_items', 'briefs', 'reminders',
  'user_goals', 'contact_events', 'message_people', 'facts', 'saved_items',
  'core_circle_candidates', 'core_circle_runs', 'person_merges',
  'messages', // cleared LAST among children so from-zero onboarding fires
];

// POST /admin/reset-user — per-user, safe, allow-listed reset (item 9).
// Rewinds ONLY the target user's product data so they can restart onboarding
// from zero. Backend for a future admin panel (Cycle 2); no UI here.
router.post('/reset-user', async (req, res) => {
  const rawPhone = req.body?.phone;
  const phone = normalizePhone(rawPhone);

  // Hard gate: refuse unless the target is on the explicit TESTER_PHONES
  // allow-list. This is a testing tool for Emil + beta testers, never a
  // general "wipe any account" lever.
  if (!phone || !config.testerPhones.includes(phone)) {
    logger.event('admin.reset_user.denied', {
      level: 'warn', error_category: 'auth', status_code: 403,
      user_ref: phone ? 'ph_' + phone.slice(-4) : undefined,
      reason: 'not_on_tester_allowlist',
    });
    return res.status(403).json({ reset: false, error: 'phone is not on the TESTER_PHONES allowlist' });
  }

  const user = await findUserByPhone(rawPhone, res);
  if (!user) return;
  const uid = user.id;
  const userRef = 'u_' + uid;

  try {
    const deleted = {};
    for (const t of RESET_TABLES) {
      const before = await countFor(t, uid);
      const { error } = await supabase.from(t).delete().eq('user_id', uid);
      if (error) throw new Error(`${t}: ${error.message}`);
      deleted[t] = before;
    }
    // Remove everyone except the self record; blank the self record so a fresh
    // onboarding can re-name it. (consent_events/subscriptions untouched.)
    await supabase.from('people').delete().eq('user_id', uid).eq('is_self', false);
    await supabase.from('people').update({
      name: 'Me', last_contact_at: null, last_nudged_at: null,
    }).eq('user_id', uid).eq('is_self', true);

    // Back to brand-new: onboarding again, fresh 14-day trial. Keep the account
    // row + web-login link + consent history.
    await supabase.from('app_users').update({
      name: null,
      onboarding_complete: false,
      showing_up_count: 0,
      total_briefs_sent: 0,
      briefs_opened_streak: 0,
      last_brief_sent_at: null,
      plan: 'trialing',
      billing_status: 'trialing',
      trial_started_at: new Date().toISOString(),
      trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      trial_downgraded_at: null,
      opted_out: false,
      opted_out_at: null,
    }).eq('id', uid);

    // AUDIT ENTRY (item 9). Durable, PII-free record of the action — proves the
    // reset happened and what it cleared, independent of the now-deleted data.
    logger.event('admin.reset_user', {
      user_ref: userRef, outcome: 'accepted',
      meta: { deleted_counts: deleted, preserved: ['consent_events', 'subscriptions', 'agent_runs', 'integrations'] },
    });

    res.json({
      reset: true, user_ref: userRef,
      note: 'Next text to Cedrus starts onboarding from scratch.',
      cleared: deleted,
      preserved: ['consent_events', 'subscriptions', 'agent_runs', 'integrations'],
    });
  } catch (err) {
    logger.event('admin.reset_user.failed', { level: 'error', user_ref: userRef, error_category: 'db_error', message: err?.message || String(err) });
    res.status(500).json({ reset: false, error: 'reset failed' });
  }
});

export default router;
