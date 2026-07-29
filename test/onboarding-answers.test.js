// Bundle 34 — web onboarding answers land in the EXISTING facts/people layer.
//
// Real onboardingAnswers.js + real memory.js (addFact + supersession) + real
// people.js (create + fuzzyFind, ownership guard included) over the fake DB.
// The invariants:
//   • every step writes where the concierge already reads (self-person facts,
//     people rows) — no parallel storage,
//   • re-submitting a step REPLACES its answers (supersession; multi-answer
//     steps retire the whole prior set),
//   • people entries reuse an exact-match person, never duplicate,
//   • the SMS onboarding flow is untouched (nothing here writes app_users).

(async () => {
  const { check, done } = makeChecker();
  const U1 = 'u1';
  const SELF = 'self1';

  function seed() {
    __reset();
    __seed('app_users', [{ id: U1, onboarding_complete: false }]);
    __seed('people', [{ id: SELF, user_id: U1, name: 'Emil', is_self: true, is_archived: false, aliases: [] }]);
    __seed('facts', []);
  }
  const currentFacts = (key, personId = SELF) =>
    __rows('facts').filter((f) => f.fact_key === key && f.person_id === personId && f.is_current === true);
  const save = (step, answers) => saveAnswers({ userId: U1, step, answers });

  println('\n── 1. Single-answer steps write one current self-fact, idempotently ──');
  seed();
  let r = await save('work_setup', { mode: 'home', detail: 'kitchen table, most days' });
  check('work_setup saved', r.facts_saved === 1 && currentFacts('work_setup').length === 1);
  check('  value carries mode + detail', currentFacts('work_setup')[0].fact_value === 'home - kitchen table, most days');
  check('  fact_type context, confidence 1, user-stated', currentFacts('work_setup')[0].fact_type === 'context' && currentFacts('work_setup')[0].confidence === 1);
  r = await save('work_setup', { mode: 'hybrid' });
  check('re-submit REPLACES: exactly one current, prior retired as superseded',
    currentFacts('work_setup').length === 1 && currentFacts('work_setup')[0].fact_value === 'hybrid'
    && __rows('facts').some((f) => f.fact_key === 'work_setup' && f.is_current === false && f.ended_reason === 'superseded'));

  r = await save('neighborhood', { neighborhood: 'Brickell' });
  check('neighborhood saved as its own key (city is not touched)', currentFacts('neighborhood').length === 1 && currentFacts('city').length === 0);

  r = await save('free_windows', { windows: ['tuesday afternoon', 'thursday lunch'] });
  check('free_windows joined into one current answer', currentFacts('free_windows')[0].fact_value === 'tuesday afternoon, thursday lunch');

  println('\n── 2. Multi-answer steps: the stored set is the submitted set ──');
  seed();
  await save('activities', { activities: ['padel', 'coffee', 'gallery walks'] });
  check('three activity facts, all current', currentFacts('activity').length === 3);
  await save('activities', { activities: ['padel', 'sailing'] });
  const acts = currentFacts('activity').map((f) => f.fact_value).sort();
  check('re-submit retires the whole prior set and stores the new one',
    acts.join('|') === 'padel|sailing', JSON.stringify(acts));
  check('the old set is retired, not deleted (history preserved)',
    __rows('facts').filter((f) => f.fact_key === 'activity' && f.is_current === false).length === 3);

  await save('current_groups', { groups: ['run club'] });
  check('current_groups saved', currentFacts('current_group').length === 1);
  r = await save('current_groups', { groups: [] });
  check('an empty groups list writes nothing and keeps priors (no accidental wipe)',
    r.facts_saved === 0 && currentFacts('current_group').length === 1);

  println('\n── 3. People: create, reuse-on-exact-match, stage + see-more facts ──');
  seed();
  r = await save('people', { people: [{ name: 'Luca', relationship: 'friend', stage: 'cedar' }] });
  const luca = __rows('people').find((p) => p.name === 'Luca');
  check('person created with relationship', !!luca && luca.relationship === 'friend' && r.people_touched === 1);
  check('wants_more_time preference on the person', currentFacts('wants_more_time', luca.id).length === 1);
  check('friendship_stage imported at the stage the user says (spec PART 3)',
    currentFacts('friendship_stage', luca.id)[0].fact_value === 'cedar');

  const peopleCountBefore = __rows('people').length;
  await save('people', { people: [{ name: 'luca', stage: 'sapling' }] });
  check('exact-name re-submit reuses the person (case-insensitive), no duplicate',
    __rows('people').length === peopleCountBefore);
  check('  stage superseded, not stacked', currentFacts('friendship_stage', luca.id).length === 1
    && currentFacts('friendship_stage', luca.id)[0].fact_value === 'sapling');

  r = await save('people', { people: [{ name: 'Maya', see_more: false }] });
  const maya = __rows('people').find((p) => p.name === 'Maya');
  check('see_more:false → person created, but no wants_more_time fact',
    !!maya && currentFacts('wants_more_time', maya.id).length === 0);

  println('\n── 4. social_prefs: per-key supersession, partial updates keep siblings ──');
  seed();
  await save('social_prefs', { pace: 'weekly', notes: 'prefers daytime plans' });
  check('two preference facts', currentFacts('social_pace').length === 1 && currentFacts('social_notes').length === 1);
  await save('social_prefs', { pace: 'every couple of weeks' });
  check('pace replaced, notes untouched (partial update semantics)',
    currentFacts('social_pace')[0].fact_value === 'every couple of weeks'
    && currentFacts('social_notes')[0].fact_value === 'prefers daytime plans');

  println('\n── 5. Validation refuses garbage with typed errors ──');
  seed();
  let threw = null;
  try { await save('favorite_color', { color: 'green' }); } catch (e) { threw = e; }
  check('unknown step → 400 bad_step', threw && threw.status === 400 && threw.code === 'bad_step');
  threw = null;
  try { await save('people', { people: [{ name: 'Zed', stage: 'mighty_oak' }] }); } catch (e) { threw = e; }
  check('unknown stage → 400 bad_stage (the garden has four stages)', threw && threw.code === 'bad_stage');
  threw = null;
  try { await save('people', { people: [] }); } catch (e) { threw = e; }
  check('empty people list → 400', threw && threw.code === 'bad_answers');
  threw = null;
  try { await save('work_setup', {}); } catch (e) { threw = e; }
  check('work_setup without a mode → 400', threw && threw.code === 'bad_answers');
  threw = null;
  try { await save('social_prefs', {}); } catch (e) { threw = e; }
  check('social_prefs with nothing usable → 400', threw && threw.code === 'bad_answers');

  println('\n── 6. Boundaries: missing self person; SMS onboarding untouched ──');
  __reset();
  __seed('app_users', [{ id: U1, onboarding_complete: false }]);
  __seed('people', []); // no self row — abnormal
  threw = null;
  try { await save('neighborhood', { neighborhood: 'Wynwood' }); } catch (e) { threw = e; }
  check('missing self person → typed 500 no_self_person (refuses, never mis-writes)',
    threw && threw.status === 500 && threw.code === 'no_self_person');

  seed();
  await save('neighborhood', { neighborhood: 'Wynwood' });
  check('nothing here writes app_users — SMS onboarding state untouched',
    __rows('app_users')[0].onboarding_complete === false
    && Object.keys(__rows('app_users')[0]).join(',') === 'id,onboarding_complete');

  println('');
  const f = done();
  println(f === 0 ? 'ALL ONBOARDING-ANSWERS TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
