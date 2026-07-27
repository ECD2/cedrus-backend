// Bundle 24 — memory.js announces its two silent failures.
//
// (1) FACT SUPERSESSION, memory.js:80. addFact retires the prior value of a
//     single-valued slot, then inserts the new one. The insert throws on error;
//     the retirement did not even BIND one. If retirement fails and the insert
//     succeeds, the person ends up with two current values for one slot — the
//     "corrections stacked instead of superseding" bug (NOTES.md Part 1b),
//     silently reintroduced, with the invariant that test/fact-supersession.test.js
//     is supposed to lock quietly broken in prod.
//
//     Control flow is deliberately UNCHANGED: the new fact still saves. Losing
//     the user's latest correction would be worse than a duplicate. That makes
//     the log the only thing between a broken invariant and nobody knowing —
//     and makes "should addFact fail closed here?" a real open question (flag 20).
//
// (2) GOAL READS, memory.js getOpenGoals / getOpenGoalsThisWeek. Both collapsed
//     a failed query into `data || []` with the error discarded, so "no open
//     intentions" and "could not find out" were the same empty array. getOpenGoals
//     feeds THREE consumers (brief/gather, insights, discovery), so a silent
//     failure drops the user's own stated intentions out of the weekly brief.
//     Still returns [] — a brief without goals beats no brief — but it says so.

(async () => {
  const { check, done } = makeChecker();

  println('\n── 1. supersession fails: fact STILL saves, and it LOGS ──');
  __reset();
  __setOp('facts.update', { error: { code: '40001', message: 'could not serialize access due to concurrent update' } });
  let threw = false;
  try { await addFact({ userId: 'u1', personId: 'p1', factType: 'context', factKey: 'relationship', factValue: 'girlfriend' }); }
  catch { threw = true; }
  check('addFact does NOT throw (control flow unchanged)', threw === false);
  check('the retirement update really was attempted', __ran('facts', 'update'));
  check('and the insert STILL happened (the correction is not lost)', __ran('facts', 'insert'));
  check('emitted exactly one event', __events.length === 1, JSON.stringify(__events));
  check('event is facts.supersede.failed', __events[0].name === 'facts.supersede.failed', __eventText(0));
  check('carries error_code', __events[0].fields.error_code === '40001', __eventText(0));
  check('carries err.message', __eventText(0).indexOf('serialize access') >= 0, __eventText(0));
  check('names the slot at risk', __eventText(0).indexOf('relationship') >= 0, __eventText(0));
  check('flags the invariant, not just the error',
    __events[0].fields.outcome === 'invariant_at_risk' &&
    __eventText(0).indexOf('MORE THAN ONE current value') >= 0, __eventText(0));

  println('\n── 2. supersession succeeds → SILENT ──');
  __reset();
  await addFact({ userId: 'u1', personId: 'p1', factType: 'context', factKey: 'relationship', factValue: 'wife' });
  check('both statements ran', __ran('facts', 'update') && __ran('facts', 'insert'));
  check('emitted NOTHING (every single-valued fact write would log otherwise)',
    __events.length === 0, JSON.stringify(__events));

  println('\n── 3. a multi-valued slot never supersedes, so never logs ──');
  __reset();
  await addFact({ userId: 'u1', personId: 'p1', factType: 'interest', factKey: 'music', factValue: 'jazz' });
  check('no retirement attempted for a multi-valued key', !__ran('facts', 'update'));
  check('insert happened', __ran('facts', 'insert'));
  check('silent', __events.length === 0, JSON.stringify(__events));

  println('\n── 4. the insert still THROWS on error (unchanged) ──');
  __reset();
  __setOp('facts.insert', { error: { code: '22007', message: 'invalid input syntax for type timestamp' } });
  threw = false;
  try { await addFact({ userId: 'u1', personId: 'p1', factType: 'context', factKey: 'city', factValue: 'Miami' }); }
  catch { threw = true; }
  check('addFact throws when the INSERT fails (persist catches it upstream)', threw === true);

  println('\n── 5. getOpenGoals: read fails → [] AND logs ──');
  __reset();
  __setOp('user_goals.select', { error: { code: '42703', message: 'column "origin" does not exist' } });
  let goals = await getOpenGoals('u1');
  check('still returns an array (degrade, do not fail the brief)', Array.isArray(goals) && goals.length === 0);
  check('emitted exactly one event', __events.length === 1, JSON.stringify(__events));
  check('event is goals.read.failed', __events[0].name === 'goals.read.failed', __eventText(0));
  check('carries error_code', __events[0].fields.error_code === '42703', __eventText(0));
  check('names the function so three consumers can be told apart',
    __eventText(0).indexOf('getOpenGoals') >= 0, __eventText(0));

  println('\n── 6. getOpenGoals: real rows → returned, and SILENT ──');
  __reset();
  __setOp('user_goals.select', { rows: [{ id: 'g1', goal_text: 'call Ana', person_id: 'p1', week_of: '2026-07-20', status: 'open' }] });
  goals = await getOpenGoals('u1');
  check('returns the rows (fixture is live, not vacuous)', goals.length === 1 && goals[0].id === 'g1', JSON.stringify(goals));
  check('silent', __events.length === 0, JSON.stringify(__events));

  println('\n── 7. getOpenGoalsThisWeek behaves the same ──');
  __reset();
  __setOp('user_goals.select', { error: { code: '08006', message: 'connection failure' } });
  const wk = await getOpenGoalsThisWeek('u1', '2026-07-27');
  check('returns []', Array.isArray(wk) && wk.length === 0);
  check('logs, naming its own function',
    __events.length === 1 && __eventText(0).indexOf('getOpenGoalsThisWeek') >= 0, __eventText(0));

  println('\n── 8. THE DISCRIMINATOR — the bug itself, encoded ──');
  // "no open goals" and "the goals query failed" were the same empty array.
  __reset();
  const emptyReal = await getOpenGoals('u1');
  const emptyRealEvents = __events.length;

  __reset();
  __setOp('user_goals.select', { error: { code: '42501', message: 'permission denied' } });
  const emptyBroken = await getOpenGoals('u1');
  const emptyBrokenEvents = __events.length;

  check('both still return an empty array (no contract change)',
    emptyReal.length === 0 && emptyBroken.length === 0);
  check('but they are now DISTINGUISHABLE: genuine=0 events, broken=1 event',
    emptyRealEvents === 0 && emptyBrokenEvents === 1,
    `genuine=${emptyRealEvents} broken=${emptyBrokenEvents}`);

  println('');
  const f = done();
  println(f === 0 ? 'ALL MEMORY-SILENT TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
