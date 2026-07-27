// Bundle 23 — relationship-memory writes announce their failures.
//
// logContact() and linkMessagePerson() discarded the Supabase error without
// binding it. supabase-js resolves { data, error } rather than throwing, so a
// failed write produced no exception, no log, and an ordinary-looking resolve.
//
// Two consequences, both proven here:
//   1. The failure was invisible.
//   2. The try/catch around logContact() at 07_persist.js:97 is DECORATIVE —
//      it can never fire for a Supabase error, because nothing throws one.
//
// contact_events is not bookkeeping: its DB trigger freshens
// people.last_contact_at, which since 2026-07-27 is finally visible on the
// person panel as "Last touch". A dropped row silently freezes that field.
//
// Logging only. Neither function throws, before or after, so the persist loop
// keeps its "one bad item can't poison the rest of the message" behaviour.
// Every case pins BOTH the resolve behaviour AND whether an event was emitted.

(async () => {
  const { check, done } = makeChecker();

  println('\n── 1. logContact: insert fails → resolves quietly, but LOGS ──');
  __reset();
  __setTable('contact_events', { error: { code: '23503', message: 'insert or update violates foreign key constraint' } });
  let threw = false;
  try { await logContact({ userId: 'u1', personId: 'p1', sourceMessageId: 'm1' }); }
  catch { threw = true; }
  check('does NOT throw (control flow unchanged)', threw === false);
  check('emitted exactly one event', __events.length === 1, JSON.stringify(__events));
  check('event is relationships.write.failed', __events[0].name === 'relationships.write.failed', __eventText(0));
  check('carries error_code (the SQLSTATE)', __events[0].fields.error_code === '23503', __eventText(0));
  check('carries err.message', __eventText(0).indexOf('foreign key') >= 0, __eventText(0));
  check('names contact_events as the table that was dropped',
    __eventText(0).indexOf('contact_events') >= 0, __eventText(0));
  check('carries user_ref and person_ref',
    __events[0].fields.user_ref === 'u_u1' && __events[0].fields.person_ref === 'p_p1', __eventText(0));

  println('\n── 2. logContact: success → writes, and stays SILENT ──');
  __reset();
  await logContact({ userId: 'u1', personId: 'p1', sourceMessageId: 'm1' });
  check('the row actually reached contact_events (fixture is live, not vacuous)',
    __writes.length === 1 && __writes[0].table === 'contact_events' && __writes[0].op === 'insert',
    JSON.stringify(__writes));
  check('emitted NOTHING (one line per inbound mention would be noise)',
    __events.length === 0, JSON.stringify(__events));

  println('\n── 3. linkMessagePerson: upsert fails → resolves quietly, but LOGS ──');
  __reset();
  __setTable('message_people', { error: { code: '42501', message: 'permission denied for table message_people' } });
  threw = false;
  try { await linkMessagePerson({ messageId: 'm1', userId: 'u1', personId: 'p2', mentionText: 'Luca', contactSignal: 'implied_contact' }); }
  catch { threw = true; }
  check('does NOT throw', threw === false);
  check('emitted exactly one event', __events.length === 1, JSON.stringify(__events));
  check('names message_people', __eventText(0).indexOf('message_people') >= 0, __eventText(0));
  check('carries error_code', __events[0].fields.error_code === '42501', __eventText(0));

  println('\n── 4. linkMessagePerson: success → upserts, and stays SILENT ──');
  __reset();
  await linkMessagePerson({ messageId: 'm1', userId: 'u1', personId: 'p2', mentionText: 'Luca' });
  check('the row actually reached message_people via upsert',
    __writes.length === 1 && __writes[0].table === 'message_people' && __writes[0].op === 'upsert',
    JSON.stringify(__writes));
  check('emitted NOTHING', __events.length === 0, JSON.stringify(__events));

  println('\n── 5. The two writes are independent ──');
  // A failing contact_events must not suppress the message_people log, and
  // vice versa — they are reported per call site, not once per message.
  __reset();
  __setTable('contact_events', { error: { code: '08006', message: 'connection failure' } });
  await linkMessagePerson({ messageId: 'm1', userId: 'u1', personId: 'p3' });
  await logContact({ userId: 'u1', personId: 'p3' });
  check('message_people still succeeded and stayed silent',
    __writes.length === 1 && __writes[0].table === 'message_people');
  check('only the failing contact_events logged', __events.length === 1 &&
    __eventText(0).indexOf('contact_events') >= 0, JSON.stringify(__events));

  println('\n── 6. THE DISCRIMINATOR — the bug itself, encoded ──');
  // Before the fix, success and failure were the same observation: an
  // undefined resolve and an empty log.
  __reset();
  const okReturn = await logContact({ userId: 'u1', personId: 'p1' });
  const okEvents = __events.length;

  __reset();
  __setTable('contact_events', { error: { code: '42P01', message: 'relation "contact_events" does not exist' } });
  const failReturn = await logContact({ userId: 'u1', personId: 'p1' });
  const failEvents = __events.length;

  check('both still return the same thing (no contract change)',
    okReturn === failReturn && okReturn === undefined,
    `ok=${JSON.stringify(okReturn)} fail=${JSON.stringify(failReturn)}`);
  check('but they are now DISTINGUISHABLE: success=0 events, failure=1 event',
    okEvents === 0 && failEvents === 1, `ok=${okEvents} fail=${failEvents}`);

  println('');
  const f = done();
  println(f === 0 ? 'ALL RELATIONSHIPS-WRITE TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
