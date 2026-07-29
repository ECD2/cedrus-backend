import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import * as rel from './relationships.js';

// ─────────────────────────────────────────────────────────────────────────────
// Opportunity-card rail (night build 2026-07-28, item 2; spec PART 2 + PART 3).
//
// Emil is the card generator in V1 (admin queue → POST /admin/cards). This
// module owns the shared card operations: queue-time validation, the reply
// vocabulary state machine, suppression bookkeeping, and the met-confirmed
// write — the ONLY tree-advancing event in the product.
//
// supabase-js never throws (doctrine Lesson 11): every write here binds
// `error`, announces failures (cards.write.failed), and — critically — never
// sends the user a confident ack for a write that did not land (Lesson 1).
// A failed NEVER/NOT THEM suppression write gets an honest "try again" and
// leaves the card awaiting, so the user's retry can succeed.
// ─────────────────────────────────────────────────────────────────────────────

// Reply vocabulary (spec PART 3, complete): exact tokens only, case-insensitive,
// trailing punctuation tolerated. Anything else falls through to the ordinary
// pipeline — a card must never swallow a real message.
const SENT_VOCAB = ['YES', 'SKIP', 'LATER', 'NOT THEM', 'NEVER'];
const FOLLOWUP_VOCAB = ['YES', 'NO', 'NOT YET'];

// A question stops matching after its window: a bare "yes" months later must
// not resurrect a stale card. Sent cards fade (spec: an unanswered card simply
// fades); follow-ups stop asking sooner.
const SENT_MATCH_WINDOW_MS = 14 * 24 * 3600 * 1000;
const FOLLOWUP_MATCH_WINDOW_MS = 7 * 24 * 3600 * 1000;

// 3 days post-YES (the brief's "did it happen?" cadence).
export const FOLLOWUP_DELAY_MS = 3 * 24 * 3600 * 1000;

// Hard cadence cap enforced in the sender: 3 card sends per user per rolling
// 7 days (spec PART 3: 2–3 per week, never daily; scarcity is the feature).
export const CARD_WEEKLY_CAP = 3;
export const CARD_CAP_WINDOW_MS = 7 * 24 * 3600 * 1000;

// Daytime send window, user-local (same constants as the sweeps rail — a 3am
// card is a product bug even in a daytime product). Shared by both card jobs.
export const CARD_WINDOW_START = 10; // 10am
export const CARD_WINDOW_END = 19;   // 7pm

const MSG_WRITE_FAILED = 'Something went wrong on my end. Try that again in a moment.';

function announceWriteFailure(what, error) {
  logger.event('cards.write.failed', {
    level: 'error', error_category: 'db_error',
    error_code: (error && error.code) || 'unknown', outcome: 'invariant_at_risk',
    message: `${what}: ` + ((error && error.message) || String(error)),
  });
}

function announceReadFailure(what, error) {
  logger.event('cards.read.failed', {
    level: 'error', error_category: 'db_error',
    error_code: (error && error.code) || 'unknown', outcome: 'fail_open',
    message: `${what}: ` + ((error && error.message) || String(error)),
  });
}

