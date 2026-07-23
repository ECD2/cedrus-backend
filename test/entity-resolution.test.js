// Phase 1 entity-resolution bands — the wrong-person merge fix.
// Concatenated after reliability-core.js + (import/export-stripped)
// src/services/entityResolution.js by run-tests.sh. Runs under jsc or node/bun.

(async () => {
  const { check, done } = makeChecker();

  const roster = [{ id: 'luca', name: 'Luca', aliases: [], relationship: 'brother', is_self: false }];

  println('the bug: "met a guy named Lucas" is a NEW person, NOT merged into Luca');
  const lucas = decideResolution({
    mention: { resolution: 'new', proposed_name: 'Lucas', mention_text: 'Lucas' },
    body: 'Met a guy named Lucas at a work event, might collaborate with him.',
    people: roster,
  });
  check('Lucas -> NEW', lucas.action === 'new', JSON.stringify(lucas));
  check("Lucas did NOT take Luca's id", lucas.personId !== 'luca');

  println('Phase 2a: a near-match with NO cue now ASKS (holds the write), no silent create/merge');
  const lucasNoCue = decideResolution({
    mention: { resolution: 'new', proposed_name: 'Lucas', mention_text: 'Lucas' },
    body: 'Lucas said hi',
    people: roster,
  });
  check('near-match, no cue -> ASK', lucasNoCue.action === 'ask', JSON.stringify(lucasNoCue));
  check('ASK did not merge into Luca', lucasNoCue.personId === undefined);
  check('ASK lists Luca as a candidate', (lucasNoCue.candidates || []).some((c) => c.id === 'luca'));

  println('"Luka" typo the model itself resolved to existing Luca DOES merge');
  const luka = decideResolution({
    mention: { resolution: 'existing', person_id: 'luca', mention_text: 'Luka', confidence: 0.95 },
    body: "Luka's thinking about moving to Austin next year.",
    people: roster,
  });
  check('Luka merges to Luca', luka.action === 'existing' && luka.personId === 'luca', JSON.stringify(luka));

  println('Phase 2a: model "ambiguous" but the name EXACTLY matches one person -> merge (exact single wins)');
  const amb = decideResolution({
    mention: { resolution: 'ambiguous', mention_text: 'Luca', candidate_ids: ['luca'] },
    body: 'Text Luca for me',
    people: roster,
  });
  check('exact single name merges even if the model said ambiguous', amb.action === 'existing' && amb.personId === 'luca', JSON.stringify(amb));

  println('an EXACT existing name with no cue still merges (correct dedup preserved)');
  const ana = decideResolution({
    mention: { resolution: 'new', proposed_name: 'Ana', mention_text: 'Ana' },
    body: 'Ana loves jazz',
    people: [{ id: 'ana', name: 'Ana', aliases: [] }],
  });
  check('exact name -> merge', ana.action === 'existing' && ana.personId === 'ana', JSON.stringify(ana));

  println('exact existing name BUT a new-person cue -> NEW (a different Ana)');
  const ana2 = decideResolution({
    mention: { resolution: 'new', proposed_name: 'Ana', mention_text: 'Ana' },
    body: 'met a new coworker named Ana',
    people: [{ id: 'ana', name: 'Ana', aliases: [] }],
  });
  check('exact + cue -> NEW', ana2.action === 'new', JSON.stringify(ana2));

  println('a curated nickname (Mike ~ Michael) merges');
  const mike = decideResolution({
    mention: { resolution: 'new', proposed_name: 'Mike', mention_text: 'Mike' },
    body: 'Mike got a promotion',
    people: [{ id: 'michael', name: 'Michael', aliases: [] }],
  });
  check('Mike merges to Michael', mike.action === 'existing' && mike.personId === 'michael', JSON.stringify(mike));

  println('a foreign / hallucinated existing id is NOT trusted (cross-tenant guard)');
  const foreign = decideResolution({
    mention: { resolution: 'existing', person_id: 'not-mine', mention_text: 'Zed', confidence: 0.99 },
    body: 'Zed says hi',
    people: roster,
  });
  check('foreign id -> NEW, not a cross-tenant merge', foreign.action === 'new', JSON.stringify(foreign));

  println('hasNewPersonCue picks up the introducing phrasings');
  check('"met a guy named"', hasNewPersonCue('met a guy named Lucas'));
  check('"someone named"', hasNewPersonCue('someone named Priya'));
  check('"a new coworker"', hasNewPersonCue('a new coworker'));
  check('plain reference is not a cue', !hasNewPersonCue('had lunch with Luca'));

  // ── Phase 2a — near-match trigger (§1.5), candidate-listing ask, bare-name,
  //    and deterministic answer interpretation (§2.4) ──────────────────────────
  println('');
  println('Phase 2a NEAR-MATCH (§1.5): the Luca family matches; genuinely different names do not');
  check('Luca ~ Lucas', isNearMatch('luca', 'lucas'));
  check('Luca ~ Luka', isNearMatch('luca', 'luka'));
  check('Luca ~ Luc', isNearMatch('luca', 'luc'));
  check('Lucas ~ Luka', isNearMatch('lucas', 'luka'));
  check('Luc ~ Luka', isNearMatch('luc', 'luka'));
  check('Ana ~ Anna', isNearMatch('ana', 'anna'));
  check('Jon !~ Jan (shared prefix < 2)', !isNearMatch('jon', 'jan'));
  check('Dan !~ Don', !isNearMatch('dan', 'don'));
  check('Sam !~ Pam', !isNearMatch('sam', 'pam'));
  check('Bo !~ Jo (min len < 3)', !isNearMatch('bo', 'jo'));
  check('exact-equal is NOT a near-match', !isNearMatch('luca', 'luca'));

  const twoLucas = [
    { id: 'luca', name: 'Luca', aliases: [], relationship: 'brother', is_self: false },
    { id: 'lucas', name: 'Lucas', aliases: [], relationship: 'coworker', is_self: false },
  ];

  println('');
  println('"Luka" ASKS and lists BOTH Luca and Lucas, closest spelling first');
  const luka2 = decideResolution({
    mention: { resolution: 'new', proposed_name: 'Luka', mention_text: 'Luka' },
    body: 'Luka got a dog', people: twoLucas,
  });
  check('Luka -> ASK (near_match)', luka2.action === 'ask' && luka2.askKind === 'near_match', JSON.stringify(luka2));
  check('candidates are Luca and Lucas', luka2.candidates.map((c) => c.id).sort().join(',') === 'luca,lucas');
  check('Luca (distance 1) listed before Lucas (distance 2)', luka2.candidates[0].id === 'luca');

  println('');
  println('a bare name matching TWO people asks WHICH (bare-name disambiguation)');
  const bare = decideResolution({
    mention: { resolution: 'existing', proposed_name: 'Luca', mention_text: 'Luca' },
    body: 'Luca called me', people: [
      { id: 'lucaC', name: 'Luca', aliases: [], relationship: 'brother', is_self: false },
      { id: 'lucaM', name: 'Luca', aliases: [], relationship: 'coworker', is_self: false },
    ],
  });
  check('two same-name -> ASK (bare_name)', bare.action === 'ask' && bare.askKind === 'bare_name', JSON.stringify(bare));
  check('both Lucas are candidates', bare.candidates.length === 2);

  println('');
  println('a genuinely different name (Jon vs existing Jan) does NOT ask');
  const jon = decideResolution({
    mention: { resolution: 'new', proposed_name: 'Jon', mention_text: 'Jon' },
    body: 'Jon called', people: [{ id: 'jan', name: 'Jan', aliases: [], is_self: false }],
  });
  check('Jon -> NEW (no ask, no merge)', jon.action === 'new', JSON.stringify(jon));

  println('');
  println('model-flagged ambiguity over near candidates ASKS; a new-person cue still CREATES');
  const ambNear = decideResolution({
    mention: { resolution: 'ambiguous', proposed_name: 'Luka', mention_text: 'Luka', candidate_ids: ['luca', 'lucas'] },
    body: 'saw Luka', people: twoLucas,
  });
  check('ambiguous over near -> ASK', ambNear.action === 'ask', JSON.stringify(ambNear));
  const cueWins = decideResolution({
    mention: { resolution: 'new', proposed_name: 'Luka', mention_text: 'Luka' },
    body: 'met a guy named Luka at the gym', people: twoLucas,
  });
  check('new-person cue -> CREATE, never an ask', cueWins.action === 'new', JSON.stringify(cueWins));

  println('');
  println('interpretClarificationReply (§2.4) resolves an answer deterministically');
  const clar = { candidates: [{ id: 'luca', name: 'Luca', relationship: 'brother' }, { id: 'lucas', name: 'Lucas', relationship: 'coworker' }], proposed_name: 'Luka' };
  check('"Luca" -> same, Luca', (() => { const r = interpretClarificationReply('Luca', clar); return r.decision === 'same' && r.personId === 'luca'; })());
  check('"the second one" -> same, Lucas', (() => { const r = interpretClarificationReply('the second one', clar); return r.decision === 'same' && r.personId === 'lucas'; })());
  check('"someone new" -> different', interpretClarificationReply('someone new', clar).decision === 'different');
  check('"no" -> different', interpretClarificationReply('no', clar).decision === 'different');
  const clar1 = { candidates: [{ id: 'luca', name: 'Luca', relationship: 'brother' }], proposed_name: 'Luka' };
  check('bare "yes" with one candidate -> same', interpretClarificationReply('yes', clar1).decision === 'same');
  check('bare-name reply "my brother" resolves by relationship', (() => {
    const r = interpretClarificationReply('my brother', { candidates: [{ id: 'b', name: 'Luca', relationship: 'brother' }, { id: 'c', name: 'Luca', relationship: 'coworker' }] });
    return r.decision === 'same' && r.personId === 'b';
  })());

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
