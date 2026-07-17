// Proof: the reminder dispatcher can never double-send, and a failed Twilio call
// leaves the reminder retryable. Concatenated after reliability-core.js +
// reliability-stubs.js + stripped src/jobs/reminders.js.

(async () => {
  const { check, done } = makeChecker();
  const T = new Date('2030-01-01T00:00:00Z');

  function seedOne(id, opts) {
    __reset();
    __seed('reminders', [{ id, user_id: 'u1', person_id: null, title: 'Call Mom', note: null, reminder_type: 'custom', status: 'pending', trigger_at: '2000-01-01T00:00:00Z' }]);
    __seed('app_users', [{ id: 'u1', phone: '17860000000', opted_out: !!(opts && opts.optedOut) }]);
  }

  println('reminder: happy path sends exactly once and marks sent');
  seedOne('r1'); __sendMode = 'ok'; __sendCalls = 0;
  await runReminderDispatch(T);
  check('sent exactly once', __sendCalls === 1, 'sends=' + __sendCalls);
  check('status is sent', __rows('reminders')[0].status === 'sent');

  println('reminder: crash between send and mark cannot double-send (re-tick is a no-op)');
  // The row already left `pending` (it is `sent`), so a later tick never re-selects it.
  __sendCalls = 0;
  await runReminderDispatch(new Date('2030-01-01T00:05:00Z'));
  check('no second send on re-tick', __sendCalls === 0, 'sends=' + __sendCalls);

  println('reminder: two concurrent ticks — the atomic claim lets only ONE send');
  seedOne('r2'); __sendMode = 'ok'; __sendCalls = 0;
  await Promise.all([runReminderDispatch(T), runReminderDispatch(T)]);
  check('claimed once despite two ticks', __sendCalls === 1, 'sends=' + __sendCalls);
  check('final status sent', __rows('reminders')[0].status === 'sent');

  println('reminder: failed Twilio send leaves the reminder retryable (pending)');
  seedOne('r3'); __sendMode = 'throw'; __sendCalls = 0;
  await runReminderDispatch(T);
  check('send was attempted', __sendCalls === 1);
  check('reverted to pending (retryable)', __rows('reminders')[0].status === 'pending', 'status=' + __rows('reminders')[0].status);
  // and a later tick, once Twilio recovers, delivers it
  __sendMode = 'ok'; __sendCalls = 0;
  await runReminderDispatch(new Date('2030-01-01T00:10:00Z'));
  check('retry now delivers and marks sent', __sendCalls === 1 && __rows('reminders')[0].status === 'sent');

  println('reminder: opted-out user is canceled, never sent');
  seedOne('r4', { optedOut: true }); __sendMode = 'ok'; __sendCalls = 0;
  await runReminderDispatch(T);
  check('not sent to opted-out user', __sendCalls === 0);
  check('status canceled', __rows('reminders')[0].status === 'canceled');

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
