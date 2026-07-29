import { logger } from '../utils/logger.js';
import * as users from '../services/users.js';
import * as messages from '../services/messages.js';
import * as people from '../services/people.js';
import * as usage from '../services/usage.js';
import { handleCompliance } from './03_compliance.js';
import { checkRateLimit } from './04_rateLimit.js';
import { understand } from './05_understand.js';
import { resolveEntities } from './06_resolveEntities.js';
import { persist } from './07_persist.js';
import * as clarifications from '../services/clarifications.js';
import { isInSuppressionWindow } from '../services/safetyFlags.js';
import { evaluateSafety } from '../services/safetyDetection.js';
import { extractSelfName, bareName } from './selfName.js';
import { getBudgetGate } from '../services/budget.js';
import * as cards from '../services/cards.js';

// ═══════════════ ONBOARDING COPY — EDIT FREELY, NO CODE BELOW CHANGES ═══════════════
// MSG_COMPLIANCE is byte-identical to the Opt-In Confirmation Response approved in
// Twilio toll-free verification. Do not edit this without re-submitting to Twilio.
const MSG_COMPLIANCE =
  "Hey, I'm Cedrus. I help you remember the people you care about: birthdays, life updates, gift ideas, and the moments worth following up on. By continuing, you agree to receive recurring SMS messages from Cedrus Life. No spam, ever. Reply STOP to opt out anytime, HELP for info. Msg & data rates may apply. Ready to start... who's someone important in your life?";
const MSG_RATE_LIMIT = "You've reached today's limit - I'll be right here tomorrow.";
const MSG_BUDGET_PAUSE = "I'm taking a short breather right now, so I couldn't save that one. Send it again in a few hours and I'll take care of it.";
// ════════════════════════════════════════════════════════════════════════════════════

