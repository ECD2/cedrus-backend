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

  // New user → welcome + ask their name (message 1 of onboarding)
  if (isNew) {
    await messages.logInbound({ userId: user.id, body, messageSid, numSegments });
    const reply = "Hey - I'm Cedrus. I help you remember and show up for the people you care about. Reply STOP anytime to opt out. To start, what's your first name?";
    await messages.logOutbound({ userId: user.id, body: reply, messageType: 'onboarding' });
    return reply;
  }

  // Fix C3: their SECOND message is the name → capture it, complete onboarding,
  // and from message three onward the AI pipeline handles everything.
  if (!user.onboarding_complete) {
    await messages.logInbound({ userId: user.id, body, messageSid, numSegments });
    const name = extractFirstName(body);
    await users.markOnboarded(user.id, name ? { name } : {});
    if (name) await people.renameSelf(user.id, name);
    const reply = `Great to meet you${name ? ', ' + name : ''}! Tell me about someone who matters to you - a birthday coming up, a gift idea, a life update. I'll remember it and bring it back when it counts.`;
    await messages.logOutbound({ userId: user.id, body: reply, messageType: 'onboarding' });
    return reply;
  }

  // STAGE B4 — log inbound (idempotent: a Twilio retry is a no-op)
  const { message, duplicate } = await messages.logInbound({ userId: user.id, body, messageSid, numSegments });
  if (duplicate) { logger.info('Duplicate webhook ignored', messageSid); return null; }

  // STAGE B3 — abuse cap (cost survival; runs before any model call)
  const { allowed } = await checkRateLimit(user.id);
  if (!allowed) {
    const reply = "You've reached today's limit - I'll be right here tomorrow.";
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
