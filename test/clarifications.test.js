// Phase 2a — the ask-first clarification loop (state machine + dispatch + sweep).
// Bundle (run-tests.sh): reliability-core.js + logger stub + voiceGuard.js +
// entityResolution.js + people.js + (people namespace) + clarifications.js + this.
// resolveEntities and persist are INJECTED as fakes, so the loop is exercised
// without the whole pipeline. Runs under jsc / node / bun.

(async () => {
  const { check, done } = makeChecker();

  const U = 'u1';
  const message = { id: 'm1' };
  const user = { id: U, timezone: 'America/New_York' };

  // Injected fakes.
  let persistCalls = [];
  const fakePersist = async (args) => { persistCalls.push(args); };
  let nextAsks = [];
  const fakeResolve = async () => ({ personByMention: {}, asks: nextAsks });
  const deps = { resolveEntities: fakeResolve, persist: fakePersist };

  const nearAsk = () => ({
    mention: { mention_text: 'Lucas', proposed_name: 'Lucas', proposed_relationship: null },
    candidates: [{ id: 'luca', name: 'Luca', relationship: 'brother' }],
    askKind: 'near_match',
  });
  const parsedWithFact = (reply) => ({
    reply, people: [{ mention_text: 'Lucas' }],
    facts: [{ person_ref: 'Lucas', fact_key: 'pet', fact_value: 'adopted a dog' }],
    saved_items: [], reminders: [], goals: [], birthdays: [],
  });

  function seedPeople(rows) { __seed('people', rows); }

  // ═══ 1. State machine: enqueue → one-active → strict FIFO ═════════════════
  println('state machine: one active per user, extras queue FIFO');
  __reset();
  const rowA = await enqueue({ userId: U, mention: { mention_text: 'Ana', proposed_name: 'Ana' }, candidates: [{ id: 'anna', name: 'Anna' }], heldPayload: { clarify: { askKind: 'near_match', newName: 'Ana', candidates: [{ id: 'anna', name: 'Anna' }] } } });
  const rowB = await enqueue({ userId: U, mention: { mention_text: 'Luka', proposed_name: 'Luka' }, candidates: [{ id: 'luca', name: 'Luca' }], heldPayload: { clarify: { askKind: 'near_match', newName: 'Luka', candidates: [{ id: 'luca', name: 'Luca' }] } } });
  check('two enqueued as pending', __rows('pending_clarifications').filter((r) => r.status === 'pending').length === 2);
  check('nothing active yet', (await getActive(U)) === null);
  const act1 = await activateNext(U, { askedMessageId: 'm0' });
  check('activateNext promotes the FIFO-first (Ana)', act1 && act1.clarification.mention_text === 'Ana');
  check('exactly one active now', __rows('pending_clarifications').filter((r) => r.status === 'active').length === 1);
  check('activateNext is a no-op while one is active', (await activateNext(U)) === null);
  const activeAna = await getActive(U);
  await resolveRow(activeAna.id, U, { resolution: 'same', resolvedPersonId: 'anna' });
  const act2 = await activateNext(U);
  check('after resolve, the NEXT (Luka) activates — strict FIFO', act2 && act2.clarification.mention_text === 'Luka');
  println('');

  // ═══ 2. dispatch: a near-match HOLDS the write and ASKS (no silent create) ═
  println('dispatch: near-match holds + asks one candidate-listing question');
  __reset(); seedPeople([{ id: 'luca', user_id: U, name: 'Luca', is_self: false }]);
  persistCalls = []; nextAsks = [nearAsk()];
  const d1 = await dispatch({ user, message, parsed: parsedWithFact('Noted.'), body: 'Lucas adopted a dog', inSuppression: false, deps });
  check('reply carries the candidate-listing question', /do you mean Luca/.test(d1.reply), d1.reply);
  check('no em dash / no exclamation in the reply', !/[—!]/.test(d1.reply), d1.reply);
  const held = __rows('pending_clarifications');
  check('a clarification row was created + activated', held.length === 1 && held[0].status === 'active');
  check('the fact was HELD (captured in held_payload), not persisted to Lucas',
    held[0].held_payload.writes.facts.length === 1 && persistCalls.every((c) => !(c.resolved.personByMention || {}).Lucas));
  check('no NEW Luca-family person was created for the held mention', __rows('people').length === 1);
  println('');

  // ═══ 3. dispatch: the reply "Luca" resolves SAME → apply held + alias ═════
  println('dispatch: answering "Luca" attaches the held write to Luca and aliases the spelling');
  persistCalls = []; nextAsks = [];
  const d2 = await dispatch({ user, message: { id: 'm2' }, parsed: { reply: 'ok', people: [], facts: [], saved_items: [], reminders: [], goals: [], birthdays: [] }, body: 'Luca', inSuppression: false, deps });
  check('reply confirms the save to Luca', /added that to Luca/.test(d2.reply), d2.reply);
  const resolvedRow = __rows('pending_clarifications')[0];
  check('clarification resolved as "same" to Luca', resolvedRow.status === 'resolved' && resolvedRow.resolution === 'same' && resolvedRow.resolved_person_id === 'luca');
  check('held write applied to Luca via persist', persistCalls.some((c) => (c.resolved.personByMention || {}).Lucas === 'luca' && (c.parsed.facts || []).length === 1));
  check('the new spelling "Lucas" was added as an alias of Luca (never re-ask)',
    (__rows('people').find((p) => p.id === 'luca').aliases || []).map((s) => s.toLowerCase()).includes('lucas'));
  println('');

  // ═══ 4. dispatch: the reply "someone new" resolves DIFFERENT → create ════
  println('dispatch: answering "someone new" creates a separate person and applies the held write');
  __reset(); seedPeople([{ id: 'luca', user_id: U, name: 'Luca', is_self: false }]);
  persistCalls = []; nextAsks = [nearAsk()];
  await dispatch({ user, message: { id: 'm3' }, parsed: parsedWithFact('Noted.'), body: 'Lucas adopted a dog', inSuppression: false, deps });
  persistCalls = []; nextAsks = [];
  const d4 = await dispatch({ user, message: { id: 'm4' }, parsed: { reply: 'ok', people: [], facts: [], saved_items: [], reminders: [], goals: [], birthdays: [] }, body: 'someone new', inSuppression: false, deps });
  check('reply confirms a new person', /saved Lucas as someone new/.test(d4.reply), d4.reply);
  const lucasRow = __rows('people').find((p) => p.name === 'Lucas');
  check('a NEW person "Lucas" was created', !!lucasRow);
  check('held write applied to the NEW Lucas', persistCalls.some((c) => lucasRow && (c.resolved.personByMention || {}).Lucas === lucasRow.id));
  check('clarification resolved as "different"', __rows('pending_clarifications')[0].resolution === 'different');
  println('');

  // ═══ 5. CRISIS bypasses a pending clarification (never consumed) ══════════
  println('crisis: a suppressed turn never consumes/resolves the active clarification');
  __reset(); seedPeople([{ id: 'luca', user_id: U, name: 'Luca', is_self: false }]);
  __seed('pending_clarifications', [{
    id: 'c-active', user_id: U, status: 'active', proposed_name: 'Lucas',
    question_text: 'Quick check: is Lucas a new person, or do you mean Luca?',
    held_payload: { clarify: { candidates: [{ id: 'luca', name: 'Luca' }] } }, reask_count: 0,
  }]);
  persistCalls = [];
  const crisisReply = 'If you are in danger, call 988.';
  const dc = await dispatch({ user, message: { id: 'm5' }, parsed: { reply: crisisReply, _suppressPersistence: true }, body: 'I want to die', inSuppression: false, deps });
  check('crisis reply is returned verbatim', dc.reply === crisisReply);
  const stillActive = await getActive(U);
  check('the clarification is STILL active (not consumed or resolved)', stillActive && stillActive.id === 'c-active' && stillActive.status === 'active');
  check('nothing was persisted on the crisis turn', persistCalls.length === 0);
  println('');

  // ═══ 6. Suppression window: no ask / re-ask sent, but the hold is queued ══
  println('suppression window: no question is sent, the ambiguous write is held for later');
  __reset(); seedPeople([{ id: 'luca', user_id: U, name: 'Luca', is_self: false }]);
  persistCalls = []; nextAsks = [nearAsk()];
  const dsupp = await dispatch({ user, message: { id: 'm6' }, parsed: parsedWithFact('Noted.'), body: 'Lucas adopted a dog', inSuppression: true, deps });
  check('reply carries NO question while in the suppression window', !/do you mean/.test(dsupp.reply), dsupp.reply);
  check('the ambiguous mention is still HELD (queued pending), not lost', __rows('pending_clarifications').length === 1 && __rows('pending_clarifications')[0].status === 'pending');
  println('');

  // ═══ 7. Timeout → default CREATE (never a guessed merge) ═════════════════
  println('expiry sweep: a held question past its TTL resolves to a NEW person');
  __reset(); seedPeople([{ id: 'luca', user_id: U, name: 'Luca', is_self: false }]);
  __seed('pending_clarifications', [{
    id: 'c-expired', user_id: U, status: 'active', proposed_name: 'Lucas', proposed_relationship: null,
    expires_at: new Date(Date.now() - 3600 * 1000).toISOString(),
    held_payload: { clarify: { newName: 'Lucas', candidates: [{ id: 'luca', name: 'Luca' }] }, writes: { source_message_id: 'm0', person: { mention_text: 'Lucas' }, facts: [{ person_ref: 'Lucas', fact_key: 'pet', fact_value: 'adopted a dog' }], saved_items: [], reminders: [], goals: [], birthdays: [] } },
  }]);
  persistCalls = [];
  const sweep = await sweepExpired({ persist: fakePersist, loadUser: async () => user });
  check('one expired clarification was swept', sweep.resolved === 1);
  const created = __rows('people').find((p) => p.name === 'Lucas');
  check('a NEW person "Lucas" was created (default create, not a merge into Luca)', !!created && created.id !== 'luca');
  check('the held write was applied to the new person', persistCalls.some((c) => created && (c.resolved.personByMention || {}).Lucas === created.id));
  check('the row resolved as expired_default_new', __rows('pending_clarifications').find((r) => r.id === 'c-expired').resolution === 'expired_default_new');
  println('');

  // ═══ 8. authorQuestion voice compliance ══════════════════════════════════
  println('question authoring: candidate-listing, EN, no em dash / exclamation');
  const qNear = authorQuestion({ askKind: 'near_match', newName: 'Luka', candidates: [{ name: 'Luca' }, { name: 'Lucas' }] });
  check('near-match lists both candidates', /Luca/.test(qNear) && /Lucas/.test(qNear), qNear);
  check('offers a new-person option', /new person/.test(qNear), qNear);
  check('no em dash, no exclamation', !/[—!]/.test(qNear), qNear);
  const qFrag = authorQuestion({ askKind: 'near_match', newName: 'Luc', candidates: [{ name: 'Luca' }, { name: 'Lucas' }, { name: 'Luka' }] });
  check('a short fragment leads with "Did you mean"', /Did you mean/.test(qFrag), qFrag);
  const qBare = authorQuestion({ askKind: 'bare_name', newName: 'Luca', candidates: [{ name: 'Luca', relationship: 'brother' }, { name: 'Luca', relationship: 'coworker' }] });
  check('bare-name asks which, by relationship tag', /Which Luca/.test(qBare) && /brother/.test(qBare), qBare);

  // Phase 2b: same-first-name candidates carry last_initial -> "Which Luca: C. or M.?"
  const qBareInit = authorQuestion({ askKind: 'bare_name', newName: 'Luca', candidates: [{ name: 'Luca', last_initial: 'C.', relationship: 'brother' }, { name: 'Luca', last_initial: 'M.', relationship: 'coworker' }] });
  check('bare-name with last-initials -> "Which Luca: C. or M.?"', /Which Luca: C\. or M\./.test(qBareInit), qBareInit);
  // near-match candidates that collide on first name disambiguate with the initial
  const qNearInit = authorQuestion({ askKind: 'near_match', newName: 'Luka', candidates: [{ name: 'Luca', last_initial: 'C.' }, { name: 'Luca', last_initial: 'M.' }] });
  check('near-match colliding candidates render "Luca C." and "Luca M."', /Luca C\./.test(qNearInit) && /Luca M\./.test(qNearInit), qNearInit);

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
