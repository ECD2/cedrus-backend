import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import { checkRateLimit } from '../pipeline/04_rateLimit.js';
import { understand } from '../pipeline/05_understand.js';
import { resolveEntities } from '../pipeline/06_resolveEntities.js';
import { persist } from '../pipeline/07_persist.js';
import * as messages from './messages.js';
import * as usage from './usage.js';
import * as people from './people.js';

// ─────────────────────────────────────────────────────────────────────────
// WEB CAPTURE (N3) — "Tell Cedrus" from the web, in two steps.
//
// Same extraction pipeline as SMS, different commit point. SMS commits
// immediately (the reply IS the confirmation loop); the web shows the user
// what Cedrus understood and asks first. So:
//
//   propose  = context build → safety gate → model extraction → voice
//              guard (ALL the shared stages: messages.buildContext +
//              understand(), exactly what routes/sms.js runs) …and then
//              STOPS. The parsed result is parked in an IN-MEMORY store.
//              Nothing durable is written — no message row, no people, no
//              facts, no agent_runs. The model spend is still audited via
//              the structured log stream (the DB-independent audit sink,
//              per STRUCTURED_LOGGING_SPEC §8 / routes/admin.js).
//
//   confirm  = the FIRST durable write. Logs the inbound message with
//              channel='web' (a first-class message_channel enum value),
//              records the agent_runs cost row, then runs the same
//              resolveEntities() + persist() the SMS pipeline uses. Model
//              output stays subject to persist()'s enum whitelists — web
//              text is user content under full parser discipline, data
//              never instructions.
//
// The store is DELIBERATELY in-memory (Map), not a table: an unconfirmed
// proposal must leave no durable trace, and single-instance Railway makes
// process memory a correct v1 home. Consequences, documented in the
// contract: proposals die on deploy/restart (client re-proposes on 404),
// and they expire after PROPOSAL_TTL_MS. take() is check-and-delete in one
// synchronous step, so a double confirm — even two racing requests — can
// never commit twice.
//
// Crisis turns: understand()'s Priority-0 gate returns a fixed template
// with _suppressPersistence set. We create NO proposal for those — there is
// nothing to confirm, so crisis content can never reach storage through
// this path either (safety spec §7).
// ─────────────────────────────────────────────────────────────────────────

// Copy shown by the web client. Voice spec applies: warm, brief, no em
// dashes, no exclamation marks. MSG_QUOTA is byte-identical to the SMS
// rate-limit copy in pipeline/index.js (one product voice, two channels).
export const MSG_QUOTA = "You've reached today's limit - I'll be right here tomorrow.";
export const MSG_PROPOSAL_GONE = "That one timed out on my end. Send it again and I'll take another look.";
export const MSG_EMPTY_TEXT = 'Tell me a little more and I can save it.';

export const PROPOSAL_TTL_MS = 10 * 60 * 1000; // 10 minutes to hit Confirm
export const MAX_PENDING_PER_USER = 10;        // abuse valve on model spend
export const MAX_TEXT_CHARS = 2000;

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code, publicMessage: message });

// Single-use, per-user-scoped, TTL'd proposal store. Lazy sweep on every
// access (no background timer to leak in tests or fight shutdown).
export function createProposalStore({
  ttlMs = PROPOSAL_TTL_MS, maxPerUser = MAX_PENDING_PER_USER, now = Date.now,
} = {}) {
  const byId = new Map();
  const sweep = () => {
    for (const [id, p] of byId) if (p.expiresAt <= now()) byId.delete(id);
  };
  return {
    ttlMs,
    put(proposal) {
      sweep();
      // Cap unconfirmed proposals per user; evict oldest-first so a client
      // stuck in a propose loop can't hold the process's memory hostage.
      const mine = [...byId.values()]
        .filter((p) => p.userId === proposal.userId)
        .sort((a, b) => a.createdAt - b.createdAt);
      for (const old of mine.slice(0, Math.max(0, mine.length - maxPerUser + 1))) {
        byId.delete(old.id);
      }
      byId.set(proposal.id, proposal);
    },
    // Check-and-delete in one synchronous step: single-use by construction.
    // A wrong-owner id behaves exactly like an unknown id (returns null).
    take(id, userId) {
      sweep();
      const p = byId.get(id);
      if (!p || p.userId !== userId) return null;
      byId.delete(id);
      return p;
    },
    size() { sweep(); return byId.size; },
  };
}

