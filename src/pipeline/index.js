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

// ═══════════════ ONBOARDING COPY — EDIT FREELY, NO CODE BELOW CHANGES ═══════════════
// MSG_COMPLIANCE is byte-identical to the Opt-In Confirmation Response approved in
// Twilio toll-free verification. Do not edit this without re-submitting to Twilio.
const MSG_COMPLIANCE =
  "Hey, I'm Cedrus. I help you remember the people you care about: birthdays, life updates, gift ideas, and the moments worth following up on. By continuing, you agree to receive recurring SMS messages from Cedrus Life. No spam, ever. Reply STOP to opt out anytime, HELP for info. Msg & data rates may apply. Ready to start... who's someone important in your life?";
const MSG_RATE_LIMIT = "You've reached today's limit - I'll be right here tomorrow.";
// ════════════════════════════════════════════════════════════════════════════════════

// Runs Stages B–E. Stage A (Twilio signature) is enforced in the route.
export async function runInboundPipeline({ from, body, messageSid, numSegments }) {
  // STAGE B1 — identify (find or create user; DB trigger makes their self-person)
  const { user, isNew } = await users.findOrCreateByPhone(from);
  await users.touchActive(user.id);

  // STAGE B2 — compliance (STOP/START/HELP short-circuit everything)
  const compliance = await handleCompliance({ user, body });
  if (compliance.handled) {
    await messages.logInbound({ userId: user.id, body, messageSid, numSegments });
    if (compliance.reply) await messages.logOutbound({ userId: user.id, body: compliance.reply, messageType: 'system' });
    return compliance.reply; // STOP → null reply; carrier sends its own confirmation
  }

  // New user OR an admin-reset user (same account row, zero history) → the
  // EXACT Twilio-approved opt-in text, verbatim, first and alone. It already
  // ends by asking "who's someone important in your life?", so we don't ask
  // a separate onboarding question on top of it.
  const needsFreshStart = isNew || (!user.onboarding_complete && await messages.hasNoHistory(user.id));
  if (needsFreshStart) {
    await messages.logInbound({ userId: user.id, body, messageSid, numSegments });
    await messages.logOutbound({ userId: user.id, body: MSG_COMPLIANCE, messageType: 'onboarding' });
    return MSG_COMPLIANCE;
  }

  // STAGE B4 — log inbound (idempotent: a Twilio retry is a no-op). Moved above
  // the onboarding-completion check so both paths share one log call.
  const { message, duplicate } = await messages.logInbound({ userId: user.id, body, messageSid, numSegments });
  if (duplicate) { logger.info('Duplicate webhook ignored', messageSid); return null; }

  // Their FIRST reply after the approved script answers "who's someone
  // important in your life?" - that's real content, not smalltalk. Capture a
  // name if they happen to give one, mark onboarding complete, then let it
  // fall straight into the normal AI pipeline below so their answer actually
  // gets saved instead of being thrown away on a generic "nice to meet you."
  // The one exception: if all they sent was a bare name ("Emil"), there's
  // nothing yet for the AI to extract - ask the follow-up instead of wasting
  // a model call on an empty message.
  if (!user.onboarding_complete) {
    const name = extractFirstName(body);
    const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
    const justAName = !!name && wordCount <= 2;

    await users.markOnboarded(user.id, name ? { name } : {});
    if (name) await people.renameSelf(user.id, name);

    if (justAName) {
      const reply = `Good to meet you, ${name}. So - tell me about someone important in your life. A birthday, something they're into, anything worth remembering.`;
      await messages.logOutbound({ userId: user.id, body: reply, messageType: 'onboarding' });
      return reply;
    }
    // else: fall through into the real pipeline below - their message has
    // actual content the model should extract right now.
  }

  // STAGE B3 — abuse cap (cost survival; runs before any model call)
  const { allowed } = await checkRateLimit(user.id);
  if (!allowed) {
    const reply = MSG_RATE_LIMIT;
    await messages.logOutbound({ userId: user.id, body: reply, messageType: 'system' });
    return reply;
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
    const reply = "Hmm, I had trouble with that — mind saying it another way?";
    await messages.logOutbound({ userId: user.id, body: reply, messageType: 'reply' });
    return reply;
  }
  await usage.logAgentRun({
    userId: user.id, runType: 'inbound_parse', triggerMessageId: message.id,
    model: parsed._model, promptTokens: parsed._usage?.prompt_tokens,
    completionTokens: parsed._usage?.completion_tokens, latencyMs: Date.now() - t0, success: true,
  });

  // STAGE D — resolve entities (fuzzy backstop + create/merge) and write everything
  const resolved = await resolveEntities({ user, parsed });
  await persist({ user, message, parsed, resolved });

  // STAGE E — reply
  const reply = parsed.reply || 'Got it.';
  await messages.logOutbound({ userId: user.id, body: reply, messageType: 'reply' });
  return reply;
}

// Pull a plausible first name out of "Emil", "I'm Emil", "hey, my name is emil", etc.
function extractFirstName(body) {
  const cleaned = String(body || '').trim()
    .replace(/^(hi|hey|hello|yo|sup)[,!. ]*/i, '')
    .replace(/^(i am|i'm|im|it's|its|my name is|my name's|this is|name's|call me)\s+/i, '');
  const m = /^([A-Za-z][A-Za-z'-]{1,20})/.exec(cleaned);
  if (!m) return null;
  const n = m[1];
  return n.charAt(0).toUpperCase() + n.slice(1);
}