export function normalizeReplyToken(body) {
  return String(body || '')
    .trim().toUpperCase()
    .replace(/[.!?,;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Suppression (NOT THEM / NEVER) ──────────────────────────────────────────

// Is there an active suppression for this (user, person, kind)? A NEVER row
// (kind NULL) suppresses every kind. Fails OPEN on read errors — but note the
// queue endpoint ALSO checks, so a transient miss here is caught at send time
// and vice versa.
export async function hasActiveSuppression({ userId, personId, kind }) {
  const { data, error } = await supabase
    .from('suppressed_pairings')
    .select('id, kind, revoked_at')
    .eq('user_id', userId)
    .eq('person_id', personId);
  if (error) { announceReadFailure('suppression read', error); return false; }
  return (data || []).some((row) =>
    !row.revoked_at && (row.kind == null || row.kind === kind));
}

async function recordSuppression({ userId, personId, kind, reason, sourceCardId }) {
  const { error } = await supabase.from('suppressed_pairings').insert({
    user_id: userId, person_id: personId, kind: kind ?? null, reason,
    source_card_id: sourceCardId || null,
  });
  if (error) { announceWriteFailure(`suppression insert (${reason})`, error); return false; }
  return true;
}

// ── Queue (admin) ───────────────────────────────────────────────────────────

// Validation lives here, not in the route. Throws typed errors carrying
// { status, code, publicMessage } (the routes/api error convention).
export async function queueCard({ userId, personId, kind, occasion, body, inviteText, sendAfter, createdBy }) {
  const fail = (status, code, publicMessage) => {
    const e = new Error(publicMessage); e.status = status; e.code = code; e.publicMessage = publicMessage; throw e;
  };

  if (!userId || !personId) fail(400, 'missing_ids', 'user_id and person_id are required');
  const kindNorm = String(kind || '').trim().toLowerCase();
  if (!kindNorm) fail(400, 'missing_kind', 'kind is required (e.g. coffee, walk, lunch)');
  const bodyText = String(body || '').trim();
  const invite = String(inviteText || '').trim();
  if (!bodyText || bodyText.length > 1200) fail(400, 'bad_body', 'body is required, max 1200 chars');
  if (!invite || invite.length > 1200) fail(400, 'bad_invite', 'invite_text is required, max 1200 chars');

  const { data: user, error: userErr } = await supabase
    .from('app_users').select('id, opted_out').eq('id', userId).maybeSingle();
  if (userErr) { announceReadFailure('queue user read', userErr); fail(500, 'internal', 'could not verify the user'); }
  if (!user) fail(404, 'no_user', 'no such user');
  if (user.opted_out) fail(422, 'opted_out', 'that user has opted out of SMS — a card cannot be queued');

  // Single-sided data rule (spec PART 3): the person must be THIS user's person.
  const { data: person, error: personErr } = await supabase
    .from('people').select('id, user_id, name').eq('id', personId).maybeSingle();
  if (personErr) { announceReadFailure('queue person read', personErr); fail(500, 'internal', 'could not verify the person'); }
  if (!person || person.user_id !== userId) fail(422, 'not_their_person', 'person does not belong to that user');

  // NEVER/NOT THEM are promises. Refuse at queue time, loudly.
  if (await hasActiveSuppression({ userId, personId, kind: kindNorm })) {
    fail(409, 'suppressed', 'the user suppressed this pairing (NOT THEM/NEVER) — not queueing');
  }

  const { data: card, error: insErr } = await supabase.from('opportunity_cards').insert({
    user_id: userId, person_id: personId, kind: kindNorm,
    occasion: occasion ? String(occasion).trim() : null,
    body: bodyText, invite_text: invite,
    status: 'queued', created_by: createdBy || 'admin',
    send_after: sendAfter || null,
  }).select('*').single();
  if (insErr) { announceWriteFailure('card insert', insErr); fail(500, 'internal', 'could not queue the card'); }

  const sentLast7d = await countRecentSends(userId);
  logger.event('card.queued', {
    user_ref: 'u_' + userId, message_type: 'card', outcome: 'queued',
    message: `card ${card.id} kind=${kindNorm} sends_last_7d=${sentLast7d}`,
  });
  return { card, sends_last_7d: sentLast7d, weekly_cap: CARD_WEEKLY_CAP };
}

export async function listCards({ userId, limit } = {}) {
  let q = supabase.from('opportunity_cards').select('*');
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) { announceReadFailure('card list', error); return []; }
  const rows = (data || []).slice().sort((a, b) =>
    String(b.queued_at || '').localeCompare(String(a.queued_at || '')));
  return rows.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}

// Rolling-7-day send count (the sender's cap input). Counts every card that
// left the building (sent_at stamped), whatever happened to it afterwards.
export async function countRecentSends(userId, now = new Date()) {
  const { data, error } = await supabase
    .from('opportunity_cards').select('id, sent_at')
    .eq('user_id', userId)
    .not('sent_at', 'is', null);
  if (error) { announceReadFailure('recent-send count', error); return null; }
  const cutoff = now.getTime() - CARD_CAP_WINDOW_MS;
  return (data || []).filter((r) => r.sent_at && new Date(r.sent_at).getTime() > cutoff).length;
}

// ── Inbound reply state machine (pipeline STAGE B2.6) ───────────────────────

// The most recently ASKED still-open question wins: a card awaiting its reply
// (status 'sent', within 14d of sent_at) vs a follow-up awaiting its answer
// (status 'followup_sent', within 7d of followup_sent_at).
async function findAwaitingCard(userId, now) {
  const { data, error } = await supabase
    .from('opportunity_cards').select('*')
    .eq('user_id', userId)
    .in('status', ['sent', 'followup_sent']);
  if (error) { announceReadFailure('awaiting-card read', error); return null; }
  const nowMs = now.getTime();
  const cands = (data || [])
    .map((c) => ({
      c,
      askedAt: c.status === 'sent' ? c.sent_at : c.followup_sent_at,
      windowMs: c.status === 'sent' ? SENT_MATCH_WINDOW_MS : FOLLOWUP_MATCH_WINDOW_MS,
    }))
    .filter((x) => x.askedAt && nowMs - new Date(x.askedAt).getTime() <= x.windowMs)
    .sort((a, b) => new Date(b.askedAt).getTime() - new Date(a.askedAt).getTime());
  return cands.length ? cands[0].c : null;
}

// Concatenated-SMS segment estimate (GSM-7 vs UCS-2 multipart sizes) — same
// arithmetic as weeklyBrief/dailySweeps, shared here so the card jobs agree.
export function estimateSegments(text) {
  const unicode = /[^\u0000-\u007F]/.test(text);
  const per = unicode ? 67 : 153;
  return Math.max(1, Math.ceil((text || '').length / per));
}

// CAS transition: only wins if the card is still in fromStatus (a replayed or
// double-tapped reply loses the race and falls through harmlessly). Exported
// for the sender/follow-up jobs (claim/revert), reminders-style.
export async function transitionCard(cardId, fromStatus, patch) {
  const { data, error } = await supabase
    .from('opportunity_cards')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', cardId).eq('status', fromStatus)
    .select('id');
  if (error) { announceWriteFailure(`card transition ${fromStatus}→${patch.status}`, error); return false; }
  return Array.isArray(data) && data.length === 1;
}

// The one tree-advancing write (spec PART 2 step 5). The card row is the source
// of truth; the people counters are the garden's denormalized read model, and a
// failed counter write is announced but does not un-confirm the meeting.
async function recordMetConfirmed({ userId, personId, sourceMessageId, now }) {
  try {
    const { data, error } = await supabase
      .from('people').select('met_confirmed_count')
      .eq('id', personId).eq('user_id', userId).maybeSingle();
    if (error || !data) { announceWriteFailure('met-confirmed people read', error || { message: 'person row not found' }); return false; }
    const { error: upErr } = await supabase
      .from('people')
      .update({
        met_confirmed_count: (Number(data.met_confirmed_count) || 0) + 1,
        last_met_confirmed_at: now.toISOString(),
      })
      .eq('id', personId).eq('user_id', userId);
    if (upErr) { announceWriteFailure('met-confirmed people update', upErr); return false; }
    // Confirmed in-person time is also a contact event (source 'confirmed' is a
    // legal contact_source enum value) — the existing trigger freshens
    // people.last_contact_at, so "Last touch" agrees with the garden.
    await rel.logContact({ userId, personId, source: 'confirmed', sourceMessageId, contactType: 'in_person' });
    return true;
  } catch (err) {
    announceWriteFailure('met-confirmed write threw', err);
    return false;
  }
}

async function handleSentReply({ user, card, token, sourceMessageId, now }) {
  const nowIso = now.toISOString();
  const replied = { replied_at: nowIso, reply_token: token };

  if (token === 'YES') {
    const ok = await transitionCard(card.id, 'sent', {
      status: 'accepted', ...replied,
      followup_due_at: new Date(now.getTime() + FOLLOWUP_DELAY_MS).toISOString(),
    });
    if (!ok) return { handled: false };
    logger.event('card.reply', { user_ref: 'u_' + user.id, outcome: 'accepted', message_type: 'card', message: `card ${card.id} YES` });
    return {
      handled: true,
      reply: "Here's your invite, ready to send:\n\n" + card.invite_text +
        "\n\nCopy it, make it yours, and send it from your own phone. I'll check in in a few days.",
    };
  }

  if (token === 'SKIP') {
    const ok = await transitionCard(card.id, 'sent', { status: 'skipped', ...replied });
    if (!ok) return { handled: false };
    logger.event('card.reply', { user_ref: 'u_' + user.id, outcome: 'skipped', message_type: 'card', message: `card ${card.id} SKIP` });
    return { handled: true, reply: 'No problem, skipping that one.' };
  }

  if (token === 'LATER') {
    const ok = await transitionCard(card.id, 'sent', { status: 'later', ...replied });
    if (!ok) return { handled: false };
    logger.event('card.reply', { user_ref: 'u_' + user.id, outcome: 'later', message_type: 'card', message: `card ${card.id} LATER` });
    return { handled: true, reply: "Got it. Right idea, another week - I'll bring it back around." };
  }

  if (token === 'NOT THEM' || token === 'NEVER') {
    // The suppression row is the promise; write it FIRST. If it fails, the user
    // gets an honest error and the card stays awaiting so a retry can land —
    // never a confident ack over a missing write (Lesson 1).
    const wrote = await recordSuppression({
      userId: user.id, personId: card.person_id,
      kind: token === 'NEVER' ? null : card.kind,
      reason: token === 'NEVER' ? 'never' : 'not_them',
      sourceCardId: card.id,
    });
    if (!wrote) return { handled: true, reply: MSG_WRITE_FAILED };
    const ok = await transitionCard(card.id, 'sent', {
      status: token === 'NEVER' ? 'never' : 'not_them', ...replied,
    });
    if (!ok) { /* suppression stands; the card state race is harmless */ }
    logger.event('card.reply', { user_ref: 'u_' + user.id, outcome: token === 'NEVER' ? 'never' : 'not_them', message_type: 'card', message: `card ${card.id} ${token}` });
    return {
      handled: true,
      reply: token === 'NEVER'
        ? "Done. I'll stop suggesting that. If you ever change your mind, just tell me."
        : `Understood. I won't suggest ${card.kind} plans with them again.`,
    };
  }

  return { handled: false };
}

async function handleFollowupReply({ user, card, token, sourceMessageId, now }) {
  const nowIso = now.toISOString();

  if (token === 'YES') {
    const ok = await transitionCard(card.id, 'followup_sent', {
      status: 'met_confirmed', met_confirmed_at: nowIso, reply_token: 'YES',
    });
    if (!ok) return { handled: false };
    await recordMetConfirmed({ userId: user.id, personId: card.person_id, sourceMessageId, now });
    logger.event('card.met_confirmed', { user_ref: 'u_' + user.id, outcome: 'met_confirmed', message_type: 'card', message: `card ${card.id} confirmed in-person time` });
    return { handled: true, reply: "Noted, and glad it happened. That's the kind of time that counts." };
  }

  if (token === 'NO' || token === 'NOT YET') {
    const ok = await transitionCard(card.id, 'followup_sent', {
      status: 'met_no', reply_token: token,
    });
    if (!ok) return { handled: false };
    logger.event('card.reply', { user_ref: 'u_' + user.id, outcome: 'met_no', message_type: 'card', message: `card ${card.id} ${token}` });
    return { handled: true, reply: "All good. Some weeks just fill up. I'll keep an eye out for another window." };
  }

  return { handled: false };
}

// Pipeline entry (STAGE B2.6). Returns { handled, reply }. handled:false means
// "not a card reply — let the ordinary pipeline have it", and every failure
// path that can safely fall through does so (a broken card rail must never
// block a real message).
export async function handleCardReply({ user, body, sourceMessageId = null, now = new Date() }) {
  const token = normalizeReplyToken(body);
  const inSentVocab = SENT_VOCAB.includes(token);
  const inFollowupVocab = FOLLOWUP_VOCAB.includes(token);
  if (!inSentVocab && !inFollowupVocab) return { handled: false };

  const card = await findAwaitingCard(user.id, now);
  if (!card) return { handled: false };

  if (card.status === 'sent' && inSentVocab) {
    return handleSentReply({ user, card, token, sourceMessageId, now });
  }
  if (card.status === 'followup_sent' && inFollowupVocab) {
    return handleFollowupReply({ user, card, token, sourceMessageId, now });
  }
  return { handled: false };
}
