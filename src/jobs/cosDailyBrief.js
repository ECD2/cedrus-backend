// ─────────────────────────────────────────────────────────────────────────────
// CoS daily brief — the scheduled job.
//
// Composes a daily brief from Chief of Staff's records PLUS its ingested email,
// emails it through Resend, and writes it back into CoS's today_briefs so the
// CoS app renders the same brief the email contained.
//
// ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
// It does not call any CoS Edge Function, does not touch CoS's manual-only
// sync, does not weaken CoS's AAL2 requirement, and does not run a CoS
// migration. CoS's deliberate "never acts autonomously" posture is intact;
// Cedrus is the system that acts, and it reads CoS's database directly.
//
// ── THE FOUR MODES, MOST CONSERVATIVE FIRST ─────────────────────────────────
//   1. DISARMED          COS_SUPABASE_URL / COS_SERVICE_ROLE_KEY unset.
//                        Reads nothing, composes nothing, sends nothing.
//   2. DRY RUN           COS_BRIEF_DRY_RUN=true. Composes and logs. No email,
//                        no writeback, no ledger claim. Makes a real billable
//                        model call.
//   3. WRITEBACK-ONLY    COS_BRIEF_WRITEBACK_ONLY=true. Composes AND writes the
//                        row into CoS. Still no email, still no ledger claim.
//                        Overrides COS_BRIEF_LIVE.
//   4. LIVE              COS_BRIEF_LIVE=true + RESEND_API_KEY + COS_BRIEF_TO.
//                        Sends, then writes back.
//
// Mode 3 exists because of the ORDER inside mode 4: send first, write second.
// A writeback that fails on its first real attempt would do so AFTER the email
// left and AFTER the ledger said 'sent' — and the fail-closed ledger then
// correctly refuses to retry that day. So the owner would get an email, see
// nothing in the app, and have no recourse. Mode 3 moves that first real
// attempt to a run where failing is free. It is also the only operation in
// this entire job that touches Chief of Staff's production data.
//
// Nothing reaches a person until mode 4's three variables are ALL set. Unsetting
// any one of them stops delivery.
//
// ── WHY ITS OWN DRY-RUN FLAG ────────────────────────────────────────────────
// BRIEF_DRY_RUN is the SMS rail's switch and CEDRUS.md Law 5 reserves flipping
// it for a named arming session. Overloading it would mean arming the SMS rail
// and this brief with one variable — two unrelated blast radii behind one
// switch. COS_BRIEF_DRY_RUN is separate and this job never reads BRIEF_DRY_RUN.
//
// ── ONE DELIBERATE DIVERGENCE FROM THE HOUSE DRY-RUN MEANING ────────────────
// BRIEF_DRY_RUN means "compose and RECORD, but log instead of sending".
// COS_BRIEF_DRY_RUN suppresses the send AND the CoS writeback. The writeback is
// user-visible — CoS's app shows the newest generation_mode='ai' row as the
// current brief — so a "dry run" that silently changed what the app displays
// would be a dry run with a side effect. Recording it would also make the
// rehearsal indistinguishable from the real thing in CoS's data. Documented
// here rather than left as a surprise.
//
// Like BRIEF_DRY_RUN, a dry run DOES make its OpenAI call: the point is to
// rehearse the real path, and the model call is where most of what can go
// wrong lives. It costs tokens. It does NOT claim the send ledger, so a dry run
// never consumes the day's slot.
// ─────────────────────────────────────────────────────────────────────────────

import { openai } from '../lib/openai.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import * as usage from '../services/usage.js';
import { announceCosMode, cosEnv } from '../services/cos/client.js';
import { gatherCosInput } from '../services/cos/reader.js';
import { minimizeInput, enforceTotalSize, isEmptyInput, validateBrief, buildRequestBody } from '../services/cos/compose.js';
import { renderBriefEmail } from '../services/cos/renderer.js';
import { createResendTransport, deliveryEnv } from '../services/cos/resendTransport.js';
import { claimSend, markSent, releaseClaim } from '../services/cos/ledger.js';
import { writeBriefToCos } from '../services/cos/writer.js';

/** Which model composes the brief. */
export function briefModel(env = process.env) {
  // Defaults to this repo's configured model rather than CoS's `gpt-5.6-terra`.
  // The `model` column of the row we write is a factual record of what actually
  // produced the brief; naming CoS's model for a call this repo made with
  // gpt-4.1-mini would put a false statement in CoS's database.
  return (env.COS_BRIEF_MODEL || '').trim() || config.openaiModel;
}

export function isDryRun(env = process.env) {
  return env.COS_BRIEF_DRY_RUN === 'true';
}

