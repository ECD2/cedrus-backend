// Proof: a duplicate signed inbound (same Twilio MessageSid) is a no-op.
// Concatenated after reliability-core.js + reliability-stubs.js (for the `people`
// double) + stripped src/services/messages.js.

(async () => {
  const { check, done } = makeChecker();

  __reset();
  println('messages: first inbound is stored, not a duplicate');
  const first = await logInbound({ userId: 'u1', body: 'hi', messageSid: 'SMdup1', numSegments: 1 });
  check('first is not duplicate', first.duplicate === false);
  check('one row stored', __rows('messages').length === 1);

  println('messages: replayed webhook with the SAME MessageSid is a no-op');
  const second = await logInbound({ userId: 'u1', body: 'hi', messageSid: 'SMdup1', numSegments: 1 });
  check('second is flagged duplicate', second.duplicate === true);
  check('still only one row stored', __rows('messages').length === 1);
  check('duplicate returns the original row', second.message && second.message.provider_message_id === 'SMdup1');

  println('messages: a different MessageSid is stored normally');
  const third = await logInbound({ userId: 'u1', body: 'yo', messageSid: 'SMdup2', numSegments: 1 });
  check('different sid not duplicate', third.duplicate === false);
  check('now two rows stored', __rows('messages').length === 2);

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