const defaultStore = createProposalStore();

// Strip the pipeline's internal underscore fields (_usage, _model, _band…)
// before anything is echoed to a client.
const publicItems = (arr) => (Array.isArray(arr) ? arr : []).map((o) =>
  Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith('_'))));

// Cross-tenant backstop for MODEL-proposed ids (parser discipline: the model
// proposes, code disposes). resolveEntities() trusts `person_id` on an
// 'existing'/'self' resolution, and a hallucinated foreign uuid there would
// let extraction write rows pointing at another tenant's person (the exact
// hole flagged on 06_resolveEntities in docs/WSA_FLAGS_FOR_WSB.md — that
// file is out of N3's boundary, so the web path closes it HERE, before the
// proposal is stored or echoed). Any person_id the user doesn't own is
// dropped: existing/self downgrade to 'new' (the fuzzy-find backstop then
// matches or creates within the user's own space); ambiguous candidates are
// filtered to owned ids only.
async function scrubForeignPersonIds({ userId, parsed, listForUser }) {
  const owned = new Set((await listForUser(userId)).map((p) => p.id));
  for (const p of parsed.people || []) {
    if (p.person_id && !owned.has(p.person_id)) {
      logger.event('web.capture.scrubbed_person_id', {
        level: 'warn', error_category: 'validation', user_ref: 'u_' + userId,
        message: 'model proposed a person_id outside this user\'s people',
      });
      delete p.person_id;
      if (p.resolution === 'existing' || p.resolution === 'self') {
        p.resolution = 'new';
        if (!p.proposed_name) p.proposed_name = p.mention_text || null;
      }
    }
    if (Array.isArray(p.candidate_ids)) {
      p.candidate_ids = p.candidate_ids.filter((id) => owned.has(id));
    }
  }
}

// ── Step 1: propose. Runs the shared extraction stages, writes NOTHING. ──
export async function proposeCapture({ user, text }, deps = {}) {
  if (!user || !user.id) throw new Error('proposeCapture: user is required (ownership guard)');
  const d = {
    checkRateLimit, buildContext: messages.buildContext, understand,
    listForUser: people.listForUser, store: defaultStore, client: undefined, ...deps,
  };

  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) throw httpError(422, 'invalid_request', MSG_EMPTY_TEXT);
  if (body.length > MAX_TEXT_CHARS) {
    throw httpError(422, 'invalid_request',
      `That's a lot at once. Keep it under ${MAX_TEXT_CHARS} characters and I'll get every bit.`);
  }

  // Same abuse cap as SMS Stage B3 (reads v_message_quota; a propose is a
  // model call, so it must sit behind the same daily ceiling).
  const { allowed } = await d.checkRateLimit(user.id);
  if (!allowed) throw httpError(429, 'quota_exceeded', MSG_QUOTA);

  // Shared stages: the exact context builder + understand() call SMS uses.
  const context = await d.buildContext(user);
  const t0 = Date.now();
  const parsed = await d.understand({
    user, body, context, ...(d.client ? { client: d.client } : {}),
  });

  // Crisis/boundary: fixed template out, nothing extracted, nothing to
  // confirm. Content-free log (category only — never the user's words).
  if (parsed._suppressPersistence) {
    logger.event('web.capture.safety', {
      user_ref: 'u_' + user.id, outcome: 'safety_shortcircuit',
      meta: { flags: parsed.flags || null },
    });
    return { safety: true, reply: parsed.reply, proposal: null };
  }

  // Model-proposed person ids are validated against ownership BEFORE the
  // proposal is stored or echoed — see scrubForeignPersonIds above.
  await scrubForeignPersonIds({ userId: user.id, parsed, listForUser: d.listForUser });

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const proposal = { id, userId: user.id, body, parsed, createdAt, expiresAt: createdAt + d.store.ttlMs };
  d.store.put(proposal);

  // Model spend is committed even if the user never confirms — audit it NOW
  // in the structured log stream (durable, DB-independent). The agent_runs
  // DB row waits for confirm, when a message row exists to anchor it.
  logger.event('web.capture.proposed', {
    user_ref: 'u_' + user.id, latency_ms: Date.now() - t0, body_len: body.length,
    meta: {
      model: parsed._model || null,
      prompt_tokens: (parsed._usage && parsed._usage.prompt_tokens) || 0,
      completion_tokens: (parsed._usage && parsed._usage.completion_tokens) || 0,
      people: (parsed.people || []).length, facts: (parsed.facts || []).length,
    },
  });

  return {
    safety: false,
    reply: parsed.reply || 'Got it.',
    proposal: {
      id,
      expires_at: new Date(proposal.expiresAt).toISOString(),
      people: publicItems(parsed.people),
      facts: publicItems(parsed.facts),
      saved_items: publicItems(parsed.saved_items),
      reminders: publicItems(parsed.reminders),
      goals: publicItems(parsed.goals),
    },
  };
}

