import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openai } from '../lib/openai.js';
import { config } from '../config.js';
import { localNow } from '../utils/time.js';
import { evaluateSafety, evaluateModelCrisis, isSafetyOverride } from '../services/safetyDetection.js';
import { recordCrisisSignal, openSuppressionWindow } from '../services/safetyFlags.js';
import { resolveBand, applyVoiceGuard } from '../services/voiceGuard.js';
import { performWebSearch } from '../services/search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Loaded once at boot. Kept byte-stable so OpenAI prompt caching applies.
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../../prompts/extraction.system.txt'), 'utf8');

// Caps the MODEL-generated reply only (~2 GSM segments) so a hostile or rambling
// generation can't cost extra SMS. The fixed crisis/boundary templates never pass
// through this cap — they short-circuit earlier — and are deliberately allowed to
// run longer than one or two segments: a complete, usable resource (the number,
// the local-emergency fallback, "stay with them / don't leave them") matters more
// than segment count, and truncating a crisis resource is exactly the failure the
// fixed-template design exists to prevent.
const REPLY_CHAR_CAP = 320;

// ─────────────────────────────────────────────────────────────────────────────
// understand() — the one OpenAI call (extraction + drafted reply), now fronted by
// a deterministic Priority 0 safety gate and backed by a Priority 1 voice guard.
//
// Order is load-bearing and matches the specs:
//   1. Priority 0 safety detection (code, no model) runs FIRST. If it fires, we
//      short-circuit: a fixed, versioned template is the reply, NO model call is
//      made for it, nothing is extracted or persisted. The override is structural
//      — it cannot be talked out of by the message (spec §10).
//   2. Priority 3 web search runs only when the message needs current info.
//   3. The model produces extraction + a band-aware draft reply.
//   4. Priority 1 voice guard enforces the banned-cheerfulness / no-upsell /
//      correction-path-valence rules in code, so they don't depend on the model.
// ─────────────────────────────────────────────────────────────────────────────
export async function understand({ user, body, context, client = openai }) {
  // ── Priority 0 — safety gate (runs before any model call) ──────────────────
  const safety = evaluateSafety(body);
  if (isSafetyOverride(safety)) {
    // Record the event content-free (§7) and open the promo cooldown (§6) for
    // real crisis categories. Both are best-effort and never block the reply.
    recordCrisisSignal({
      userId: user.id, category: safety.category, boundary: safety.boundary,
      templateVersion: safety.templateVersion,
    });
    if (safety.suppressionWindow) {
      // Fire-and-forget; the fixed reply must not wait on a DB write.
      openSuppressionWindow({ userId: user.id, category: safety.category }).catch(() => {});
    }
    return buildSafetyShortCircuit(safety);
  }

  // ── Priority 3 — web search (only when genuinely needed; never on crisis) ──
  let searchBlock = null;
  try {
    const search = await performWebSearch({ client, body, model: config.openaiModel });
    if (search.used) searchBlock = search.block;
  } catch {
    searchBlock = null; // search never blocks the reply
  }

  // ── The model call (stable system prefix → cached; message LAST) ───────────
  const res = await client.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildContextBlock({ user, body, context, searchBlock }) },
    ],
  });
  const parsed = JSON.parse(res.choices[0].message.content);

  // ── Priority 1 — voice guard (structural backstop, not a prompt hope) ──────
  const band = resolveBand({
    modelBand: parsed.valence && parsed.valence.band,
    body,
    facts: parsed.facts,
  });

  // ── Priority 0 — SECOND NET (spec §1, high recall) ─────────────────────────
  // The deterministic gate at the top of understand() can miss an implicit
  // signal; the model's own valence classifier is a second detector for exactly
  // those. If the resolved band is 'crisis', we DISCARD the model's freeform
  // draft AND every extracted person/fact, and respond with the SAME fixed,
  // reviewed template the deterministic gate uses. Detection recall improves; the
  // response text is never model-authored (spec §10). Persistence is suppressed
  // just like the deterministic path — nothing from a crisis turn reaches storage
  // or briefs (spec §7).
  if (band === 'crisis') {
    const modelCrisis = evaluateModelCrisis({
      band,
      crisisType: parsed.valence && parsed.valence.crisis_type,
    });
    modelCrisis.disorderedEating = safety.disorderedEating;
    recordCrisisSignal({
      userId: user.id, category: modelCrisis.category, boundary: null,
      templateVersion: modelCrisis.templateVersion, source: modelCrisis.source,
    });
    if (modelCrisis.suppressionWindow) {
      openSuppressionWindow({ userId: user.id, category: modelCrisis.category }).catch(() => {});
    }
    return buildSafetyShortCircuit(modelCrisis);
  }

  const guarded = applyVoiceGuard({
    reply: parsed.reply,
    band,
    disorderedEating: safety.disorderedEating,
  });
  parsed.reply = guarded.reply;
  parsed._band = band;
  parsed._disorderedEating = safety.disorderedEating;

  // Fix H2 + safety: cap the outbound reply so a hostile or rambling generation
  // can't cost extra SMS segments. Applied AFTER the guard so we cap the final text.
  if (typeof parsed.reply === 'string' && parsed.reply.length > REPLY_CHAR_CAP) {
    parsed.reply = parsed.reply.slice(0, REPLY_CHAR_CAP - 3).trimEnd() + '...';
  }
  parsed._usage = res.usage;
  parsed._model = res.model;
  return parsed;
}

