// Bundle 20 — §6 suppression read: the abnormal branches must announce themselves.
//
// This is the FIRST test anywhere to exercise the real src/services/safetyFlags.js.
// Every other suite in the repo injects its own isInSuppressionWindow stub, so
// until now the module had zero coverage — which is precisely how it stayed inert
// in production for its entire life without anyone noticing.
//
// The defect this locks down is not "it returned the wrong value". It returned
// `false`, which was a legitimate answer. The defect was that `false` meant four
// different things and the function could not say which:
//
//   1. the query ERRORED            → abnormal, must LOG
//   2. no app_users row was found   → abnormal, must LOG
//   3. the column was NULL          → the legitimate "no window", must STAY SILENT
//   4. the call THREW               → abnormal, must LOG
//
// Case 3 must stay silent on purpose: it is the overwhelmingly common answer, and
// logging it would emit one line per user per job run — noise that gets filtered,
// which is how the original signal was lost.
//
// Control flow is unchanged by the fix: all four still return false, and the guard
// still fails OPEN. These assertions pin BOTH halves — the returned value AND
// whether a line was emitted — so a future refactor cannot quietly re-merge the
// branches, and cannot "helpfully" start logging the NULL case either.

(async () => {
  const { check, done } = makeChecker();

  println('\n── 1. query error: returns false AND logs ──');
  __reset();
  __setOutcome({ data: null, error: { code: '42703', message: 'column "crisis_suppressed_until" does not exist' } });
  let r = await isInSuppressionWindow('u-error');
  check('returns false (still fails OPEN)', r === false, 'got ' + r);
  check('emitted exactly one warn', __logs.length === 1, JSON.stringify(__logs));
  check('log carries err.code (the SQLSTATE)', __logs[0].indexOf('42703') >= 0, __logs[0]);
  check('log carries err.message', __logs[0].indexOf('does not exist') >= 0, __logs[0]);

  println('\n── 2. no app_users row: returns false AND logs ──');
  __reset();
  __setOutcome({ data: null, error: null });
  r = await isInSuppressionWindow('u-ghost');
  check('returns false', r === false, 'got ' + r);
  check('emitted exactly one warn', __logs.length === 1, JSON.stringify(__logs));
  check('log identifies the user', __logs[0].indexOf('u-ghost') >= 0, __logs[0]);

  println('\n── 3. NULL column — the legitimate "no window": false, and SILENT ──');
  __reset();
  __setOutcome({ data: { crisis_suppressed_until: null }, error: null });
  r = await isInSuppressionWindow('u-quiet');
  check('returns false', r === false, 'got ' + r);
  check('emitted NOTHING (1 line/user/job run would be pure noise)',
    __logs.length === 0, JSON.stringify(__logs));

  println('\n── 4. open window: returns TRUE ──');
  __reset();
  __setOutcome({ data: { crisis_suppressed_until: new Date(Date.now() + 3600e3).toISOString() }, error: null });
  r = await isInSuppressionWindow('u-open');
  check('returns TRUE', r === true, 'got ' + r);
  check('and stays silent (nothing abnormal happened)', __logs.length === 0, JSON.stringify(__logs));

  println('\n── 5. thrown exception: returns false AND logs ──');
  __reset();
  const boom = new Error('socket hang up');
  boom.code = 'ECONNRESET';
  __setThrow(boom);
  r = await isInSuppressionWindow('u-throw');
  check('returns false (still fails OPEN)', r === false, 'got ' + r);
  check('emitted exactly one warn', __logs.length === 1, JSON.stringify(__logs));
  check('log carries the thrown message', __logs[0].indexOf('socket hang up') >= 0, __logs[0]);

  println('\n── 6. expired window: false via the EXPIRY branch, and silent ──');
  __reset();
  __setOutcome({ data: { crisis_suppressed_until: new Date(Date.now() - 3600e3).toISOString() }, error: null });
  r = await isInSuppressionWindow('u-expired');
  check('returns false', r === false, 'got ' + r);
  check('stays silent (an expired window is normal, not a fault)',
    __logs.length === 0, JSON.stringify(__logs));

  println('\n── 7. THE DISCRIMINATOR — the bug itself, encoded ──');
  // Before the fix these two produced an identical, unobservable `false`.
  // The suite is only meaningful if that is no longer true.
  __reset();
  __setOutcome({ data: { crisis_suppressed_until: null }, error: null });
  const healthyFalse = await isInSuppressionWindow('u-x');
  const healthyLogs = __logs.length;

  __reset();
  __setOutcome({ data: null, error: { code: '42P01', message: 'relation "app_users" does not exist' } });
  const brokenFalse = await isInSuppressionWindow('u-x');
  const brokenLogs = __logs.length;

  check('both still return the same value (control flow unchanged)',
    healthyFalse === false && brokenFalse === false);
  check('but they are now DISTINGUISHABLE: healthy=0 logs, broken=1 log',
    healthyLogs === 0 && brokenLogs === 1, `healthy=${healthyLogs} broken=${brokenLogs}`);

  println('');
  const f = done();
  println(f === 0 ? 'ALL SUPPRESSION-READ TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
