// ─────────────────────────────────────────────────────────────────────────────
// Weekly-note EMAIL delivery job (WS-F / N2).
//
// Renders and delivers the email channel of the canonical weekly record.
// Sibling of weeklyBrief.js (SMS), which stays untouched tonight — the
// integration between the two is DESCRIBED in docs/MOUNT_N2.md, not made.
//
// Hard rules encoded here:
//   • CONSENT GATE (D16): the email goes only to a user whose FRESH
//     app_users row says brief_email_status='subscribed' with a verified
//     address. The gate re-reads the row at send time; a stale caller cannot
//     smuggle a send. Nothing in this file ever WRITES subscription state —
//     auto-subscribing is structurally impossible from the send path.
//   • ONE CANONICAL RECORD: composition goes through ensureCanonicalBrief;
//     the email is a rendering, brief_deliveries the per-channel ledger.
//     This job never touches briefs.status (SMS-job semantics).
//   • SEND-BEFORE-MARK (WS-A item 2): the delivery row is marked 'sent' only
//     after the transport confirms; a failure leaves it pending for the next
//     hourly tick, and the UNIQUE (brief_id, channel) row is reused — a retry
//     can never produce a second email row or a second canonical record.
//   • FAIL CLOSED on config: no link secret → no email at all (unsubscribe
//     links are a compliance requirement, not an optional extra).
//   • Suppression window (safety §6): when queryable and active, the note is
//     rendered in the muted register (no playful layer). See MOUNT_N2 for the
//     WS-C schema gap.
//
// Env (read directly; the config.js additions are described in MOUNT_N2.md):
//   BRIEF_EMAIL_ENABLED       'true' to run at all (default OFF — merge-safe)
//   BRIEF_EMAIL_TRANSPORT     'mock' (default) | 'sendgrid' (gated, see transport.js)
//   BRIEF_EMAIL_LIVE          live-send gate, transport.js refuses without it
//   BRIEF_EMAIL_OUTPUT_DIR    mock .eml output dir (default var/brief-email-out)
//   BRIEF_EMAIL_LINK_SECRET   HMAC secret for unsubscribe links (required)
//   BRIEF_EMAIL_LINK_SECRET_PREV  optional previous secret (rotation)
//   BRIEF_EMAIL_LINK_BASE     link host (default https://cedrus.life)
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { localParts, localWeekOf } from '../utils/time.js';
import * as briefsSvc from '../services/briefs.js';
import { isInSuppressionWindow } from '../services/safetyFlags.js';
import { gatherCandidates } from './brief/gather.js';
import { selectBriefItems } from './brief/select.js';
import { ensureCanonicalBrief, renderableItems } from '../services/brief/composer.js';
import { renderEmail } from '../services/brief/renderer.js';
import { issueActionToken, supersedePriorTokens, issueUnsubscribeToken } from '../services/brief/tokens.js';
import { createTransport } from '../services/brief/transport.js';

const MAX_ATTEMPTS = 3;

function emailEnv(env = process.env) {
  return {
    enabled: env.BRIEF_EMAIL_ENABLED === 'true',
    linkBase: (env.BRIEF_EMAIL_LINK_BASE || 'https://cedrus.life').replace(/\/$/, ''),
    secrets: [env.BRIEF_EMAIL_LINK_SECRET, env.BRIEF_EMAIL_LINK_SECRET_PREV].filter(Boolean),
  };
}

// ── adapters (the DI seams the brief services expect) ───────────────────────

const db = {
  async getBrief(userId, weekOf) {
    const { data } = await supabase.from('briefs')
      .select('*').eq('user_id', userId).eq('week_of', weekOf).eq('brief_type', 'weekly').maybeSingle();
    return data || null;
  },
  async listBriefItems(briefId) {
    const { data } = await supabase.from('brief_items').select('*').eq('brief_id', briefId);
    return data || [];
  },
  async listPeopleNames(ids) {
    const { data } = await supabase.from('people').select('id, name').in('id', ids);
    const map = {};
    for (const p of data || []) map[p.id] = p.name;
    return map;
  },
  async insertToken(row) {
    const { data, error } = await supabase.from('brief_action_tokens').insert(row).select('*').single();
    if (error) throw error;
    return data;
  },
  async supersedeTokens(userId, briefId, nowIso) {
    const { error } = await supabase.from('brief_action_tokens')
      .update({ superseded_at: nowIso })
      .eq('user_id', userId).neq('brief_id', briefId)
      .is('used_at', null).is('superseded_at', null);
    if (error) throw error;
  },
  // For the future T24 redemption route (and the tests that pin its storage
  // semantics): lookup by hash + atomic single-use claim.
  async findTokenByHash(hash) {
    const { data } = await supabase.from('brief_action_tokens')
      .select('*').eq('token_hash', hash).maybeSingle();
    return data || null;
  },
  async claimToken(id, nowIso) {
    const { data, error } = await supabase.from('brief_action_tokens')
      .update({ used_at: nowIso }).eq('id', id).is('used_at', null).select('id');
    if (error) throw error;
    return (data || []).length > 0;
  },
};

