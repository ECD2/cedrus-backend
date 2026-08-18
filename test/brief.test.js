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

  println('brief: a DRY RUN records a rehearsal, never a delivery');
  // BRIEF_DRY_RUN means nothing goes on the wire. Three writes were happening
  // anyway, and app_users.total_briefs_sent is why a non-allowlisted user reads
  // total_briefs_sent=3 for messages that never existed.
  // __db.messages ACCUMULATES across sections in this rig — reset it, or the
  // assertion below reads a row left by the real-send test above and passes
  // or fails for the wrong reason.
  __db.briefs = []; __db.messages = []; __calls.length = 0; __sendMode = 'ok'; config.briefDryRun = true;
  await sendBriefTo(user, new Date('2030-01-01T00:00:00Z'));
  check('DRY RUN: sendSms never called', __calls.indexOf('sendSms') === -1, __calls.join(','));
  check('DRY RUN: recordBriefSent NOT called (total_briefs_sent must not move)',
    __calls.indexOf('recordBriefSent') === -1, __calls.join(','));
  check('DRY RUN: openPendingPrompt NOT called (nobody received the question)',
    __calls.indexOf('openPendingPrompt') === -1, __calls.join(','));
  // The rehearsal IS still recorded — in the place that was already honest.
  check('DRY RUN: the rehearsal is recorded via logOutbound', __calls.indexOf('logOutbound') >= 0, __calls.join(','));
  // The stub records the raw argument object, so the key is the camelCase
  // `providerStatus` the job passes — not the snake_case column name.
  check('DRY RUN: providerStatus is dry_run, not queued',
    __db.messages.length === 1 && __db.messages[0].providerStatus === 'dry_run',
    JSON.stringify(__db.messages[0]));
  check('DRY RUN: no provider message id is invented',
    __db.messages[0].providerMessageId === null, JSON.stringify(__db.messages[0]));
  // markSent still runs: hasBriefForWeek() treats 'sent' as the re-dispatch
  // guard, so leaving it 'generated' would recompose the same brief every hour.
  check('DRY RUN: markSent STILL runs (re-dispatch guard, not a delivery claim)',
    __calls.indexOf('markSent') >= 0 && __db.briefs[0].status === 'sent', __calls.join(','));

  println('brief: CONTROL — a real send does all three');
  __db.briefs = []; __db.messages = []; __calls.length = 0; config.briefDryRun = false;
  await sendBriefTo(user, new Date('2030-01-01T00:00:00Z'));
  check('CONTROL: sendSms called', __calls.indexOf('sendSms') >= 0, __calls.join(','));
  check('CONTROL: recordBriefSent IS called on a real delivery',
    __calls.indexOf('recordBriefSent') >= 0, __calls.join(','));
  check('CONTROL: openPendingPrompt IS called on a real delivery',
    __calls.indexOf('openPendingPrompt') >= 0, __calls.join(','));
  check('CONTROL: a real send records providerStatus queued, not dry_run',
    __db.messages.length === 1 && __db.messages[0].providerStatus === 'queued',
    JSON.stringify(__db.messages[0]));

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
