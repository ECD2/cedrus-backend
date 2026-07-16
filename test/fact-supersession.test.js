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
  println('persist() end-to-end (stubs for twilio-side services)');
  __db.facts.length = 0;
  __calls.setRelationship.length = 0;
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
  check('people.relationship column synced', __calls.setRelationship.length === 1 && __calls.setRelationship[0][0] === 'p1' && __calls.setRelationship[0][1] === 'ex-girlfriend',
    JSON.stringify(__calls.setRelationship));

  println('');
  println(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
  if (failures > 0 && typeof process !== 'undefined') process.exit(1);
})();
