// ─────────────────────────────────────────────────────────────────────────────
// Weekly-note action tokens + scoped unsubscribe (WS-F / N2).
//
// Two mechanisms, deliberately distinct (session8 WBT §6 / U-2):
//
// 1. ACTION TOKENS (D18) — rows in public.brief_action_tokens.
//    Raw token: CSPRNG 32 bytes → base64url (≥256-bit entropy). Stored as
//    sha256 hex ONLY (raw exists only inside the outbound URL). Single-use via
//    an atomic conditional claim; 7-day expiry; superseded when a newer note
//    is generated. `view_full_brief` is render-only and never consumed.
//    action_type is validated against the LIVE CHECK constraint value list —
//    the pushed schema has no 'unsubscribe' action type, by design.
//    Every failure mode returns the same neutral result (no oracle).
//
// 2. UNSUBSCRIBE (BRIEF-03 scope) — NOT an action-token row. The live schema
//    has no unsubscribe storage (session8 gap WBT-G3); open decision U-2
//    recommends a per-user, single-purpose, non-expiring-but-rotating token.
//    Implemented statelessly: HMAC-SHA256 over (version, userId, purpose,
//    issue date) with a server-side secret; verified with timingSafeEqual;
//    rotation = new secret version, old secrets verifiable until retired.
//    Redemption changes ONLY app_users.brief_email_status/-unsubscribed_at and
//    appends consent_events('brief_unsubscribed') — never SMS opted_out,
//    never verified_emails (D16 consent separation).
//
// DB access is injected (`deps.db`) so this module stays importable from bun
// tests and concatenatable in the dependency-free bundle runner.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Mirrors the live CHECK on brief_action_tokens.action_type exactly
// (migration 20260713120001_weekly_brief_foundation.sql). Do not add values
// here without a WS-C migration widening the constraint first.
export const ACTION_TYPES = [
  'view_full_brief',
  'remind_tomorrow',
  'mark_handled',
  'add_to_calendar',
  'change_this',
  'tell_cedrus_more',
  'prioritize_person',
];

// Render-only actions: redeem never consumes them (WBT §4.2 step 8).
const RENDER_ONLY = new Set(['view_full_brief']);

export const TOKEN_TTL_DAYS = 7; // D18

// The one failure shape every invalid/expired/used/superseded/unknown token
// gets. One string, no variation: a probe learns nothing (WBT K-5).
const NEUTRAL_FAIL = Object.freeze({ ok: false, reason: 'expired' });

function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── issuance ────────────────────────────────────────────────────────────────

// Issue one action token. Returns { raw, row }: `raw` goes into the outbound
// URL and is never stored or logged; `row` is the persisted record.
export async function issueActionToken(deps, {
  userId, briefId, briefItemId = null, actionType, payload = {},
  now = new Date(), ttlDays = TOKEN_TTL_DAYS,
}) {
  if (!ACTION_TYPES.includes(actionType)) {
    throw new Error(`brief tokens: unknown action_type "${actionType}" (live CHECK would reject it)`);
  }
  const expiresAt = new Date(now.getTime() + ttlDays * 86400000).toISOString();

  // token_hash is UNIQUE; on the (astronomically unlikely) collision,
  // regenerate rather than fail the send.
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = b64url(randomBytes(32));
    const tokenHash = sha256Hex(raw);
    try {
      const row = await deps.db.insertToken({
        user_id: userId, brief_id: briefId, brief_item_id: briefItemId,
        action_type: actionType, token_hash: tokenHash,
        payload, expires_at: expiresAt,
      });
      return { raw, row };
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 2) throw err;
    }
  }
  throw new Error('brief tokens: could not issue a unique token');
}

// A newly generated note invalidates the previous cycle's unused tokens
// (D18 supersession). Called by the issuing job before new tokens go out.
export async function supersedePriorTokens(deps, { userId, briefId, now = new Date() }) {
  return deps.db.supersedeTokens(userId, briefId, now.toISOString());
}

// ── redemption ──────────────────────────────────────────────────────────────

