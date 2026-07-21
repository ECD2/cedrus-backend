// Assertions for the fact pipeline: canonical keys + supersession + relationship sync.
// This file is CONCATENATED after stubs.js + (import/export-stripped) src files by
// run-tests.sh, so memory.js/persist.js functions are in scope. Runs under jsc or node.

(async () => {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) { println('  PASS  ' + name); }
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  const currentFacts = (personId, keys) =>
    __db.facts.filter((f) => f.person_id === personId && f.is_current !== false && (!keys || keys.includes(f.fact_key)));

  // ── canonicalFactKey ─────────────────────────────────────────────
  println('canonicalFactKey');
  check('relationship_status -> relationship', canonicalFactKey('relationship_status') === 'relationship');
  check('messy casing/spacing normalizes', canonicalFactKey(' Relationship Status ') === 'relationship');
  check('location -> city', canonicalFactKey('location') === 'city');
  check('plain key passes through', canonicalFactKey('music') === 'music');
  check('null stays null', canonicalFactKey(null) === null);

  // ── the exact production bug: correction stacked beside old fact ──
  println('correction supersedes instead of stacking (the girlfriend/ex bug)');
  __db.facts.length = 0;
  // State as production had it after "my girlfriend Ana is hot":
  __db.facts.push(
    { id: 1, user_id: 'u1', person_id: 'p1', fact_type: 'relationship_detail', fact_key: 'relationship', fact_value: 'girlfriend', is_current: true },
    { id: 2, user_id: 'u1', person_id: 'p1', fact_type: 'note', fact_key: 'attractiveness', fact_value: 'hot', is_current: true },
  );
  // The correction arrives under the WRONG key and with the flag FORGOTTEN —
  // the worst case the model produced in production:
  await addFact({
    userId: 'u1', personId: 'p1', factType: 'relationship_detail',
    factKey: 'relationship_status', factValue: 'ex-girlfriend',
    supersedesPrior: false, sourceMessageId: 'm2', confidence: 0.9,
  });
  const relFacts = currentFacts('p1', ['relationship', 'relationship_status', 'relationship_type', 'relationship_to_user']);
  check('exactly ONE current relationship fact', relFacts.length === 1, 'got ' + relFacts.length);
  check('it reflects the correction', relFacts[0] && relFacts[0].fact_value === 'ex-girlfriend');
  check('stored under the canonical key', relFacts[0] && relFacts[0].fact_key === 'relationship');
  const old = __db.facts.find((f) => f.id === 1);
  check('old fact retired with reason', old.is_current === false && old.ended_reason === 'superseded' && !!old.ended_at);
  check('unrelated fact untouched', currentFacts('p1', ['attractiveness']).length === 1);

  // ── multi-valued keys never supersede ─────────────────────────────
  println('multi-valued facts stack');
  await addFact({ userId: 'u1', personId: 'p1', factType: 'interest', factKey: 'music', factValue: 'jazz', supersedesPrior: false, sourceMessageId: 'm3', confidence: 0.9 });
  await addFact({ userId: 'u1', personId: 'p1', factType: 'interest', factKey: 'music', factValue: 'techno', supersedesPrior: false, sourceMessageId: 'm4', confidence: 0.9 });
  check('jazz and techno both current', currentFacts('p1', ['music']).length === 2);

  // ── model-flagged supersession still honored for other keys ───────
  println('explicit supersedes_prior still works');
  await addFact({ userId: 'u1', personId: 'p1', factType: 'note', factKey: 'nickname', factValue: 'Annie', supersedesPrior: false, sourceMessageId: 'm5', confidence: 0.9 });
  await addFact({ userId: 'u1', personId: 'p1', factType: 'note', factKey: 'nickname', factValue: 'Ans', supersedesPrior: true, sourceMessageId: 'm6', confidence: 0.9 });
  const nicks = currentFacts('p1', ['nickname']);
  check('one current nickname after flagged replace', nicks.length === 1 && nicks[0].fact_value === 'Ans');

  // ── single-valued keys force supersession even across people safely ─
  println('single-valued keys scoped per person');
  await addFact({ userId: 'u1', personId: 'p2', factType: 'context', factKey: 'city', factValue: 'Austin', supersedesPrior: false, sourceMessageId: 'm7', confidence: 0.9 });
  await addFact({ userId: 'u1', personId: 'p1', factType: 'context', factKey: 'city', factValue: 'Chicago', supersedesPrior: false, sourceMessageId: 'm8', confidence: 0.9 });
  check("p2's city not clobbered by p1's move", currentFacts('p2', ['city']).length === 1 && currentFacts('p2', ['city'])[0].fact_value === 'Austin');

  // ── persist(): relationship fact syncs people.relationship column ──
  // Bundle runs the REAL people.js against __db.people, so these assertions
  // prove the actual column write happens (not that a stub was invoked).
  const personRow = (id) => __db.people.find((r) => r.id === id);
  const seedPeople = () => {
    __db.people.length = 0;
    __db.people.push(
      { id: 'p1', user_id: 'u1', name: 'Ana', relationship: 'girlfriend', is_archived: false },
      // Foreign tenant's person: any write landing here is the cross-tenant bug.
      { id: 'p9', user_id: 'u2', name: 'Otra', relationship: 'friend', is_archived: false },
    );
  };
  println('persist() end-to-end (stubs for twilio-side services)');
  __db.facts.length = 0;
  seedPeople();
  __db.facts.push({ id: 10, user_id: 'u1', person_id: 'p1', fact_type: 'relationship_detail', fact_key: 'relationship', fact_value: 'girlfriend', is_current: true });
  await persist({
    user: { id: 'u1', timezone: 'America/New_York' },
    message: { id: 'm9' },
    parsed: {
      people: [{ mention_text: 'Ana', resolution: 'existing', person_id: 'p1', contact_signal: 'none', sentiment: 'neutral', confidence: 0.95 }],
      facts: [{ person_ref: 'Ana', fact_type: 'relationship_detail', fact_key: 'relationship_status', fact_value: 'ex-girlfriend', supersedes_prior: true, confidence: 0.95 }],
      saved_items: [], reminders: [], goals: [], prompt_answer: null,
    },
    resolved: { personByMention: { Ana: 'p1' } },
  });
  const relNow = currentFacts('p1', ['relationship', 'relationship_status']);
  check('one current relationship fact after persist', relNow.length === 1, 'got ' + relNow.length);
  check('value is the correction', relNow[0] && relNow[0].fact_value === 'ex-girlfriend');
  check('people.relationship column synced', personRow('p1').relationship === 'ex-girlfriend', personRow('p1').relationship);
  check("foreign tenant's person untouched", personRow('p9').relationship === 'friend');

  // ── Priority 2a: tautological facts dropped before they persist ──────────
  println('Priority 2a: tautological key/value collisions are dropped (code disposes)');
  check('key == value is tautological', isTautologicalFact('jewelry', 'jewelry') === true);
  check('"likes X" under key X is tautological', isTautologicalFact('jewelry', 'likes jewelry') === true);
  check('bare "loves" is tautological', isTautologicalFact('music', 'loves') === true);
  check('informative value is kept', isTautologicalFact('jewelry', 'gold; wants a necklace') === false);
  check('specific value is kept', isTautologicalFact('job', 'Stripe') === false);

  __db.facts.length = 0;
  await persist({
    user: { id: 'u1', timezone: 'America/New_York' }, message: { id: 'm20' },
    parsed: {
      people: [{ mention_text: 'Ana', resolution: 'existing', person_id: 'p1', contact_signal: 'none', sentiment: 'neutral', confidence: 0.9 }],
      facts: [
        { person_ref: 'Ana', fact_type: 'interest', fact_key: 'jewelry', fact_value: 'likes jewelry', supersedes_prior: false, confidence: 0.9 },
        { person_ref: 'Ana', fact_type: 'interest', fact_key: 'music', fact_value: 'jazz', supersedes_prior: false, confidence: 0.9 },
      ],
      saved_items: [], reminders: [], goals: [], prompt_answer: null,
    },
    resolved: { personByMention: { Ana: 'p1' } },
  });
  check('tautological fact was NOT written', currentFacts('p1', ['jewelry']).length === 0, 'wrote ' + currentFacts('p1', ['jewelry']).length);
  check('informative fact WAS written', currentFacts('p1', ['music']).length === 1);

  // ── Priority 2b (killing fixture): correction via a THIRD alias key, flag
  //    forgotten, through the full persist path → one canonical fact + column sync.
  println('Priority 2b: relationship_type alias correction through persist supersedes + syncs');
  __db.facts.length = 0;
  seedPeople();
  __db.facts.push({ id: 30, user_id: 'u1', person_id: 'p1', fact_type: 'relationship_detail', fact_key: 'relationship', fact_value: 'girlfriend', is_current: true });
  await persist({
    user: { id: 'u1', timezone: 'America/New_York' }, message: { id: 'm22' },
    parsed: {
      people: [{ mention_text: 'Ana', resolution: 'existing', person_id: 'p1', contact_signal: 'none', sentiment: 'neutral', confidence: 0.9 }],
      facts: [{ person_ref: 'Ana', fact_type: 'relationship_detail', fact_key: 'relationship_type', fact_value: 'ex-girlfriend', supersedes_prior: false, confidence: 0.9 }],
      saved_items: [], reminders: [], goals: [], prompt_answer: null,
    },
    resolved: { personByMention: { Ana: 'p1' } },
  });
  const relAfter = currentFacts('p1', ['relationship', 'relationship_type', 'relationship_status']);
  check('exactly one current relationship fact', relAfter.length === 1, 'got ' + relAfter.length);
  check('reflects the correction', relAfter[0] && relAfter[0].fact_value === 'ex-girlfriend');
  check('people.relationship column synced', personRow('p1').relationship === 'ex-girlfriend', personRow('p1').relationship);

  // ── WS-A ownership regression (the 2026-07 silent no-op): rename +
  //    relationship sync must pass the OWNING user through to people.js.
  //    Before the fix, persist called rename(personId, name) — the hardened
  //    service saw userId=personId, name=undefined, and no-opped. These checks
  //    run the real service, so that drift can never go green again.
  println('ownership regression: corrected_name renames the right row, scoped to the owner');
  __db.facts.length = 0;
  seedPeople();
  await persist({
    user: { id: 'u1', timezone: 'America/New_York' }, message: { id: 'm30' },
    parsed: {
      people: [{ mention_text: 'Anna', resolution: 'existing', person_id: 'p1', corrected_name: 'Mariana', contact_signal: 'none', sentiment: 'neutral', confidence: 0.9 }],
      facts: [], saved_items: [], reminders: [], goals: [], prompt_answer: null,
    },
    resolved: { personByMention: { Anna: 'p1' } },
  });
  check('person renamed via corrected_name', personRow('p1').name === 'Mariana', personRow('p1').name);
  check("foreign tenant's person not renamed", personRow('p9').name === 'Otra');

  println('ownership regression: a foreign person_id write affects zero rows');
  __db.facts.length = 0;
  seedPeople();
  await persist({
    user: { id: 'u1', timezone: 'America/New_York' }, message: { id: 'm31' },
    parsed: {
      // Hallucinated/foreign resolution: p9 belongs to u2. The user-scoped
      // predicate in people.js must make both writes hit zero rows.
      people: [{ mention_text: 'Otra', resolution: 'existing', person_id: 'p9', corrected_name: 'Hacked', contact_signal: 'none', sentiment: 'neutral', confidence: 0.9 }],
      facts: [{ person_ref: 'Otra', fact_type: 'relationship_detail', fact_key: 'relationship', fact_value: 'bestie', supersedes_prior: true, confidence: 0.9 }],
      saved_items: [], reminders: [], goals: [], prompt_answer: null,
    },
    resolved: { personByMention: { Otra: 'p9' } },
  });
  check("cross-tenant rename rejected (name unchanged)", personRow('p9').name === 'Otra', personRow('p9').name);
  check("cross-tenant relationship sync rejected", personRow('p9').relationship === 'friend', personRow('p9').relationship);

  // ── Priority 0: a suppressed crisis turn writes NO product content (§7) ──
  println('Priority 0: _suppressPersistence writes nothing (crisis content never persists)');
  __db.facts.length = 0;
  seedPeople();
  __calls.linkMessagePerson.length = 0;
  __calls.logContact.length = 0;
  await persist({
    user: { id: 'u1', timezone: 'America/New_York' }, message: { id: 'm23' },
    parsed: {
      _suppressPersistence: true,
      people: [{ mention_text: 'Ana', resolution: 'existing', person_id: 'p1', contact_signal: 'explicit_contact', sentiment: 'negative', confidence: 0.9 }],
      facts: [{ person_ref: 'Ana', fact_type: 'mood', fact_key: 'mood', fact_value: 'in crisis', supersedes_prior: true, confidence: 0.9 }],
      saved_items: [{ person_ref: 'Ana', item_type: 'note', title: 'note' }],
      reminders: [], goals: [], prompt_answer: null,
    },
    resolved: { personByMention: { Ana: 'p1' } },
  });
  check('no facts written on suppressed turn', __db.facts.length === 0, 'wrote ' + __db.facts.length);
  check('no person link written on suppressed turn', __calls.linkMessagePerson.length === 0);
  check('no relationship column touched on suppressed turn', personRow('p1').relationship === 'girlfriend');

  // ── Registry is the SINGLE source of truth + safe to extend ───────────────
  // Locks in the modularity guarantee: the canonical slot set lives in one
  // exported place (memory.js), and the import path imports SINGLE_VALUED_KEYS
  // from here instead of keeping its own copy — so extending the registry can't
  // silently leave a write path behind and re-fork a slot.
  println('canonical slot registry is single-sourced and extension-safe');
  check('SINGLE_VALUED_KEYS is exported and holds the relationship slot',
    typeof SINGLE_VALUED_KEYS !== 'undefined' && SINGLE_VALUED_KEYS.has('relationship'));
  check('registry covers relationship/job/city/mood',
    ['relationship', 'job', 'city', 'mood'].every((k) => SINGLE_VALUED_KEYS.has(k)));
  // Every alias must fold onto a SINGLE-VALUED canonical slot — that pairing is
  // what makes a correction under any alias supersede instead of stack. Add a
  // new alias pointing at a multi-valued slot and this fails loudly.
  const aliasEntries = Object.entries(FACT_KEY_ALIASES);
  check('every alias canonicalizes to its declared target',
    aliasEntries.every(([alias, canon]) => canonicalFactKey(alias) === canon));
  check('every aliased slot is single-valued (any-alias corrections supersede)',
    aliasEntries.every(([, canon]) => SINGLE_VALUED_KEYS.has(canon)));

  // ── Freshly written facts are explicitly current (invariant self-contained) ─
  println('addFact writes is_current = true (not resting on a column default)');
  __db.facts.length = 0;
  await addFact({ userId: 'u1', personId: 'pX', factType: 'context', factKey: 'city', factValue: 'Lisbon', supersedesPrior: false, sourceMessageId: 'mX', confidence: 0.9 });
  const fresh = __db.facts.filter((f) => f.person_id === 'pX' && f.fact_key === 'city');
  check('the inserted fact carries is_current === true', fresh.length === 1 && fresh[0].is_current === true);

  // ── girlfriend → ex under EVERY relationship alias ends with ONE fact ─────
  // Drives the exact production bug once per alias key, proving the collapse
  // holds no matter which alias the model emits the correction under.
  println('girlfriend -> ex under each relationship alias ends with exactly one fact');
  for (const alias of ['relationship_status', 'relationship_type', 'relationship_to_user']) {
    __db.facts.length = 0;
    __db.facts.push({ id: 900, user_id: 'u1', person_id: 'pr', fact_type: 'relationship_detail', fact_key: 'relationship', fact_value: 'girlfriend', is_current: true });
    await addFact({ userId: 'u1', personId: 'pr', factType: 'relationship_detail', factKey: alias, factValue: 'ex-girlfriend', supersedesPrior: false, sourceMessageId: 'm', confidence: 0.9 });
    const rel = currentFacts('pr', ['relationship', 'relationship_status', 'relationship_type', 'relationship_to_user']);
    check('exactly one current relationship fact after correction via ' + alias,
      rel.length === 1 && rel[0].fact_value === 'ex-girlfriend' && rel[0].fact_key === 'relationship', 'got ' + rel.length);
  }

  // ── PART A hardening: extended registry (new aliases + separator folding) ──
  println('extended registry: new single-valued aliases fold onto their slot');
  check('status -> relationship (the prompt-named 3rd variant that was the gap)', canonicalFactKey('status') === 'relationship');
  check('relationship_to_me -> relationship', canonicalFactKey('relationship_to_me') === 'relationship');
  check('occupation -> job', canonicalFactKey('occupation') === 'job');
  check('profession -> job', canonicalFactKey('profession') === 'job');
  check('workplace -> job', canonicalFactKey('workplace') === 'job');
  check('company -> job', canonicalFactKey('company') === 'job');
  check('lives_in -> city', canonicalFactKey('lives_in') === 'city');
  check('residence -> city', canonicalFactKey('residence') === 'city');

  println('separator folding: hyphens and underscore-runs normalize like spaces');
  check('hyphen folds: relationship-status -> relationship', canonicalFactKey('relationship-status') === 'relationship');
  check('double underscore folds: relationship__status -> relationship', canonicalFactKey('relationship__status') === 'relationship');
  check('spaced + capitalized: " Lives In " -> city', canonicalFactKey(' Lives In ') === 'city');
  // Complementary facet stays distinct (audit D2): job_title must NOT collapse onto job.
  check('Job-Title stays job_title (not aliased onto job)', canonicalFactKey('Job-Title') === 'job_title');
  check('separator-only key normalizes to null', canonicalFactKey(' - _ ') === null);

  println('correction via a NEW alias supersedes instead of forking (through addFact)');
  for (const [alias, seedKey, seedVal, newVal] of [
    ['status', 'relationship', 'girlfriend', 'ex-girlfriend'],
    ['occupation', 'job', 'Stripe', 'Google'],
    ['lives_in', 'city', 'Austin', 'Chicago'],
  ]) {
    __db.facts.length = 0;
    __db.facts.push({ id: 950, user_id: 'u1', person_id: 'pn', fact_type: 'context', fact_key: seedKey, fact_value: seedVal, is_current: true });
    await addFact({ userId: 'u1', personId: 'pn', factType: 'context', factKey: alias, factValue: newVal, supersedesPrior: false, sourceMessageId: 'm', confidence: 0.9 });
    const rows = currentFacts('pn', [seedKey, alias]);
    check('one current ' + seedKey + ' fact after correction via ' + alias,
      rows.length === 1 && rows[0].fact_value === newVal && rows[0].fact_key === seedKey, 'got ' + rows.length);
  }

  println('');
  println(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
  if (failures > 0 && typeof process !== 'undefined') process.exit(1);
})();