/**
 * Writeback-only: compose, write the row into CoS, send NOTHING.
 *
 * This exists because of the ORDER of the live path. Delivery sends first and
 * writes second, so if the writeback fails on its first ever real attempt — a
 * drifted column, a CHECK we read wrong, an unresolvable owner id — the email
 * has already gone, the ledger already says 'sent', and the fail-closed design
 * correctly refuses to retry that day. The owner gets a brief in their inbox,
 * sees nothing in the app, and has no recourse until tomorrow.
 *
 * The writeback is also the ONLY operation in this whole job that touches
 * Chief of Staff's production data, and it is the least verified thing here:
 * it has never run against the real database. Giving the least-verified,
 * highest-consequence operation its own rung means it can fail on a day when
 * failing is free.
 *
 * Precedence, both directions deliberate:
 *   • COS_BRIEF_DRY_RUN wins over this — it is the more conservative mode, so
 *     setting both gets you the safer one, not a surprise write.
 *   • This wins over COS_BRIEF_LIVE — the rung must stay safe even if someone
 *     sets the live flag early, which is exactly the mistake it guards.
 *
 * It does NOT claim the send ledger: nothing goes on the wire, so it must not
 * consume the day's send slot. One consequence worth knowing: each run inserts
 * one today_briefs row, so repeated runs leave repeated rows. That is the point
 * (it proves the insert really works) and it is reversible with a delete.
 */
export function isWritebackOnly(env = process.env) {
  return env.COS_BRIEF_WRITEBACK_ONLY === 'true';
}

/**
 * Which of the four modes is in force. THE SINGLE SOURCE OF PRECEDENCE.
 *
 * Written as one ordered function after a mutation run proved the previous
 * shape untestable: precedence had been encoded three times over (a `!dryRun`
 * in the mode variable, the order of a ternary, and the order of the early
 * returns), so breaking any one of them changed nothing observable and the
 * suite stayed green. Redundant guards are not extra safety — they are guards
 * no test can hold, and they rot silently.
 *
 * Order is the rule: the more conservative mode always wins, so setting two
 * flags gets the safer one. Swapping two lines here is a real behaviour change
 * and Bundle 38 catches it.
 */
export function briefMode(env = process.env) {
  if (isDryRun(env)) return 'dry_run';
  if (isWritebackOnly(env)) return 'writeback_only';
  return deliveryEnv(env).ready ? 'live' : 'not_configured';
}

/**
 * Entry point. The scheduler is the only caller.
 *
 * Returns a small result object (used by the tests and readable in logs); the
 * job never throws for an expected condition, only for a genuine bug.
 */
