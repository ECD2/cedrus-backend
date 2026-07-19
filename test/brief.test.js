// Proof: a weekly brief is never marked sent without a confirmed send, and a
// failed send leaves it retryable (never silently lost). Concatenated after
// reliability-core.js + reliability-stubs.js + stripped src/jobs/weeklyBrief.js.

(async () => {
  const { check, done } = makeChecker();
  const user = { id: 'u1', phone: '17860000000', timezone: 'America/New_York' };

  println('brief: marked sent ONLY after a successful send (order: send → markSent)');
  __db.briefs = []; __calls.length = 0; __sendMode = 'ok';
  await sendBriefTo(user, new Date('2030-01-01T00:00:00Z'));
  const sendIdx = __calls.indexOf('sendSms');
  const markIdx = __calls.indexOf('markSent');
  check('sendSms happened', sendIdx >= 0);
  check('markSent happened', markIdx >= 0);
  check('send BEFORE markSent', sendIdx >= 0 && markIdx >= 0 && sendIdx < markIdx, __calls.join(','));
  check('brief status is sent', __db.briefs[0].status === 'sent');

  println('brief: a failed send leaves the brief retryable (status stays generated)');
  __db.briefs = []; __calls.length = 0; __sendMode = 'throw';
  let threw = false;
  try { await sendBriefTo(user, new Date('2030-01-01T00:00:00Z')); } catch (_e) { threw = true; }
  check('send failure propagates so the hourly tick retries', threw);
  check('markSent was NOT called', __calls.indexOf('markSent') === -1, __calls.join(','));
  check('brief still generated (never silently marked sent)', __db.briefs[0].status === 'generated');

  println('brief: the job consults the §6 suppression window and threads the flag');
  __db.briefs = []; __calls.length = 0; __sendMode = 'ok'; __suppressionActive = false; __selectOpts = null;
  await sendBriefTo(user, new Date('2030-01-01T00:00:00Z'));
  check('suppression window consulted', __calls.indexOf('isInSuppressionWindow') >= 0, __calls.join(','));
  check('flag false outside the window', __selectOpts && __selectOpts.suppressPromo === false, JSON.stringify(__selectOpts));

  __db.briefs = []; __calls.length = 0; __suppressionActive = true; __selectOpts = null;
  await sendBriefTo(user, new Date('2030-01-01T00:00:00Z'));
  check('flag true inside the window', __selectOpts && __selectOpts.suppressPromo === true, JSON.stringify(__selectOpts));
  check('brief STILL sends inside the window (person not paused)', __calls.indexOf('sendSms') >= 0 && __db.briefs[0].status === 'sent');
  __suppressionActive = false;

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