// ── Step 2: confirm. The first durable write. ────────────────────────────
export async function confirmCapture({ user, proposalId }, deps = {}) {
  if (!user || !user.id) throw new Error('confirmCapture: user is required (ownership guard)');
  const d = {
    store: defaultStore, db: supabase, resolveEntities, persist,
    logAgentRun: usage.logAgentRun, ...deps,
  };

  if (!proposalId || typeof proposalId !== 'string') {
    throw httpError(422, 'invalid_request', MSG_PROPOSAL_GONE);
  }

  // Owner-scoped single-use take: unknown, expired, foreign, and already-
  // confirmed ids are all the same 404 (existence is never revealed).
  const p = d.store.take(proposalId, user.id);
  if (!p) throw httpError(404, 'not_found', MSG_PROPOSAL_GONE);

  // Durable write #1: the inbound message row, as a web-channel message.
  // provider_message_id carries the proposal id so the capture is traceable
  // end-to-end (propose log line ↔ message row ↔ agent_runs row).
  const { data: message, error } = await d.db.from('messages').insert({
    user_id: user.id, direction: 'inbound', channel: 'web', body: p.body,
    provider: 'web', provider_message_id: p.id,
    received_at: new Date().toISOString(),
  }).select('*').single();
  if (error) throw error;

  // Durable write #2: the cost-audit row, anchored to the message.
  await d.logAgentRun({
    userId: user.id, runType: 'web_capture', triggerMessageId: message.id,
    model: p.parsed._model || 'unknown',
    promptTokens: p.parsed._usage && p.parsed._usage.prompt_tokens,
    completionTokens: p.parsed._usage && p.parsed._usage.completion_tokens,
    success: true,
  });

  // Durable writes #3…n: the same Stage D the SMS pipeline runs. persist()
  // re-validates every enum in code — the parked proposal gets no more
  // trust at commit time than a fresh SMS extraction does.
  const resolved = await d.resolveEntities({ user, parsed: p.parsed });
  await d.persist({ user, message, parsed: p.parsed, resolved });

  logger.event('web.capture.confirmed', {
    user_ref: 'u_' + user.id, outcome: 'accepted',
    meta: {
      message_id: message.id,
      people: (p.parsed.people || []).length, facts: (p.parsed.facts || []).length,
    },
  });

  return { confirmed: true, message_id: message.id };
}