// Redeem a presented raw token. GET-render vs POST-mutate discipline lives in
// the future T24 route; this function is the storage-truth half it will call:
//   • every failure mode → the SAME neutral result;
//   • render-only actions validate without consuming;
//   • consuming actions claim used_at atomically (double redeem loses).
export async function redeemActionToken(deps, rawToken, { now = new Date(), consume = true } = {}) {
  if (typeof rawToken !== 'string' || rawToken.length < 16) return NEUTRAL_FAIL;
  const presentedHash = sha256Hex(rawToken);
  const row = await deps.db.findTokenByHash(presentedHash);
  if (!row) return NEUTRAL_FAIL;

  // Belt-and-suspenders equality beyond the indexed lookup, constant-time.
  const a = Buffer.from(presentedHash, 'utf8');
  const b = Buffer.from(String(row.token_hash), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NEUTRAL_FAIL;

  if (row.superseded_at) return NEUTRAL_FAIL;
  if (!row.expires_at || new Date(row.expires_at).getTime() <= now.getTime()) return NEUTRAL_FAIL;

  if (RENDER_ONLY.has(row.action_type)) {
    return { ok: true, action: row.action_type, row, consumed: false };
  }

  if (row.used_at) return NEUTRAL_FAIL;
  if (!consume) return { ok: true, action: row.action_type, row, consumed: false };

  const claimed = await deps.db.claimToken(row.id, now.toISOString());
  if (!claimed) return NEUTRAL_FAIL; // raced: someone else redeemed first
  return { ok: true, action: row.action_type, row, consumed: true };
}

function isUniqueViolation(err) {
  const code = err?.code || err?.details?.code;
  return code === '23505' || /duplicate key|unique/i.test(String(err?.message || ''));
}

// ── scoped unsubscribe (stateless HMAC, U-2) ────────────────────────────────

const UNSUB_VERSION = 'v1';
const UNSUB_PURPOSE = 'brief_email_unsubscribe';

// CAN-SPAM expects the link to keep working well past the send; default far
// beyond the 30-day legal floor. Rotation of the secret is the real kill switch.
export const UNSUB_MAX_AGE_DAYS = 365;

function unsubPayload(userId, issuedYmd) {
  return b64url(Buffer.from(JSON.stringify({ u: userId, p: UNSUB_PURPOSE, d: issuedYmd }), 'utf8'));
}

function unsubMac(secret, payloadB64) {
  return b64url(createHmac('sha256', secret).update(`${UNSUB_VERSION}.${payloadB64}`).digest());
}

// `secret` is required and comes from env (BRIEF_EMAIL_LINK_SECRET). Never
// issue links without it: the caller fails closed instead.
export function issueUnsubscribeToken({ secret, userId, now = new Date() }) {
  if (!secret) throw new Error('brief tokens: unsubscribe secret missing');
  const issuedYmd = now.toISOString().slice(0, 10);
  const payloadB64 = unsubPayload(userId, issuedYmd);
  return `${UNSUB_VERSION}.${payloadB64}.${unsubMac(secret, payloadB64)}`;
}

// Accepts the current secret plus optional previous secrets (rotation).
// Neutral failure: one shape for malformed/forged/expired/unknown.
export function verifyUnsubscribeToken({ secrets, token, now = new Date(), maxAgeDays = UNSUB_MAX_AGE_DAYS }) {
  const list = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  if (!list.length || typeof token !== 'string') return { ok: false };
  const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return { ok: false };
  const [, payloadB64, mac] = m;

  const macBuf = Buffer.from(mac, 'utf8');
  const matched = list.some((secret) => {
    const expected = Buffer.from(unsubMac(secret, payloadB64), 'utf8');
    return expected.length === macBuf.length && timingSafeEqual(expected, macBuf);
  });
  if (!matched) return { ok: false };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return { ok: false };
  }
  if (payload.p !== UNSUB_PURPOSE || !payload.u || !payload.d) return { ok: false };
  const age = now.getTime() - new Date(`${payload.d}T00:00:00Z`).getTime();
  if (!Number.isFinite(age) || age < 0 || age > maxAgeDays * 86400000) return { ok: false };
  return { ok: true, userId: payload.u };
}

// Apply the unsubscribe: verify, then change ONLY the brief-email columns and
// append the audit event. Idempotent: an already-unsubscribed user gets a
// friendly ok with no duplicate consent event. Never touches opted_out.
export async function redeemUnsubscribe(deps, { token, secrets, now = new Date() }) {
  const v = verifyUnsubscribeToken({ secrets, token, now });
  if (!v.ok) return { ok: false };
  const user = await deps.db.getUserById(v.userId);
  if (!user || !user.brief_email_status) return { ok: false }; // no subscription state → neutral
  if (user.brief_email_status === 'unsubscribed') {
    return { ok: true, userId: v.userId, alreadyUnsubscribed: true };
  }
  await deps.db.setBriefEmailUnsubscribed(v.userId, now.toISOString());
  await deps.db.logConsent({
    userId: v.userId, eventType: 'brief_unsubscribed', source: 'email',
  });
  return { ok: true, userId: v.userId, alreadyUnsubscribed: false };
}
