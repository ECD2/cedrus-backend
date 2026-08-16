import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { sendSms } from '../lib/twilio.js';
import * as messages from './messages.js';
import { localParts, localYMD } from '../utils/time.js';
import { getBudgetGate } from './budget.js';
import { outboundAllowed } from '../lib/smsAllowlist.js';

// ─────────────────────────────────────────────────────────────────────────────
// Admin broadcasts (night build 2026-07-28, item 3).
//
// Two channels, one law: NOTHING auto-sends. POST creates a draft; only the
// separate, explicit approve call moves anything, and there is no job that
// touches this table.
//   • web — approve publishes the row to the new frontend's feed
//     (GET /api/broadcasts/active, Session F). No SMS spend; works under
//     dry-run because nothing goes on the wire at all.
//   • sms — approve runs the send loop over the EXISTING SMS path, gated in
//     order by: quiet hours 21:00–09:00 America/New_York (enforced in code,
//     rehearsal = reality — dry-run refuses too), the 1-broadcast-per-ET-day
//     hard cap, recipient resolution (opted_out excluded; unreadable segment
//     REFUSES — sending to a wrong set is the harm, so this fails CLOSED),
//     the 500-recipient hard cap (refuse, never truncate silently), and the
//     budget kill switch. BRIEF_DRY_RUN then decides wire vs log, exactly
//     like weeklyBrief.js:77.
// ─────────────────────────────────────────────────────────────────────────────

export const BROADCAST_TZ = 'America/New_York';
export const BROADCAST_QUIET_START = 21; // 21:00 ET
export const BROADCAST_QUIET_END = 9;    // 09:00 ET
export const BROADCAST_MAX_RECIPIENTS = 500;
export const BROADCAST_DAILY_CAP = 1;
const BROADCAST_SEGMENTS = ['all', 'founding'];
const BROADCAST_CHANNELS = ['web', 'sms'];
const WEB_DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000;

const bfail = (status, code, publicMessage) => {
  const e = new Error(publicMessage); e.status = status; e.code = code; e.publicMessage = publicMessage; throw e;
};

function announceBroadcast(event, level, error, msg) {
  logger.event(event, {
    level, error_category: 'db_error',
    error_code: (error && error.code) || 'unknown',
    message: msg + ': ' + ((error && error.message) || String(error)),
  });
}

// Quiet hours in ET, [21:00, 09:00) — 9:00:00 exactly is allowed.
export function isQuietHoursET(now = new Date()) {
  const { hour } = localParts(BROADCAST_TZ, now);
  return hour >= BROADCAST_QUIET_START || hour < BROADCAST_QUIET_END;
}

function broadcastSegments(text) {
  const unicode = /[^\u0000-\u007F]/.test(text || '');
  const per = unicode ? 67 : 153;
  return Math.max(1, Math.ceil((text || '').length / per));
}

// ── Draft (the ONLY thing POST /admin/broadcasts does) ──────────────────────
export async function createDraft({ segment, channel, body, createdBy }) {
  const seg = String(segment || 'all').trim().toLowerCase();
  const chan = String(channel || '').trim().toLowerCase();
  const text = String(body || '').trim();
  if (!BROADCAST_SEGMENTS.includes(seg)) bfail(400, 'bad_segment', `segment must be one of: ${BROADCAST_SEGMENTS.join(', ')}`);
  if (!BROADCAST_CHANNELS.includes(chan)) bfail(400, 'bad_channel', 'channel must be web or sms');
  if (!text || text.length > 1200) bfail(400, 'bad_body', 'body is required, max 1200 chars');

  const { data, error } = await supabase.from('broadcasts').insert({
    segment: seg, channel: chan, body: text, status: 'draft', created_by: createdBy || 'admin',
  }).select('*').single();
  if (error) { announceBroadcast('broadcast.write.failed', 'error', error, 'draft insert'); bfail(500, 'internal', 'could not create the draft'); }
  logger.event('broadcast.drafted', { outcome: 'draft', message: `broadcast ${data.id} ${chan}/${seg} (draft only — nothing sends without the approve call)` });
  return data;
}

