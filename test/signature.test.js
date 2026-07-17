// Proof: the Twilio signature check rejects unsigned/forged requests, builds the
// signed URL from PUBLIC_BASE_URL (never the Host header), and fails closed when
// PUBLIC_BASE_URL is unset. Concatenated after reliability-core.js +
// prelude-twilio.js + stripped src/lib/twilio.js.

(async () => {
  const { check, done } = makeChecker();
  const mkReq = (sig) => ({
    header: (h) => (h === 'X-Twilio-Signature' ? sig : null),
    originalUrl: '/sms/inbound',
    headers: { host: 'attacker.evil' }, // must NOT be used
    body: {},
  });

  println('twilio: an unsigned inbound request is rejected');
  __validateResult = true;
  check('no signature header → reject', validateTwilioSignature(mkReq(null)) === false);

  println('twilio: the signed URL comes from PUBLIC_BASE_URL, not the Host header');
  __validateResult = true;
  validateTwilioSignature(mkReq('somesig'));
  check('signed URL uses configured base (not Host)', __lastArgs && __lastArgs.url === 'https://cedrus.example/sms/inbound', __lastArgs && __lastArgs.url);

  println('twilio: fail closed when PUBLIC_BASE_URL is unset while validating');
  config.publicBaseUrl = '';
  check('missing base → reject (no Host fallback)', validateTwilioSignature(mkReq('somesig')) === false);
  config.publicBaseUrl = 'https://cedrus.example';

  println('twilio: an invalid signature is rejected');
  __validateResult = false;
  check('bad signature → reject', validateTwilioSignature(mkReq('badsig')) === false);

  println('twilio: the local-dev bypass returns true only when explicitly enabled');
  __validateResult = false; config.validateTwilioSignature = false;
  check('bypass on → accept (dev only)', validateTwilioSignature(mkReq(null)) === true);
  config.validateTwilioSignature = true;

  println('twilio: statusCallbackUrl derives from PUBLIC_BASE_URL');
  check('status callback url', statusCallbackUrl() === 'https://cedrus.example/sms/status');

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