// Runs Stages B–E. Stage A (Twilio signature) is enforced in the route.
export async function runInboundPipeline({ from, body, messageSid, numSegments }) {
  // STAGE B1 — identify (find or create user; DB trigger makes their self-person)
  const { user, isNew } = await users.findOrCreateByPhone(from);
  await users.touchActive(user.id);
  logger.addContext({ user_ref: 'u_' + user.id });

  // Decide fresh-start BEFORE logging this inbound — hasNoHistory() counts the
  // messages table, and the log call below would otherwise make history=1 and
  // hide a real admin-reset user's fresh start.
  const needsFreshStart = isNew || (!user.onboarding_complete && await messages.hasNoHistory(user.id));

  // STAGE B4 — log inbound ONCE, up front, and honor the duplicate flag across
  // EVERY downstream path. A replayed Twilio webhook (same MessageSid) is now a
  // no-op for compliance, onboarding AND normal messages — so a replayed signed
  // STOP or a replayed first message can never reprocess (the fix the WS-A brief
  // calls out: compliance/onboarding paths used to ignore this flag).
  const { message, duplicate } = await messages.logInbound({ userId: user.id, body, messageSid, numSegments });
  if (duplicate) { logger.event('sms.inbound.duplicate', { level: 'warn', trace_stage: 'finalize', provider_message_id: messageSid, error_category: 'idempotent_skip', outcome: 'duplicate' }); return null; }

  // STAGE B2 — compliance (STOP/START/HELP short-circuit everything)
  const compliance = await handleCompliance({ user, body });
  if (compliance.handled) {
    if (compliance.reply) await messages.logOutbound({ userId: user.id, body: compliance.reply, messageType: 'system' });
    return compliance.reply; // STOP → null reply; carrier sends its own confirmation
  }

  // ── STAGE B2.5 — Priority 0 pre-check ──────────────────────────────────────
  // Pure, ~6µs, no model call and no I/O: evaluateSafety() is a regex pass over
  // the raw body (safetyDetection.js has zero imports). It decides ONE thing —
  // whether the cost/onboarding short-circuits below are allowed to fire.
  //
  // It deliberately does NOT build a reply. The crisis response is authored in
  // exactly one place, understand()'s Priority 0 gate, which re-runs this same
  // pure function on the same body and short-circuits to the fixed, versioned
  // template. Two copies of that response would be two things to keep in sync.
  //
  // Why this exists: the short-circuits below return BEFORE STAGE C, so without
  // this a crisis message could never reach crisis detection at all. A first-ever
  // message got the opt-in boilerplate; a capped user got "you've reached today's
  // limit" — for up to 24 hours. Both are now exempt.
  //
  // Scope is 'crisis' only, NOT isSafetyOverride() (which also covers the
  // substance-guidance 'boundary'). A boundary reply is a refusal, not a
  // life-safety resource, so it stays subject to the cap and keeps the bypass
  // surface as small as it can be.
  //
  // This cannot be used to get free model calls: the same predicate that skips
  // the cap guarantees understand() short-circuits before the OpenAI call. The
  // most it can buy is a fixed template. Compliance (STOP) still outranks it —
  // that gate is above this line and stays there.
  const crisisOverride = evaluateSafety(body).action === 'crisis';

  // New user OR an admin-reset user (same account row, zero history) → the
  // EXACT Twilio-approved opt-in text, verbatim, first and alone. It already
  // ends by asking "who's someone important in your life?", so we don't ask
  // a separate onboarding question on top of it.
  if (needsFreshStart && !crisisOverride) {
    await messages.logOutbound({ userId: user.id, body: MSG_COMPLIANCE, messageType: 'onboarding' });
    return MSG_COMPLIANCE;
  }

  // Their FIRST reply after the approved script answers "who's someone
  // important in your life?" - that's real content, not smalltalk. Capture a
  // name if they happen to give one, mark onboarding complete, then let it
  // fall straight into the normal AI pipeline below so their answer actually
  // gets saved instead of being thrown away on a generic "nice to meet you."
  // The one exception: if all they sent was a bare name ("Emil"), there's
  // nothing yet for the AI to extract - ask the follow-up instead of wasting
  // a model call on an empty message.
  if (!user.onboarding_complete) {
    // The prompt above asked "who's someone important in your life?", so this
    // reply is about SOMEONE ELSE. Only capture the user's OWN name when the
    // reply is an explicit self-introduction ("I'm Emil", "my name is Emil");
    // otherwise leave the self-name blank rather than grabbing a stray leading
    // token like "My" (from "My wife Sarah") or "Grabbed" (from "Grabbed drinks
    // with Dave"). selfName drives the DB write; loneName only decides whether
    // there's anything for the model to extract yet.
    const selfName = extractSelfName(body);
    const loneName = bareName(body);

    await users.markOnboarded(user.id, selfName ? { name: selfName } : {});
    if (selfName) await people.renameSelf(user.id, selfName);

    // A reply that is essentially just a name has nothing for the model to
    // extract yet - ask the onboarding follow-up instead of spending a model
    // call. Greet them by name only when they actually gave their OWN name; a
    // bare name (probably the important person, not the user) gets a neutral ack.
    if (loneName) {
      const reply = selfName
        ? `Good to meet you, ${selfName}. So - tell me about someone important in your life. A birthday, something they're into, anything worth remembering.`
        : `Got it. Tell me a bit more - a birthday, something they're into, or anything else worth remembering.`;
      await messages.logOutbound({ userId: user.id, body: reply, messageType: 'onboarding' });
      return reply;
    }
    // else: fall through into the real pipeline below - their message has
    // actual content the model should extract right now.
  }

  // ── STAGE B2.6 — opportunity-card replies (V1 card rail, item 2) ───────────
  // AFTER safety (gated on !crisisOverride: a crisis message must reach the 988
  // path and must not mutate card state), after compliance and onboarding,
  // BEFORE the cap and the budget switch. Rationale: replying to a question
  // Cedrus itself asked is the loop's hinge (spec PART 2 step 4), it costs no
  // model call, and it is bounded — a user only ever has a handful of cards
  // awaiting a reply, and once answered, a repeat no longer matches. Exact
  // vocabulary tokens only (YES/SKIP/LATER/NOT THEM/NEVER, and YES/NO/NOT YET
  // for follow-ups); anything else falls through to the ordinary pipeline, and
  // so does every card-rail read failure (fail open — a broken card rail must
  // never block a real message).
  if (!crisisOverride) {
    const cardReply = await cards.handleCardReply({ user, body, sourceMessageId: message.id });
    if (cardReply.handled) {
      if (cardReply.reply) await messages.logOutbound({ userId: user.id, body: cardReply.reply, messageType: 'card_reply' });
      return cardReply.reply;
    }
  }

  // STAGE B3 — abuse cap (cost survival; runs before any model call).
  // Exempt for a crisis message (STAGE B2.5): the cap must never be the reason
  // someone in crisis gets boilerplate instead of 988. The exemption is safe
  // because a crisis message short-circuits inside understand() before the
  // model call, so it can only ever cost one fixed-template SMS.
  const { allowed } = await checkRateLimit(user.id);
  if (!allowed && !crisisOverride) {
    const reply = MSG_RATE_LIMIT;
    await messages.logOutbound({ userId: user.id, body: reply, messageType: 'system' });
    return reply;
  }

  // ── STAGE B3.5 — global budget kill switch (spend survival, item 1) ────────
  // The hourly guard (jobs/budgetGuard.js) sets one system_flags row when the
  // day's global token/SMS spend crosses DAILY_TOKEN_BUDGET / DAILY_SMS_BUDGET;
  // this is the inbound read of it. Placement is deliberate:
  //   • AFTER STAGE B2.5's crisis pre-check and gated on !crisisOverride — a
  //     crisis message keeps the 988 path even over budget, and (same argument
  //     as the cap exemption) it can only ever buy one fixed-template SMS,
  //     because the same predicate short-circuits understand() pre-model.
  //   • AFTER compliance and the Twilio-approved onboarding script — both are
  //     legal/consent obligations and fixed templates.
  //   • AFTER STAGE B3, so paused-mode replies stay bounded by the per-user
  //     cap: without that, "back shortly" itself would be uncapped Twilio
  //     spend under an inbound flood — the exact thing being guarded.
  //   • Immediately BEFORE STAGE C: the model call is the spend this protects.
  // getBudgetGate() fails OPEN (missing table/row, query error, throw ⇒ not
  // paused) and announces abnormal reads via quota.read.failed.
  const budgetGate = await getBudgetGate();
  if (budgetGate.paused && !crisisOverride) {
    await messages.logOutbound({ userId: user.id, body: MSG_BUDGET_PAUSE, messageType: 'system' });
    return MSG_BUDGET_PAUSE;
  }

  // STAGE C — understand (the one OpenAI call: extraction + drafted reply)
  const context = await messages.buildContext(user);
  const t0 = Date.now();
  let parsed;
  try {
    parsed = await understand({ user, body, context });
  } catch (err) {
    logger.error('Understand step failed', err);
    await usage.logAgentRun({ userId: user.id, runType: 'inbound_parse', triggerMessageId: message.id, model: 'unknown', success: false, errorMessage: String(err), latencyMs: Date.now() - t0 });
    const reply = "Hmm, I had trouble with that. Mind saying it another way?";
    await messages.logOutbound({ userId: user.id, body: reply, messageType: 'reply' });
    return reply;
  }
  await usage.logAgentRun({
    userId: user.id, runType: 'inbound_parse', triggerMessageId: message.id,
    model: parsed._model, promptTokens: parsed._usage?.prompt_tokens,
    completionTokens: parsed._usage?.completion_tokens, latencyMs: Date.now() - t0, success: true,
  });

  // STAGE D+E — clarification-aware resolve / persist / reply (Phase 2a,
  // docs/ENTITY_RESOLUTION_V2.md §2). dispatch() interprets a reply to an active
  // clarification, resolves THIS message's entities (Phase-1 bands + create/merge),
  // HOLDS a near-match / bare-name / model-ambiguous mention behind ONE
  // candidate-listing question, applies the held write on the answer, and composes
  // the reply. A crisis turn (parsed._suppressPersistence) bypasses all pending
  // state inside dispatch (never consumes or resolves a clarification); the safety
  // suppression window gates any user-facing ask/re-ask (§2.3, decisions 5 & 6).
  const inSuppression = parsed._suppressPersistence
    ? false
    : await isInSuppressionWindow(user.id).catch(() => false);
  const { reply } = await clarifications.dispatch({
    user, message, parsed, body, inSuppression,
    deps: { resolveEntities, persist },
  });
  await messages.logOutbound({ userId: user.id, body: reply, messageType: 'reply' });
  return reply;
}