const composerDeps = {
  briefs: briefsSvc,
  gather: gatherCandidates,
  select: selectBriefItems,
  db,
};

// ── delivery ledger helpers (brief_deliveries, channel='email') ─────────────

async function getEmailDelivery(briefId) {
  const { data } = await supabase.from('brief_deliveries')
    .select('*').eq('brief_id', briefId).eq('channel', 'email').maybeSingle();
  return data || null;
}

async function createEmailDelivery({ briefId, userId, recipient }) {
  const { data, error } = await supabase.from('brief_deliveries')
    .insert({ brief_id: briefId, user_id: userId, channel: 'email', recipient, status: 'pending' })
    .select('*').single();
  if (error) {
    // UNIQUE (brief_id, channel): a concurrent tick created it first — reuse.
    if (String(error.code) === '23505' || /unique/i.test(String(error.message || ''))) {
      return getEmailDelivery(briefId);
    }
    throw error;
  }
  return data;
}

// ── cron entry ──────────────────────────────────────────────────────────────

// Hourly. Sends to every SUBSCRIBED user whose local brief hour is now.
export async function runBriefEmails(now = new Date()) {
  const env = emailEnv();
  if (!env.enabled) { logger.info('briefEmail: disabled (BRIEF_EMAIL_ENABLED != true)'); return; }
  if (!env.secrets.length) {
    logger.event('brief_email.config_error', {
      level: 'error', error_category: 'config', outcome: 'skipped',
      message: 'BRIEF_EMAIL_LINK_SECRET is not set; refusing to send email without working unsubscribe links.',
    });
    return;
  }
  const due = await getUsersDueForEmail(now);
  if (!due.length) { logger.info('briefEmail: no subscribed users due this hour'); return; }
  logger.info(`briefEmail: ${due.length} user(s) due`);
  for (const user of due) {
    try { await sendBriefEmailTo(user, now); }
    catch (err) { logger.error(`briefEmail failed for user ${user.id}`, err); }
  }
}

// Subscribed users whose local (brief_day, brief_time hour) is this hour.
// Same per-user local-time semantics as the SMS job.
async function getUsersDueForEmail(now) {
  const { data } = await supabase.from('app_users')
    .select('id, name, timezone, brief_day, brief_time, plan, billing_status, brief_email, brief_email_status, brief_email_verified_at')
    .eq('brief_email_status', 'subscribed');
  const due = [];
  for (const u of data || []) {
    const { weekday, hour } = localParts(u.timezone, now);
    if (weekday !== (u.brief_day || 'sunday')) continue;
    const briefHour = parseInt((u.brief_time || '08:00').split(':')[0], 10);
    if (hour !== briefHour) continue;
    due.push(u);
  }
  return due;
}

// ── one user's email ────────────────────────────────────────────────────────

