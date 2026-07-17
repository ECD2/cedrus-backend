// Proof: every people-service write is scoped by user_id, so a foreign
// person_id can never write across tenants. Concatenated after
// reliability-core.js + stripped src/services/people.js.

(async () => {
  const { check, done } = makeChecker();

  __reset();
  __seed('people', [
    { id: 'pA', user_id: 'uA', name: 'Alice', is_self: false, is_archived: false, relationship: null, aliases: [] },
    { id: 'pB', user_id: 'uB', name: 'Bob', is_self: false, is_archived: false, relationship: null, aliases: [] },
  ]);
  const get = (id) => __rows('people').find((p) => p.id === id);

  println('people: owner can write to their own person');
  await rename('uA', 'pA', 'Alice Cooper');
  check('owner rename applied', get('pA').name === 'Alice Cooper');

  println('people: foreign person_id write is REJECTED (the cross-tenant backstop)');
  await rename('uA', 'pB', 'HACKED');            // uA reaches for uB's person
  check('foreign name untouched', get('pB').name === 'Bob');
  await setRelationship('uA', 'pB', 'ex-partner');
  check('foreign relationship untouched', get('pB').relationship == null);
  await markNudged('uA', 'pB');
  check('foreign markNudged is a no-op', get('pB').last_nudged_at == null);

  println('people: an unscoped write is refused outright (fail-closed guard)');
  let threw = false;
  try { await rename(null, 'pA', 'x'); } catch (_e) { threw = true; }
  check('missing userId throws', threw);
  threw = false;
  try { await setRelationship(undefined, 'pA', 'y'); } catch (_e) { threw = true; }
  check('missing userId throws (setRelationship)', threw);

  println('people: reads are user-scoped');
  const listA = await listForUser('uA');
  check('listForUser returns only the owner rows', listA.length === 1 && listA[0].id === 'pA');

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
