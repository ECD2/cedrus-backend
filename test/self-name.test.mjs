// Onboarding self-name capture suite (Station 3 — fix/onboarding-self-name).
// Run standalone: node test/self-name.test.mjs   (also runs under bun)
//
// Guards the fix for the bug where the user's own person record was saved with a
// garbage name ("My", "Grabbed", …). The onboarding prompt asks "who's someone
// important in your life?", so the first reply is about SOMEONE ELSE; the old
// code grabbed its leading token as the user's own name. These tests pin down:
//   • extractSelfName captures a name ONLY from an explicit self-introduction,
//     and NEVER a possessive / verb / pronoun / bare other-person name.
//   • bareName (the "just a name, skip the model call" signal) is decoupled from
//     the self-name write, so a lone "Sarah" short-circuits WITHOUT being saved
//     as the user.
//
// Pure logic, zero dependencies — imports only src/pipeline/selfName.js.

import { extractSelfName, bareName } from '../src/pipeline/selfName.js';

let failures = 0;
const p = (...a) => console.log(...a);
function check(label, cond, details) {
  if (cond) { p('  ok  ' + label); return; }
  failures++;
  p('  FAIL ' + label + (details !== undefined ? '  → ' + JSON.stringify(details) : ''));
}
const eq = (label, actual, expected) =>
  check(`${label}  =>  ${JSON.stringify(expected)}`, actual === expected, { actual });

// ════════════════════════════════════════════════════════════════════════════
p('\n── 1. extractSelfName: garbage inputs must be BLANK (null), never a word ──');
// These are the real-world first replies to "who's someone important in your
// life?". None is a self-introduction, so the self-name must stay blank.
for (const body of [
  'My wife Sarah just turned 30',   // the "My" bug
  'My mom',
  'My brother John, his birthday is coming up',
  'Grabbed coffee with my friend Dave',   // the "Grabbed" bug
  'Grabbed drinks with Dave last night',
  'She just moved to Boston',
  'We went to Rome together',
  'His name is John',               // someone ELSE's name, not the user's
  "John's birthday is next week",
  'Sarah',                          // bare other-person name
  'my best friend Luca',
  'this is my mom Sarah',           // "this is" must NOT capture "my"
  'call me tomorrow',               // "call me" must NOT capture "tomorrow"
  "it's complicated",
  'hey',
  '',
  '   ',
  null,
  undefined,
]) {
  eq(`extractSelfName(${JSON.stringify(body)})`, extractSelfName(body), null);
}
// The two canonical production symptoms, asserted head-on.
check('never returns "My" for "My wife Sarah…"', extractSelfName('My wife Sarah just turned 30') !== 'My');
check('never returns "Grabbed" for "Grabbed coffee…"', extractSelfName('Grabbed coffee with my friend Dave') !== 'Grabbed');

// ════════════════════════════════════════════════════════════════════════════
p('\n── 2. extractSelfName: real self-introductions ARE captured (capitalized) ──');
eq('extractSelfName("I\'m Emil")', extractSelfName("I'm Emil"), 'Emil');
eq('extractSelfName("i am emil")', extractSelfName('i am emil'), 'Emil');
eq('extractSelfName("im emil")', extractSelfName('im emil'), 'Emil');
eq('extractSelfName("my name is emil")', extractSelfName('my name is emil'), 'Emil');
eq('extractSelfName("My name\'s Emil")', extractSelfName("My name's Emil"), 'Emil');
eq('extractSelfName("hey, I\'m Emil")', extractSelfName("hey, I'm Emil"), 'Emil');
eq('extractSelfName("I\'m Emil, my wife is Sarah")', extractSelfName("I'm Emil, my wife is Sarah"), 'Emil');
eq('extractSelfName("my name is Emil Smith")', extractSelfName('my name is Emil Smith'), 'Emil');
eq('extractSelfName("I\'m Jean-Luc")', extractSelfName("I'm Jean-Luc"), 'Jean-Luc');
eq('extractSelfName("my name is o\'brien")', extractSelfName("my name is o'brien"), "O'brien");
eq('extractSelfName("I\'m Bo")', extractSelfName("I'm Bo"), 'Bo');

// ════════════════════════════════════════════════════════════════════════════
p('\n── 3. extractSelfName: cue + common non-name word is rejected (stopword guard) ──');
for (const body of [
  "i'm good", "im good thanks", "I'm here", "i am busy",
  "i'm not sure", "I'm sorry", "i'm ready", "im so happy",
]) {
  eq(`extractSelfName(${JSON.stringify(body)})`, extractSelfName(body), null);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 4. bareName: lone-name replies (drives the skip-the-model follow-up) ──');
eq('bareName("Emil")', bareName('Emil'), 'Emil');
eq('bareName("Sarah.")', bareName('Sarah.'), 'Sarah');
eq('bareName("hey Emil")', bareName('hey Emil'), 'Emil');
eq('bareName("I\'m Emil")', bareName("I'm Emil"), 'Emil');
eq('bareName("my name is Emil")', bareName('my name is Emil'), 'Emil');
// Multi-word / real content is NOT a lone name → must fall through to the model.
for (const body of ['My wife Sarah', 'Grabbed drinks with Dave', 'My mom', "i'm not sure", '', null]) {
  eq(`bareName(${JSON.stringify(body)})`, bareName(body), null);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 5. The fix, end to end: a bare other-person name is NOT saved as self ──');
// "Sarah" alone short-circuits (bareName truthy) but is NOT the user's name
// (extractSelfName null) — so markOnboarded gets no name and renameSelf is skipped.
check('bare "Sarah": short-circuits', bareName('Sarah') === 'Sarah');
check('bare "Sarah": self-name stays blank', extractSelfName('Sarah') === null);
// "I'm Emil": short-circuits AND is correctly captured as the user's own name.
check('"I\'m Emil": short-circuits', bareName("I'm Emil") === 'Emil');
check('"I\'m Emil": captured as self-name', extractSelfName("I'm Emil") === 'Emil');
// "My wife Sarah": neither — falls through to the model, self-name blank.
check('"My wife Sarah": not a lone name', bareName('My wife Sarah') === null);
check('"My wife Sarah": self-name blank', extractSelfName('My wife Sarah') === null);

// ════════════════════════════════════════════════════════════════════════════
p('');
if (failures === 0) p('ALL SELF-NAME TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
