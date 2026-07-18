// Priority 1 — Voice & emotional-intelligence structural backstop tests.
// Run: bun test/voice.test.mjs
// Covers CEDRUS_VOICE_AND_EMOTIONAL_INTELLIGENCE_SPEC.md's enforceable rules:
// band resolution + the "girlfriend → ex" correction-path wiring (§8), the
// banned-cheerfulness rule (§3.2), the no-upsell-after-sensitive rule (§4), and
// the disordered-eating diet-guidance suppression (§5).

import { resolveBand, applyVoiceGuard, BANDS } from '../src/services/voiceGuard.js';

let failures = 0;
const p = (...a) => console.log(...a);
function check(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

const relFact = (value, supersedes = true) => ({
  fact_key: 'relationship', fact_value: value, supersedes_prior: supersedes,
});

p('\n── §8 correction-path wiring: girlfriend → ex forces caution ──');
{
  // The exact original failure: model MISCLASSIFIES the correction as routine.
  const band = resolveBand({ modelBand: 'routine', body: "actually Sarah's my ex now", facts: [relFact('ex-girlfriend')] });
  check('ended-relationship correction escalates off routine', band === 'sensitive_neutral' || band === 'negative', band);

  const guarded = applyVoiceGuard({ reply: 'Okay great! Updated Sarah to ex-girlfriend 👍', band });
  check('no cheerful "great" survives', !/great/i.test(guarded.reply), guarded.reply);
  check('no exclamation survives', !/!/.test(guarded.reply), guarded.reply);
}

p('── The other relationship-key alias also wires (relationship_status) ──');
{
  const band = resolveBand({
    modelBand: 'routine', body: 'she is my ex now',
    facts: [{ fact_key: 'relationship_status', fact_value: 'ex', supersedes_prior: true }],
  });
  check('alias key still escalates', band !== 'routine', band);
}

p('── §3.2 banned cheerfulness stripped for sensitive_neutral / negative ──');
for (const band of ['sensitive_neutral', 'negative']) {
  const g = applyVoiceGuard({ reply: 'Awesome, nice! Updated that for you.', band });
  check(`${band}: cheer words removed`, !/awesome|nice|yay|great/i.test(g.reply), g.reply);
  check(`${band}: no "!" left`, !/!/.test(g.reply), g.reply);
  check(`${band}: still says something`, g.reply.length > 3, g.reply);
}

p('── Positive band KEEPS its earned enthusiasm (§5, Case 4) ──');
{
  const g = applyVoiceGuard({ reply: "That's wonderful, congratulations! I've saved the date.", band: 'positive' });
  check('positive keeps "wonderful"', /wonderful/i.test(g.reply), g.reply);
  check('positive keeps "!"', /!/.test(g.reply), g.reply);
}

p('── Routine band is left alone ──');
{
  const original = 'Got it, March 4 for John’s birthday 🌲';
  const g = applyVoiceGuard({ reply: original, band: 'routine' });
  check('routine untouched', g.reply === original, g.reply);
}

p('── §4 no upsell attached to a non-Routine, non-Positive reply ──');
for (const band of ['sensitive_neutral', 'negative']) {
  const g = applyVoiceGuard({
    reply: "I hear you. I've paused Ana's reminders. Upgrade to Pro for unlimited at cedrus.life/upgrade.",
    band,
  });
  check(`${band}: upsell sentence dropped`, !/upgrade|cedrus\.life\/upgrade|pro\b/i.test(g.reply), g.reply);
  check(`${band}: the empathetic content stays`, /paused/i.test(g.reply), g.reply);
}
{
  // ...but an upsell on a routine reply is fine (not this rule's job).
  const g = applyVoiceGuard({ reply: "Saved. Adding new pieces is a Pro thing, cedrus.life/upgrade", band: 'routine' });
  check('routine upsell left intact', /upgrade/i.test(g.reply), g.reply);
}

p('── §2 loss language forces Negative regardless of model band ──');
{
  const band = resolveBand({ modelBand: 'routine', body: 'my grandmother passed away last week', facts: [] });
  check('passed away -> negative', band === 'negative', band);
}

p('── §2 caution tie-break: unknown model band defaults to sensitive_neutral ──');
{
  const band = resolveBand({ modelBand: 'nonsense', body: 'things are different with my mom', facts: [] });
  check('unknown band -> at least sensitive_neutral', BANDS.indexOf(band) >= BANDS.indexOf('sensitive_neutral'), band);
}

p('── §5 disordered-eating suppresses specific diet/weight numbers ──');
{
  const g = applyVoiceGuard({
    reply: "Noted. To lose weight, aim for 1200 calories a day and 30 minutes of cardio.",
    band: 'sensitive_neutral', disorderedEating: true,
  });
  check('numeric diet guidance dropped', !/1200|calories|30 minutes of cardio/i.test(g.reply), g.reply);
}

p('── Model can only be escalated toward caution, never de-escalated ──');
{
  // Model says negative; nothing should pull it back down to positive/routine.
  const band = resolveBand({ modelBand: 'negative', body: 'we broke up', facts: [relFact('ex')] });
  check('negative stays negative', band === 'negative', band);
}

p('');
p(failures === 0 ? 'ALL VOICE TESTS PASSED' : failures + ' VOICE TEST(S) FAILED');
if (failures > 0) process.exit(1);