export async function listBroadcasts({ limit } = {}) {
  const { data, error } = await supabase.from('broadcasts').select('*');
  if (error) { announceBroadcast('broadcast.read.failed', 'error', error, 'list'); return []; }
  const rows = (data || []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return rows.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}

// Recipient resolution FAILS CLOSED: an unreadable segment refuses the send
// (returning null), because "send to whoever we could read" is exactly the
// wrong-set harm a broadcast can do. opted_out is excluded at the query.
export async function resolveRecipients(segment) {
  let q = supabase.from('app_users').select('id, phone, opted_out, member_status').eq('opted_out', false);
  if (segment === 'founding') q = q.eq('member_status', 'founding');
  const { data, error } = await q;
  if (error) { announceBroadcast('broadcast.read.failed', 'error', error, `recipient resolution (${segment})`); return null; }
  return (data || []).filter((u) => u.phone);
}

// ── The explicit approval call — the ONLY sender ────────────────────────────
export async function approveBroadcast({ id, approvedBy, now = new Date() }) {
  const { data: row, error } = await supabase.from('broadcasts').select('*').eq('id', id).maybeSingle();
  if (error) { announceBroadcast('broadcast.read.failed', 'error', error, 'approve read'); bfail(500, 'internal', 'could not read the broadcast'); }
  if (!row) bfail(404, 'not_found', 'no such broadcast');
  if (row.status !== 'draft') bfail(409, 'not_draft', `broadcast is ${row.status}, only a draft can be approved`);

  const nowIso = now.toISOString();

  if (row.channel === 'web') {
    // Publish to the feed. No wire, no spend — allowed under dry-run and
    // under a budget pause alike.
    const { data: won, error: casErr } = await supabase.from('broadcasts')
      .update({
        status: 'sent', approved_at: nowIso, approved_by: approvedBy || 'admin',
        sent_at: nowIso, updated_at: nowIso,
        expires_at: row.expires_at || new Date(now.getTime() + WEB_DEFAULT_TTL_MS).toISOString(),
      })
      .eq('id', id).eq('status', 'draft').select('id');
    if (casErr) { announceBroadcast('broadcast.write.failed', 'error', casErr, 'web publish'); bfail(500, 'internal', 'could not publish'); }
    if (!Array.isArray(won) || won.length !== 1) bfail(409, 'not_draft', 'another approval got there first');
    logger.event('broadcast.sent', { outcome: 'sent', message: `broadcast ${id} published to the web feed` });
    return { id, channel: 'web', sent: true };
  }

  // ── SMS channel: every gate runs BEFORE the claim, dry-run or not ─────────
  if (isQuietHoursET(now)) {
    bfail(422, 'quiet_hours', 'quiet hours (21:00–09:00 America/New_York) — approve again in the morning');
  }

  const { data: prior, error: priorErr } = await supabase.from('broadcasts')
    .select('id, sent_at').eq('channel', 'sms').eq('status', 'sent');
  if (priorErr) { announceBroadcast('broadcast.read.failed', 'error', priorErr, 'daily-cap read'); bfail(500, 'internal', 'could not check the daily cap'); }
  const today = localYMD(BROADCAST_TZ, now);
  const sentToday = (prior || []).filter((b) => b.sent_at && localYMD(BROADCAST_TZ, new Date(b.sent_at)) === today).length;
  if (sentToday >= BROADCAST_DAILY_CAP) {
    bfail(422, 'daily_cap', `already sent ${sentToday} SMS broadcast(s) today (ET) — hard cap is ${BROADCAST_DAILY_CAP}/day`);
  }

  const resolved = await resolveRecipients(row.segment);
  if (resolved === null) bfail(500, 'recipients_unreadable', 'could not resolve the segment — refusing to send to an unknown set');
  // Outbound allow-list applied at SELECTION, before the count checks: a segment
  // that resolves entirely to blocked numbers must refuse with no_recipients,
  // not report a successful broadcast delivered to nobody.
  const recipients = resolved.filter((u) => outboundAllowed(u.phone, config.allowedPhones));
  if (resolved.length !== recipients.length) {
    logger.event('broadcast.recipients.filtered', {
      outcome: 'accepted', reason: 'not_allowlisted', count: resolved.length - recipients.length,
      message: `${resolved.length - recipients.length} of ${resolved.length} recipient(s) dropped: not on ALLOWED_PHONES`,
    });
  }
  if (!recipients.length) bfail(422, 'no_recipients', 'the segment resolved to zero sendable users');
  if (recipients.length > BROADCAST_MAX_RECIPIENTS) {
    bfail(422, 'too_many_recipients', `segment resolves to ${recipients.length} recipients — hard cap is ${BROADCAST_MAX_RECIPIENTS}; split the segment`);
  }

  const gate = await getBudgetGate();
  if (gate.paused) bfail(409, 'budget_paused', `the daily ${gate.reason || 'spend'} budget is exhausted — the kill switch is active`);

  // Claim (CAS): a double-clicked approve loses here, not in the send loop.
  const { data: claimed, error: claimErr } = await supabase.from('broadcasts')
    .update({ status: 'approved', approved_at: nowIso, approved_by: approvedBy || 'admin', updated_at: nowIso })
    .eq('id', id).eq('status', 'draft').select('id');
  if (claimErr) { announceBroadcast('broadcast.write.failed', 'error', claimErr, 'approve claim'); bfail(500, 'internal', 'could not claim the broadcast'); }
  if (!Array.isArray(claimed) || claimed.length !== 1) bfail(409, 'not_draft', 'another approval got there first');

  const segments = broadcastSegments(row.body);
  let delivered = 0;
  let failed = 0;
  for (const u of recipients) {
    try {
      if (config.briefDryRun) {
        await messages.logOutbound({ userId: u.id, body: row.body, messageType: 'broadcast', providerStatus: 'dry_run', segments });
      } else {
        const sent = await sendSms(u.phone, row.body);
        await messages.logOutbound({ userId: u.id, body: row.body, messageType: 'broadcast', providerMessageId: sent?.sid || null, providerStatus: sent?.status || 'queued', segments });
      }
      delivered++;
    } catch (err) {
      // One bad number must not kill the run; every failure is announced.
      failed++;
      logger.event('broadcast.send.failed', {
        level: 'error', error_category: 'provider_error', user_ref: 'u_' + u.id, outcome: 'error',
        message: `broadcast ${id}: ${err?.message || String(err)}`,
      });
    }
  }

  const { error: doneErr } = await supabase.from('broadcasts')
    .update({ status: 'sent', sent_at: nowIso, recipient_count: delivered, updated_at: nowIso })
    .eq('id', id).eq('status', 'approved');
  if (doneErr) announceBroadcast('broadcast.write.failed', 'error', doneErr, 'sent finalize');

  logger.event('broadcast.sent', {
    outcome: 'sent', count: delivered,
    message: `broadcast ${id} ${config.briefDryRun ? 'DRY-RUN ' : ''}to ${delivered}/${recipients.length} recipient(s), ${failed} failed`,
  });
  return { id, channel: 'sms', sent: true, dryRun: config.briefDryRun, recipients: recipients.length, delivered, failed };
}

// ── The web feed read (Session F consumes this) ─────────────────────────────
export async function getActiveWebBroadcasts(now = new Date()) {
  const { data, error } = await supabase.from('broadcasts')
    .select('id, body, sent_at, expires_at, channel, status')
    .eq('channel', 'web').eq('status', 'sent');
  if (error) { announceBroadcast('broadcast.read.failed', 'error', error, 'active-web read'); return []; }
  const nowMs = now.getTime();
  return (data || [])
    .filter((b) => !b.expires_at || new Date(b.expires_at).getTime() > nowMs)
    .sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')))
    .slice(0, 20)
    .map((b) => ({ id: b.id, body: b.body, sent_at: b.sent_at }));
}
