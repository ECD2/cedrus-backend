// ─────────────────────────────────────────────────────────────────────────
// WEB ONBOARDING SERVICE
//
// Emil's vision: a visitor on cedrus.life enters their phone (and optional
// email) and Cedrus texts THEM first, so onboarding begins from the website
// instead of requiring the visitor to text a number cold.
//
// This service owns the whole server-side flow behind POST /api/onboard/start.
// It is deliberately paranoid, because the endpoint is public/unauthenticated:
//
//   • validate + normalize the phone server-side (utils/onboardValidation);
//     refuse obviously-invalid / reserved / fake numbers.
//   • rate-limit per IP and per phone (services/rateLimiter).
//   • find-or-CREATE the app_users row. The row's UNIQUE phone is the dedup
//     mutex: a racing second request hits a unique violation and is folded
//     into "existing".
//   • send the Twilio-approved first-contact script (MSG_COMPLIANCE) VERBATIM,
//     exactly once, and ONLY to a number with no message history — so we never
//     double-text and never disturb an existing SMS user.
//   • record consent correctly: app_users.sms_consent_at + consent_source
//     ('web_onboarding'), plus a consent_events row (event_type
//     'consent_captured', the schema's web-consent-shaped type; source 'web').
//   • log the sent script as an outbound 'onboarding' message, so when the
//     user replies, the inbound pipeline sees history and treats their reply as
//     their onboarding answer instead of re-sending the opt-in script
//     (src/pipeline/index.js needsFreshStart).
//   • email (optional): stored ONLY on a newly created user as brief_email with
//     brief_email_status 'pending' — on file, unverified, never sent to. We do
//     NOT mutate an existing account from this unauthenticated endpoint.
//   • the caller ALWAYS gets one generic success for any well-formed input;
//     account existence, send/no-send, and provider failures are invisible.
//
// DB access uses the module-level service-role `supabase` (mirrors
// services/messages.js and services/consent.js). Tests fake ../lib/supabase.js
// via bun's mock.module, so the real code here runs against in-memory tables.
// The SMS sender, rate limiters, and dry-run flag are injectable for tests.
// ─────────────────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase.js';
import { sendSms as realSendSms } from '../lib/twilio.js';
import * as messages from './messages.js';
import * as consent from './consent.js';
import { config } from '../config.js';
import { timezoneFromPhone } from '../utils/time.js';
import { logger } from '../utils/logger.js';
import { validatePhone, validateEmail } from '../utils/onboardValidation.js';
import {
  MSG_COMPLIANCE, MSG_ONBOARD_OK, MSG_INVALID_PHONE, MSG_INVALID_EMAIL, MSG_RATE_LIMITED,
} from './onboardingCopy.js';

// Default abuse limits. Deliberately generous enough for a real person who
// mistypes and retries, tight enough to blunt scripted abuse. Overridable via
// env so ops can tune without a deploy (documented in docs/MOUNT_WEBONBOARD.md).
export const IP_WINDOW_MS = envInt('WEB_ONBOARD_IP_WINDOW_MS', 60 * 60 * 1000);   // 1h
export const IP_MAX = envInt('WEB_ONBOARD_IP_MAX', 8);
export const PHONE_WINDOW_MS = envInt('WEB_ONBOARD_PHONE_WINDOW_MS', 60 * 60 * 1000); // 1h
export const PHONE_MAX = envInt('WEB_ONBOARD_PHONE_MAX', 3);

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Typed error the route wrapper understands ({status, code, publicMessage}).
function fail(status, code, publicMessage) {
  const e = new Error(code);
  e.status = status; e.code = code; e.publicMessage = publicMessage;
  return e;
}

// Postgres unique_violation (23505) — the racing-insert signal. Supabase
// surfaces the SQLSTATE in .code; we also sniff the message as a backstop.
function isUniqueViolation(error) {
  if (!error) return false;
  if (error.code === '23505') return true;
  const m = (error.message || '').toLowerCase();
  return m.includes('duplicate key') || m.includes('app_users_phone_key') || m.includes('unique');
}

