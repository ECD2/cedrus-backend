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

  println('the core fix: a bare substring with NO cue still does not merge');
  const lucasNoCue = decideResolution({
    mention: { resolution: 'new', proposed_name: 'Lucas', mention_text: 'Lucas' },
    body: 'Lucas said hi',
    people: roster,
  });
  check('substring-only -> NEW', lucasNoCue.action === 'new', JSON.stringify(lucasNoCue));

  println('"Luka" typo the model itself resolved to existing Luca DOES merge');
  const luka = decideResolution({
    mention: { resolution: 'existing', person_id: 'luca', mention_text: 'Luka', confidence: 0.95 },
    body: "Luka's thinking about moving to Austin next year.",
    people: roster,
  });
  check('Luka merges to Luca', luka.action === 'existing' && luka.personId === 'luca', JSON.stringify(luka));

  println('a genuinely-ambiguous mention creates NEW (no contamination) in Phase 1');
  const amb = decideResolution({
    mention: { resolution: 'ambiguous', mention_text: 'Luca', candidate_ids: ['luca'] },
    body: 'Text Luca for me',
    people: roster,
  });
  check('ambiguous -> NEW (never a guessed merge)', amb.action === 'new', JSON.stringify(amb));
  check('ambiguous did NOT reuse the candidate id', amb.personId !== 'luca');

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

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
