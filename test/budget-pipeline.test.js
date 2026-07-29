// Bundle 29 — the budget kill switch obeys the pipeline's safety ordering.
//
// Same concat as Bundle 22 (REAL safetyDetection.js + selfName.js +
// pipeline/index.js over the prelude doubles), plus the __budgetGate knob.
// The ordering under proof (STAGE B3.5's placement):
//
//   compliance (STOP) > crisis pre-check > onboarding script > per-user cap
//     > BUDGET KILL SWITCH > model
//
//   • crisis beats the switch: 988 goes out even over budget,
//   • the switch sits AFTER the cap so paused-mode replies stay bounded,
//   • the switch sits BEFORE the model call — the spend it protects,
//   • it fails OPEN when the gate read is degraded.

(async () => {
  const { check, done } = makeChecker();

  const CRISIS = 'i want to kill myself';
  const THIRD_PARTY = 'my brother is going to hurt himself';
  const BOUNDARY = 'how much xanax can i take with alcohol';
  const ORDINARY = 'had dinner with Luca, his sister visits next month';
  const TEMPLATE_A = CRISIS_TEMPLATES['A'];
  const PAUSED = { paused: true, reason: 'tokens', degraded: false };

  const run = (body) => runInboundPipeline({ from: '+15550001111', body: body, messageSid: 'SM1', numSegments: 1 });

  println('\n── 1. PAUSED + ORDINARY → one polite template, no model ──');
  __reset({ budgetGate: PAUSED });
  let reply = await run(ORDINARY);
  check('returns MSG_BUDGET_PAUSE', reply === MSG_BUDGET_PAUSE, JSON.stringify(reply));
  check('logged as a system outbound', __lastOut() && __lastOut().type === 'system');
  check('the model was never invoked', __openaiInvocations.length === 0, JSON.stringify(__openaiInvocations));
  check('the copy is honest about not saving', String(reply).indexOf("couldn't save") >= 0);

  println('\n── 2. PAUSED + CRISIS → 988 path anyway (the ordering that matters) ──');
  __reset({ budgetGate: PAUSED });
  reply = await run(CRISIS);
  check('does NOT return the budget template', reply !== MSG_BUDGET_PAUSE, JSON.stringify(reply));
  check('returns the fixed Category A crisis template', reply === TEMPLATE_A, JSON.stringify(reply));
  check('the reply actually carries a crisis resource (988)', String(reply).indexOf('988') >= 0);
  check('the model was never invoked (bypass buys one template, never a model call)', __openaiInvocations.length === 0);
  check('the §6 window still opens on the bypass path', __suppressionWindows.length === 1, JSON.stringify(__suppressionWindows));

  __reset({ budgetGate: PAUSED });
  reply = await run(THIRD_PARTY);
  check('third-party crisis (Category C) is exempt too', reply === CRISIS_TEMPLATES['C'], JSON.stringify(reply));

  println('\n── 3. PAUSED + CAPPED → the cap answers first (replies stay bounded) ──');
  __reset({ budgetGate: PAUSED, allowed: false });
  reply = await run(ORDINARY);
  check('over cap while paused → MSG_RATE_LIMIT, not the budget template', reply === MSG_RATE_LIMIT, JSON.stringify(reply));
  check('cap check ran BEFORE the budget gate', __calls.indexOf('checkRateLimit') >= 0 && (__calls.indexOf('getBudgetGate') === -1 || __calls.indexOf('checkRateLimit') < __calls.indexOf('getBudgetGate')), JSON.stringify(__calls));

  __reset({ budgetGate: PAUSED, allowed: true });
  await run(ORDINARY);
  check('under cap while paused → budget gate consulted after the cap', __calls.indexOf('checkRateLimit') < __calls.indexOf('getBudgetGate'), JSON.stringify(__calls));

  println('\n── 4. PAUSED + STOP → compliance still outranks everything ──');
  __reset({ budgetGate: PAUSED, compliance: { handled: true, reply: null } });
  reply = await run('STOP');
  check('STOP short-circuits before the budget gate', reply === null && __calls.indexOf('getBudgetGate') === -1, JSON.stringify(__calls));

  println('\n── 5. PAUSED + BRAND-NEW USER → the Twilio-approved script still goes out ──');
  // Deliberate: the opt-in confirmation is a consent/compliance obligation and a
  // fixed template. Deferring it would also permanently break needsFreshStart
  // (our polite reply would create message history). The user's SECOND message
  // hits the gate like anyone else's.
  __reset({ budgetGate: PAUSED, isNew: true, onboardingComplete: false });
  reply = await run(ORDINARY);
  check('brand-new user gets MSG_COMPLIANCE even while paused', reply === MSG_COMPLIANCE, JSON.stringify(reply));
  check('and the model was NOT invoked', __openaiInvocations.length === 0);

  println('\n── 6. NOT PAUSED / DEGRADED → normal flow (fail open) ──');
  __reset({ budgetGate: { paused: false, reason: null, degraded: false } });
  await run(ORDINARY);
  check('unpaused → reaches the model', __openaiInvocations.length === 1, JSON.stringify(__calls));

  __reset({ budgetGate: { paused: false, reason: null, degraded: true } });
  await run(ORDINARY);
  check('degraded gate read → reaches the model (fail open)', __openaiInvocations.length === 1);

  println('\n── 7. THE BYPASS IS NARROW — boundary text is NOT exempt from the pause ──');
  const bSafety = evaluateSafety(BOUNDARY);
  check('the boundary phrase really is action=boundary (fixture is live)', bSafety.action === 'boundary', JSON.stringify(bSafety.action));
  __reset({ budgetGate: PAUSED });
  reply = await run(BOUNDARY);
  check('boundary + paused → the budget template (crisis-only bypass, same scope as B2.5)', reply === MSG_BUDGET_PAUSE, JSON.stringify(reply));
  check('the model was never invoked', __openaiInvocations.length === 0);

  println('');
  const f = done();
  println(f === 0 ? 'ALL BUDGET-PIPELINE TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