export async function runCosDailyBrief({ env = process.env, now = new Date(), deps = {} } = {}) {
  const {
    gather = gatherCosInput,
    callModel = defaultCallModel,
    transportFactory = createResendTransport,
    claim = claimSend,
    mark = markSent,
    release = releaseClaim,
    write = writeBriefToCos,
    logRun = defaultLogRun,
  } = deps;

  // ── mode, announced every run, armed or not (Lesson 7) ────────────────────
  const mode = announceCosMode(env);
  if (!mode.armed) return { ran: false, reason: 'disarmed', sent: false, written: false };

  // Four modes, most conservative first. Exactly one is in force per run and
  // the chosen one is named in the log, so "which rung am I on?" is never a
  // guess (Lesson 7).
  const delivery = deliveryEnv(env);
  const modeName = briefMode(env);
  const dryRun = modeName === 'dry_run';
  const writebackOnly = modeName === 'writeback_only';
  const modeMessage = {
    dry_run:
      'COS_BRIEF_DRY_RUN=true — the brief will be composed and logged. No email, no writeback, no ledger claim.',
    writeback_only:
      'COS_BRIEF_WRITEBACK_ONLY=true — the brief will be composed and WRITTEN BACK to CoS today_briefs. ' +
      'No email, no ledger claim. This overrides COS_BRIEF_LIVE.',
    live:
      'delivery LIVE — a composed brief will be emailed and written back to CoS',
    not_configured:
      `delivery NOT CONFIGURED — missing: ${delivery.missing.join(', ')}. The brief will be composed and logged only.`,
  }[modeName];
  logger.event('cos.delivery.mode', { outcome: modeName, message: modeMessage });

  // ── gather, failing closed on any unreadable table ────────────────────────
  const gathered = await gather({ now, env });
  if (!gathered.ok) {
    if (gathered.reason === 'read_failed') {
      logger.event('cos.brief.aborted', {
        level: 'error', error_category: 'db_error', outcome: 'fail_closed',
        message: `CoS tables unreadable (${(gathered.tables || []).join(', ')}) — refusing to compose a brief from partial data`,
      });
    }
    return { ran: false, reason: gathered.reason, sent: false, written: false };
  }

  const minimized = enforceTotalSize(minimizeInput(gathered.data, now.getTime()));
  if (isEmptyInput(minimized)) {
    logger.event('cos.brief.empty', {
      outcome: 'no_input',
      message: 'no CoS records or email in the window — no brief composed (an empty day is a valid answer)',
    });
    return { ran: true, reason: 'no_input', sent: false, written: false };
  }

  // ── the model call ────────────────────────────────────────────────────────
  const model = briefModel(env);
  const started = Date.now();
  let result;
  try {
    result = await callModel(buildRequestBody(minimized, model));
  } catch (err) {
    logger.event('cos.brief.model_failed', {
      level: 'error', error_category: 'upstream',
      message: `model call failed: ${(err && err.message) || String(err)}`,
    });
    return { ran: true, reason: 'model_failed', sent: false, written: false };
  }
  const latencyMs = Date.now() - started;

  // Spend accounting. Without this the job's tokens are invisible to
  // DAILY_TOKEN_BUDGET and the guard undercounts (see the announcement below).
  await logRun({ env, model: result.model || model, usage: result.usage, latencyMs });

  // `now` is threaded so the brief's own generated_at is the job's real clock,
  // never whatever the model decided to write there.
  const validation = validateBrief(result.parsed, minimized, now);
  if (!validation.ok) {
    logger.event('cos.brief.rejected', {
      level: 'error', error_category: 'validation', outcome: validation.category,
      // The detail names the rule, never the content that broke it.
      message: `composed brief REJECTED (${validation.category}): ${validation.detail}. Nothing sent, nothing written.`,
    });
    return { ran: true, reason: validation.category, sent: false, written: false };
  }
  const brief = validation.brief;

  // ── dry run stops here, having proven everything except the wire ──────────
  if (dryRun) {
    // Render it, so the dry run really does exercise the renderer — but do NOT
    // put the subject in the log line. logger.scrub() reads a bare YYYY-MM-DD
    // as a phone number and rewrites it to [phone:MMDD], which turns an honest
    // rehearsal line into a confusing one. Counts carry the same information
    // and survive scrubbing intact.
    const rendered = renderBriefEmail(brief, now);
    logger.event('cos.brief.dry_run', {
      outcome: 'composed',
      priorities: brief.top_priorities.length,
      cited_records: countRefs(brief),
      subject_chars: rendered.subject.length,
      message: 'DRY RUN — a brief was composed and rendered. Not sent, not written back.',
    });
    return { ran: true, reason: 'dry_run', sent: false, written: false, brief };
  }

  // ── writeback-only stops here, having proven the CoS insert ───────────
  //
  // The rung between "rehearsed" and "live". It exercises the one operation
  // that writes to Chief of Staff's production database, on a run where a
  // failure costs nothing: no email has gone out, so there is nothing to be
  // inconsistent with, and no ledger row to unstick.
  if (writebackOnly) {
    const wroteOnly = await write({
      brief, minimizedInput: minimized, model: result.model || model,
      latencyMs, tokens: totalTokens(result.usage), env, now,
    });
    if (wroteOnly.skipped) {
      logger.event('cos.brief.writeback_only', {
        level: 'error', error_category: 'db_error', outcome: wroteOnly.reason,
        message:
          `WRITEBACK-ONLY FAILED (${wroteOnly.reason}) — nothing was written to CoS. ` +
          'Fix this before setting COS_BRIEF_LIVE: on the live path the email is sent BEFORE the ' +
          'writeback, so this same failure would arrive as a brief in your inbox that never appears in the app.',
      });
    } else {
      logger.event('cos.brief.writeback_only', {
        outcome: 'written',
        priorities: brief.top_priorities.length,
        cited_records: countRefs(brief),
        message: 'WRITEBACK-ONLY — a brief was written to CoS today_briefs and should now be visible ' +
          'in the Chief of Staff app. No email was sent, and the day\'s send slot is untouched.',
      });
    }
    return {
      ran: true, reason: 'writeback_only', sent: false,
      written: !wroteOnly.skipped, briefId: wroteOnly.id || null, brief,
    };
  }

  // ── delivery ──────────────────────────────────────────────────────────────
  let sent = false;
  let providerMessageId = null;
  let provider = null;
  let claimedKey = null;

  const transport = transportFactory(env);
  if (!transport) {
    logger.event('cos.send.skipped', {
      outcome: 'not_configured',
      message: `no email sent — delivery is not fully configured (missing: ${delivery.missing.join(', ')})`,
    });
  } else {
    // Claim BEFORE sending. The ledger's PK collision is the lock.
    const claimResult = await claim({ now });
    if (!claimResult.claimed) {
      return { ran: true, reason: claimResult.reason, sent: false, written: false, brief };
    }
    claimedKey = claimResult.key;

    const rendered = renderBriefEmail(brief, now);
    try {
      const out = await transport.send({ subject: rendered.subject, html: rendered.html, text: rendered.text });
      sent = true;
      provider = out.provider;
      providerMessageId = out.providerMessageId;
      await mark({ key: claimedKey, provider, providerMessageId, now });
      logger.event('cos.send.ok', { outcome: 'sent', message: `daily brief sent via ${provider}` });
    } catch (err) {
      // The transport throws BEFORE any network call when it is misconfigured
      // or gated off. In that case nothing was transmitted, so the claim is
      // released and tomorrow's — or this hour's — retry is unblocked. A
      // failure after transmission is NOT releasable and deliberately leaves
      // the row claimed.
      const preNetwork = /gated OFF|refused|not set/i.test((err && err.message) || '');
      logger.event('cos.send.failed', {
        level: 'error', error_category: 'upstream',
        outcome: preNetwork ? 'nothing_transmitted' : 'unknown_transmission',
        message: `send failed: ${(err && err.message) || String(err)}` +
          (preNetwork
            ? ' — nothing was transmitted; the day\'s claim is released for retry.'
            : ` — it is NOT known whether the message went out; the ledger row '${claimedKey}' stays claimed so no duplicate can follow.`),
      });
      if (preNetwork) await release({ key: claimedKey, now });
      return { ran: true, reason: 'send_failed', sent: false, written: false, brief };
    }
  }

  // ── writeback: the CoS app shows the same brief ───────────────────────────
  const written = await write({
    brief, minimizedInput: minimized, model: result.model || model,
    latencyMs, tokens: totalTokens(result.usage), env, now,
  });

  return {
    ran: true, reason: 'ok', sent, written: !written.skipped,
    briefId: written.id || null, providerMessageId, brief,
  };
}