export async function sendBriefEmailTo(user, now = new Date()) {
  const env = emailEnv();
  if (!env.secrets.length) return { skipped: 'config' }; // fail closed, direct calls included

  // CONSENT GATE — fresh read, full predicate, no writes. 'subscribed' is the
  // only state that receives delivery; the verified_at check mirrors the DB
  // backstop (D16) so a manually poked row cannot slip through either.
  const { data: sub } = await supabase.from('app_users')
    .select('id, name, timezone, brief_day, brief_time, plan, billing_status, brief_email, brief_email_status, brief_email_verified_at')
    .eq('id', user.id).maybeSingle();
  if (!sub || sub.brief_email_status !== 'subscribed' || !sub.brief_email || !sub.brief_email_verified_at) {
    logger.event('brief_email.skipped', {
      user_ref: 'u_' + user.id, message_type: 'weekly_brief_email',
      reason: 'not_subscribed', outcome: 'skipped',
    });
    return { skipped: 'not_subscribed' };
  }

  const weekOf = user._weekOf || localWeekOf(sub.timezone, now);
  const record = await ensureCanonicalBrief(composerDeps, sub, weekOf);

  // Per-channel ledger row; 'sent' means this week's email already went out.
  let delivery = await getEmailDelivery(record.brief.id);
  if (delivery?.status === 'sent') return { skipped: 'already_sent' };
  if (!delivery) delivery = await createEmailDelivery({ briefId: record.brief.id, userId: sub.id, recipient: sub.brief_email });
  if (delivery?.status === 'sent') return { skipped: 'already_sent' }; // race refetch
  const attempt = (delivery.attempts || 0) + 1;
  if (attempt > MAX_ATTEMPTS) {
    if (delivery.status !== 'failed') {
      await supabase.from('brief_deliveries')
        .update({ status: 'failed', failed_at: now.toISOString(), failure_reason: 'max_attempts' })
        .eq('id', delivery.id);
    }
    return { skipped: 'max_attempts' };
  }

  // Safety §6: active crisis cooldown mutes the playful/promotional layer.
  // (Column pending WS-C; isInSuppressionWindow fails open=false until then.)
  const muted = await isInSuppressionWindow(sub.id);

  // D18 supersession, then fresh tokens for this note.
  await supersedePriorTokens({ db }, { userId: sub.id, briefId: record.brief.id, now });
  const view = await issueActionToken({ db }, {
    userId: sub.id, briefId: record.brief.id, actionType: 'view_full_brief', now,
  });

  // Up to two actionable cards get a snooze token (remind_tomorrow). Sensitive
  // cards carry no playful actions; the muted register carries none at all.
  const itemActions = {};
  if (!muted) {
    const actionable = renderableItems(record).items
      .filter((i) => i.band === 'routine' || i.band === 'positive')
      .filter((i) => i.personId)
      .slice(0, 2);
    for (const it of actionable) {
      const snooze = await issueActionToken({ db }, {
        userId: sub.id, briefId: record.brief.id, briefItemId: it.id,
        actionType: 'remind_tomorrow', payload: { item_type: it.type }, now,
      });
      itemActions[it.id] = { remindUrl: `${env.linkBase}/note/action/${snooze.raw}` };
    }
  }

  const unsubToken = issueUnsubscribeToken({ secret: env.secrets[0], userId: sub.id, now });
  const links = {
    viewUrl: `${env.linkBase}/n/${view.raw}`,
    privacyUrl: `${env.linkBase}/privacy`,
    controlsUrl: `${env.linkBase}/settings/note`,
    unsubscribeUrl: `${env.linkBase}/email/unsubscribe/${unsubToken}`,
    itemActions,
  };

  const rendered = renderEmail(record, { now, links, muted });

  // Count the attempt, then SEND FIRST; only a confirmed send flips the row.
  await supabase.from('brief_deliveries')
    .update({ attempts: attempt, attempted_at: now.toISOString() })
    .eq('id', delivery.id);

  const transport = createTransport(process.env);
  let sent;
  try {
    sent = await transport.send({
      to: sub.brief_email, subject: rendered.subject,
      html: rendered.html, text: rendered.text,
      unsubscribeUrl: links.unsubscribeUrl, now,
    });
  } catch (err) {
    const final = attempt >= MAX_ATTEMPTS;
    await supabase.from('brief_deliveries')
      .update(final
        ? { status: 'failed', failed_at: now.toISOString(), failure_reason: 'transport_error' }
        : { failure_reason: 'transport_error' })
      .eq('id', delivery.id);
    logger.event('brief_email.send_failed', {
      brief_id: record.brief.id, user_ref: 'u_' + sub.id, message_type: 'weekly_brief_email',
      level: 'error', error_category: 'provider_error', retry_count: attempt, outcome: final ? 'failed' : 'retry',
    });
    throw err; // hourly tick retries while the row stays pending
  }

  await supabase.from('brief_deliveries')
    .update({
      status: 'sent', delivered_at: now.toISOString(), recipient: sub.brief_email,
      provider: sent.provider, provider_message_id: sent.providerMessageId,
    })
    .eq('id', delivery.id);

  // Structural fields only — never the address, never body content (A8).
  logger.event('brief_email.sent', {
    brief_id: record.brief.id, user_ref: 'u_' + sub.id, provider_id: sent.provider,
    provider_message_id: sent.providerMessageId || undefined,
    message_type: 'weekly_brief_email', body_len: rendered.html.length,
    outcome: 'sent',
  });

  return { sent: true, deliveryId: delivery.id, meta: rendered.meta };
}