// A safety override produces a parsed-shaped object with EMPTY extraction arrays
// (nothing from a crisis message flows into ordinary storage/briefs — spec §7)
// and the fixed template as the reply. _suppressPersistence is defensive: even if
// arrays were somehow non-empty, 06/07 skip all writes.
//
// DOCUMENTED CONSERVATIVE DEVIATION from spec §2.8: §2.8 permits Cedrus to ALSO
// answer an ordinary request bundled in the same message ("...also, what time is
// dinner with Jake?") briefly, after the safety content. We deliberately do NOT
// do that here: the reply is the fixed template and nothing else. Appending a
// model-generated answer to a crisis turn would reintroduce exactly the
// injection / off-distribution / unreviewed-sentence risk that the fixed-template
// design (spec §10) exists to eliminate — the co-occurring question is drafted by
// the same model call we just chose to discard. The safer, reviewed floor wins;
// the user can re-send the ordinary ask on the next turn. Revisit only if §2.8 is
// re-scoped to allow a SECOND, separately-reviewed constant for the ordinary part.
function buildSafetyShortCircuit(safety) {
  return {
    intent: safety.action === 'crisis' ? 'crisis' : 'off_mission',
    people: [], facts: [], saved_items: [], reminders: [], goals: [],
    prompt_answer: null,
    reply: safety.reply,
    flags: `safety:${safety.category || safety.boundary}`,
    valence: { band: 'crisis', triggers: [] },
    _crisis: {
      category: safety.category, boundary: safety.boundary,
      suppressionWindow: safety.suppressionWindow, templateVersion: safety.templateVersion,
      source: safety.source || 'deterministic',
    },
    _band: 'crisis',
    _disorderedEating: safety.disorderedEating,
    _suppressPersistence: true,
    _model: 'safety-shortcircuit',
    _usage: null,
  };
}

function buildContextBlock({ user, body, context, searchBlock }) {
  const parts = [
    `CURRENT DATETIME: ${localNow(user.timezone)}   (timezone: ${user.timezone})`,
    `USER: ${user.name || 'there'}   (first-person "I/me" refers to this person)`,
    '',
    'KNOWN PEOPLE:',
    JSON.stringify(context.people || []),
    '',
    'OPEN QUESTIONS AWAITING AN ANSWER:',
    JSON.stringify(context.openPrompts || []),
    '',
    'RECENT MESSAGES (oldest to newest):',
    (context.recentMessages || []).map(m => `${m.direction}: ${m.body}`).join('\n'),
  ];
  if (searchBlock) {
    parts.push('', searchBlock);
  }
  parts.push('', 'INCOMING MESSAGE:', `"${body}"`);
  return parts.join('\n');
}
