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

  // ── Phase 2b: same-first-name disambiguation (docs §3) ───────────────────
  println('');
  println('Phase 2b: deriveLastInitial pulls the surname initial, null when first-name-only');
  check('"Luca Nannini" -> N.', deriveLastInitial('Luca Nannini') === 'N.');
  check('"Luca N." -> N.', deriveLastInitial('Luca N.') === 'N.');
  check('"Luca" (no surname) -> null', deriveLastInitial('Luca') === null);

  println('Phase 2b: two Lucas lazily get a last_initial from their stated surnames (name untouched)');
  __reset(); __seed('people', []);
  const luca1 = await create('u9', { name: 'Luca Chen' });
  check('a single Luca has NO initial yet (lazy, no collision)', get(luca1.id).last_initial == null);
  const luca2 = await create('u9', { name: 'Luca Martinez' });
  check('the new colliding Luca gets M.', get(luca2.id).last_initial === 'M.');
  check('the previously-unlabeled twin retroactively gets C.', get(luca1.id).last_initial === 'C.');
  check('the real names are never mutated', get(luca1.id).name === 'Luca Chen' && get(luca2.id).name === 'Luca Martinez');

  println('Phase 2b: displayName shows "Luca C."/"Luca M." only on collision; plain otherwise');
  const roster9 = await listForUser('u9');
  const dn = (id) => displayName(roster9.find((p) => p.id === id), roster9);
  check('displayName Luca Chen -> "Luca C."', dn(luca1.id) === 'Luca C.');
  check('displayName Luca Martinez -> "Luca M."', dn(luca2.id) === 'Luca M.');
  const priya = await create('u9', { name: 'Priya' });
  const roster9b = await listForUser('u9');
  check('a unique first name shows plain, no initial', displayName(roster9b.find((p) => p.id === priya.id), roster9b) === 'Priya');
  // a third Luca with NO stated surname stays unlabeled (graceful fallback → relationship in the ask)
  const luca3 = await create('u9', { name: 'Luca' });
  check('a surnameless colliding Luca stays initial-less', get(luca3.id).last_initial == null);
  const roster9c = await listForUser('u9');
  check('displayName for the surnameless Luca is plain "Luca"', displayName(roster9c.find((p) => p.id === luca3.id), roster9c) === 'Luca');

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