async function findByPhone(phone) {
  const { data, error } = await supabase
    .from('app_users').select('*').eq('phone', phone).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Insert the web-consent app_users row. Returns { user } on success, or
// { raced:true } if a concurrent request already created this phone.
async function createWebUser(phone, briefEmail) {
  const row = {
    phone,
    timezone: timezoneFromPhone(phone, config.defaultTimezone),
    // Consent captured NOW, by the website form submission. This is the opt-in
    // moment for a web-initiated signup (distinct from 'first_message').
    sms_consent_at: new Date().toISOString(),
    consent_source: 'web_onboarding',
  };
  if (briefEmail) {
    row.brief_email = briefEmail;        // lowercased by validateEmail
    row.brief_email_status = 'pending';  // on file, unverified, not sent to
  }
  const { data, error } = await supabase.from('app_users').insert(row).select('*').single();
  if (error) {
    if (isUniqueViolation(error)) return { raced: true };
    throw error;
  }
  // NOTE: a DB trigger auto-creates this user's is_self person row (same as
  // users.findOrCreateByPhone).
  return { user: data };
}

// Send MSG_COMPLIANCE verbatim, then record it as an outbound 'onboarding'
// message so inbound history exists. Returns true if a real send happened.
// Provider failures are swallowed (logged) so they never become an
// account-existence oracle and so a later retry can re-attempt (no history was
// written on failure).
async function sendFirstContact(user, { sms, dryRun }) {
  if (dryRun) {
    // Full flow minus the carrier hop: record history + mark the send dry so
    // staging can verify wiring without spending an SMS or texting a human.
    await messages.logOutbound({
      userId: user.id, body: MSG_COMPLIANCE, messageType: 'onboarding', providerStatus: 'dry_run',
    });
    logger.event('web.onboard.dry_run', { outcome: 'suppressed', message_type: 'onboarding' });
    return false;
  }
  let sid = null;
  let segments = 1;
  try {
    const resp = await sms.send(user.phone, MSG_COMPLIANCE);
    sid = (resp && resp.sid) || null;
    const ns = resp && (resp.numSegments || resp.num_segments);
    segments = ns ? parseInt(ns, 10) || 1 : 1;
  } catch (err) {
    logger.event('web.onboard.sms_failed', {
      level: 'error', error_category: 'provider_error', outcome: 'failed',
    });
    return false; // uniform response upstream; row stays retryable
  }
  await messages.logOutbound({
    userId: user.id, body: MSG_COMPLIANCE, messageType: 'onboarding',
    providerMessageId: sid, segments,
  });
  logger.event('web.onboard.sent', {
    outcome: 'sent', message_type: 'onboarding',
    ...(sid ? { provider_message_id: sid } : {}),
  });
  return true;
}

// Main entry. `input`: { phone, email, ip } straight off the request. `deps`:
// { ipLimiter, phoneLimiter, sms, dryRun } — all defaulted for production.
// Throws typed errors for validation / rate-limit; every well-formed call
// resolves to { message: MSG_ONBOARD_OK } regardless of what happened inside.
export async function startOnboarding(input, deps = {}) {
  const { ip } = input;
  const sms = deps.sms || { send: realSendSms };
  const dryRun = deps.dryRun !== undefined ? deps.dryRun : (process.env.WEB_ONBOARD_DRY_RUN === 'true');

  // 1. Validate phone (server-side, cannot be bypassed by the client).
  const phoneCheck = validatePhone(input.phone);
  if (!phoneCheck.ok) {
    logger.event('web.onboard.rejected', {
      status_code: 422, error_category: 'validation', outcome: 'invalid_phone', reason: phoneCheck.reason,
    });
    throw fail(422, 'invalid_phone', MSG_INVALID_PHONE);
  }
  const phone = phoneCheck.digits;

  // 2. Validate optional email up-front (a bad one is a 422, not a silent drop,
  //    so the user isn't misled into thinking they joined the brief list).
  let briefEmail = null;
  const emailRaw = input.email;
  if (emailRaw !== undefined && emailRaw !== null && String(emailRaw).trim() !== '') {
    const emailCheck = validateEmail(emailRaw);
    if (!emailCheck.ok) {
      logger.event('web.onboard.rejected', {
        status_code: 422, error_category: 'validation', outcome: 'invalid_email', reason: emailCheck.reason,
      });
      throw fail(422, 'invalid_email', MSG_INVALID_EMAIL);
    }
    briefEmail = emailCheck.email;
  }

  // 3. Rate-limit per IP and per phone. Both are counted; either tripping is a
  //    429. Keyed on the normalized phone so format variants share a bucket.
  if (deps.ipLimiter) {
    const r = deps.ipLimiter.check(`ip:${ip || 'unknown'}`);
    if (!r.allowed) {
      logger.event('web.onboard.rejected', { status_code: 429, error_category: 'rate_limit', outcome: 'ip_rate_limited' });
      throw fail(429, 'rate_limited', MSG_RATE_LIMITED);
    }
  }
  if (deps.phoneLimiter) {
    const r = deps.phoneLimiter.check(`ph:${phone}`);
    if (!r.allowed) {
      logger.event('web.onboard.rejected', { status_code: 429, error_category: 'rate_limit', outcome: 'phone_rate_limited' });
      throw fail(429, 'rate_limited', MSG_RATE_LIMITED);
    }
  }

  // 4. Find-or-create. The UNIQUE phone constraint collapses a race into one row.
  let user = await findByPhone(phone);
  let created = false;
  if (!user) {
    const res = await createWebUser(phone, briefEmail);
    if (res.raced) {
      user = await findByPhone(phone); // adopt the winner's row
    } else {
      user = res.user;
      created = true;
    }
  }

  // Defensive: a race we somehow can't resolve. Nothing to do, but never leak —
  // return the same generic success.
  if (!user) {
    logger.event('web.onboard.handled', { outcome: 'noop' });
    return { message: MSG_ONBOARD_OK };
  }

  // 5. Consent audit event: exactly once, at the moment we record the web
  //    opt-in (i.e. when THIS request created the row). The durable consent
  //    state lives on app_users (sms_consent_at/consent_source) set at create;
  //    this is the append-only audit trail.
  if (created) {
    await consent.log({ userId: user.id, eventType: 'consent_captured', source: 'web' });
  }

  // 6. Decide whether to text. Send the first-contact script ONLY to a number
  //    with no message history:
  //      • a user we just created            -> send
  //      • a row with no history (prior send failed) -> send (recovery)
  //      • an existing user WITH history      -> never (no double-text, no
  //        disturbing an established SMS user), and the response is unchanged
  //        so existence stays hidden.
  const hasHistory = created ? false : !(await messages.hasNoHistory(user.id));
  if (!hasHistory) {
    await sendFirstContact(user, { sms, dryRun });
  } else {
    logger.event('web.onboard.suppressed', { outcome: 'existing_history' });
  }

  return { message: MSG_ONBOARD_OK };
}

// Factory so a router (and tests) can build production-tuned limiters once and
// share them across requests.
export function defaultLimiters(createRateLimiter) {
  return {
    ipLimiter: createRateLimiter({ windowMs: IP_WINDOW_MS, max: IP_MAX }),
    phoneLimiter: createRateLimiter({ windowMs: PHONE_WINDOW_MS, max: PHONE_MAX }),
  };
}
