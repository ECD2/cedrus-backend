// Bundle 32 — STAGE B2.6 (card replies) obeys the pipeline's safety ordering.
//
// Same concat as Bundle 22/29 (real safetyDetection.js + selfName.js +
// pipeline/index.js over prelude doubles) with the __cardResult knob. Order
// under proof:
//
//   compliance (STOP) > crisis pre-check > CARD REPLIES > cap > budget > model
//
//   • a crisis message NEVER touches card state and still gets 988,
//   • a card reply is processed even over cap and over budget (fixed
//     template, no model, bounded by the awaiting-card set),
//   • a non-vocab message flows through untouched.

(async () => {
  const { check, done } = makeChecker();

  const CRISIS = 'i want to kill myself';
  const ORDINARY = 'had dinner with Luca, his sister visits next month';
  const CARD_ACK = 'No problem, skipping that one.';
  const HANDLED = { handled: true, reply: CARD_ACK };
  const PAUSED = { paused: true, reason: 'tokens', degraded: false };

  const run = (body) => runInboundPipeline({ from: '+15550001111', body: body, messageSid: 'SM1', numSegments: 1 });

  println('\n── 1. A handled card reply short-circuits before cap and budget ──');
  __reset({ cardResult: HANDLED });
  let reply = await run('SKIP');
  check('returns the card ack', reply === CARD_ACK, JSON.stringify(reply));
  check('logged as messageType card_reply', __lastOut() && __lastOut().type === 'card_reply');
  check('the model was never invoked', __openaiInvocations.length === 0);
  check('neither the cap nor the budget gate was consulted',
    __calls.indexOf('checkRateLimit') === -1 && __calls.indexOf('getBudgetGate') === -1, JSON.stringify(__calls));
  check('card handling ran after compliance', __calls.indexOf('handleCompliance') < __calls.indexOf('handleCardReply'));

  println('\n── 2. CRISIS NEVER touches card state ──');
  __reset({ cardResult: HANDLED });
  reply = await run(CRISIS);
  check('crisis reply (988), not the card ack', reply === CRISIS_TEMPLATES['A'] && String(reply).indexOf('988') >= 0, JSON.stringify(reply));
  check('handleCardReply was NEVER called', __calls.indexOf('handleCardReply') === -1, JSON.stringify(__calls));

  println('\n── 3. Card replies survive over-cap and over-budget ──');
  __reset({ cardResult: HANDLED, allowed: false });
  reply = await run('SKIP');
  check('over cap → card reply still processed (no model, bounded)', reply === CARD_ACK);

  __reset({ cardResult: HANDLED, budgetGate: PAUSED });
  reply = await run('YES');
  check('over budget → card reply still processed (the hinge of the loop)', reply === CARD_ACK);
  check('  and the model was never invoked', __openaiInvocations.length === 0);

  println('\n── 4. STOP still outranks a card reply ──');
  __reset({ cardResult: HANDLED, compliance: { handled: true, reply: null } });
  reply = await run('STOP');
  check('compliance short-circuits first; card handler never ran', reply === null && __calls.indexOf('handleCardReply') === -1);

  println('\n── 5. Not a card reply → ordinary pipeline untouched ──');
  __reset({ cardResult: { handled: false, reply: null } });
  reply = await run(ORDINARY);
  check('falls through to the model exactly as before', __openaiInvocations.length === 1);
  check('card handler was consulted once on the way', __calls.filter((c) => c === 'handleCardReply').length === 1);

  __reset({ cardResult: { handled: false, reply: null }, budgetGate: PAUSED });
  reply = await run(ORDINARY);
  check('unhandled + paused budget → the budget template (B3.5 still bites)', reply === MSG_BUDGET_PAUSE, JSON.stringify(reply));

  println('');
  const f = done();
  println(f === 0 ? 'ALL CARD-PIPELINE TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
