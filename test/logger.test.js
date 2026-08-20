// Proof: the logger separates a sensitivity-flagged event from its content, and
// redacts PII/secrets. Concatenated after reliability-core.js + stripped
// src/utils/logger.js. Runs under jsc or node/bun.

(async () => {
  const { check, done } = makeChecker();

  println('logger: sensitivity lane keeps the event, drops the content');
  const r = buildLogRecord('warn', 'safety.category_fired', {
    sensitivity: 'restricted', category: 'A', user_ref: 'u_1',
    message: 'the user disclosed self-harm intent tonight',
    meta: { disclosure: 'raw sensitive content' },
  });
  check('event name preserved', r.event === 'safety.category_fired');
  check('sensitivity flag present', r.sensitivity === 'restricted');
  check('structural field kept (category)', r.category === 'A');
  check('user_ref kept', r.user_ref === 'u_1');
  check('content dropped — no message', !('message' in r));
  check('content dropped — no meta', !('meta' in r));

  println('logger: normal event redacts phone + secrets, keeps body_len');
  // Key assembled at runtime: a fixture shaped like a live credential trips
  // secret scanners, and the rule under test matches on SHAPE, so the shape
  // built here exercises it identically. See test/scrub-timestamps.test.mjs.
  const FAKE_KEY = 'sk' + '-ABCDEF0123456789';
  const n = buildLogRecord('info', 'reminder.sent', {
    message: 'sent to 17869727469 with key ' + FAKE_KEY + ' ok', body_len: 42,
  });
  check('phone reduced to last-4', /\[phone:7469\]/.test(n.message) && !/17869727469/.test(n.message));
  check('secret stripped', /\[secret\]/.test(n.message) && !n.message.includes('ABCDEF0123456789'));
  check('body_len kept', n.body_len === 42);
  check('no raw body/phone field leaks', !('body' in n) && !('phone' in n));

  println('logger: disallowed field is dropped (structured-first)');
  const d = buildLogRecord('info', 'x.y', { phone: '17869727469', outcome: 'sent' });
  check('unknown key `phone` not emitted', !('phone' in d));
  check('allow-listed key `outcome` emitted', d.outcome === 'sent');

  println('logger: error/fatal always carry an error_category');
  const e = buildLogRecord('error', 'x.failed', { message: 'boom' });
  check('error gets default category', e.error_category === 'internal');

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