// ── defaults (overridable for tests) ─────────────────────────────────────────

/**
 * The real model call. Parses the structured output here so the rest of the job
 * never touches a raw response — and so the raw response has no path to
 * storage. Only `parsed`, `model`, and `usage` escape this function.
 */
async function defaultCallModel(body) {
  const res = await openai.chat.completions.create(body);
  const content = (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || '';
  let parsed = null;
  try { parsed = JSON.parse(content); } catch { parsed = null; }
  return { parsed, model: res.model, usage: res.usage };
}

function totalTokens(u) {
  if (!u) return null;
  if (typeof u.total_tokens === 'number') return u.total_tokens;
  const p = Number(u.prompt_tokens) || 0;
  const c = Number(u.completion_tokens) || 0;
  return p + c || null;
}

/**
 * Record the spend so the budget guard can see it.
 *
 * v_daily_token_usage is built from this repo's `agent_runs` table, which
 * requires a Cedrus app_users id. That id lives in a DIFFERENT database from
 * COS_USER_ID (which is a CoS auth.users id), so it needs its own variable.
 *
 * Unset ⇒ the run is not recorded and the job SAYS SO on every run. That is a
 * real gap with a real consequence — this job's tokens would not count toward
 * DAILY_TOKEN_BUDGET — and an unannounced version of it is exactly the
 * "guard that cannot say it didn't run" shape (Lesson 7).
 */
async function defaultLogRun({ env, model, usage: u, latencyMs }) {
  const userId = (env.COS_BRIEF_USAGE_USER_ID || '').trim();
  if (!userId) {
    logger.event('cos.usage.unrecorded', {
      level: 'warn', outcome: 'not_recorded',
      message:
        'COS_BRIEF_USAGE_USER_ID is unset, so this brief\'s token spend was NOT written to agent_runs and ' +
        'does NOT count toward DAILY_TOKEN_BUDGET. Set it to the Cedrus app_users id to close the gap.',
    });
    return;
  }
  try {
    await usage.logAgentRun({
      userId, runType: 'cos_daily_brief', model,
      promptTokens: (u && u.prompt_tokens) || 0,
      completionTokens: (u && u.completion_tokens) || 0,
      latencyMs, success: true,
    });
  } catch (err) {
    logger.event('cos.usage.log_failed', {
      level: 'error', error_category: 'db_error',
      message: `could not record token spend: ${(err && err.message) || String(err)}`,
    });
  }
}

function countRefs(brief) {
  const ids = new Set();
  for (const p of brief.top_priorities || []) for (const r of p.source_refs || []) ids.add(`${r.type}:${r.id}`);
  return ids.size;
}

/** Exported for the scheduler's announcement line. */
export function cosBriefConfigured(env = process.env) {
  return cosEnv(env).armed;
}
