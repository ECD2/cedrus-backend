// Bundle 22 — a crisis message outranks the pre-model short-circuits.
//
// runInboundPipeline() had three early returns BEFORE STAGE C, where the
// Priority 0 crisis gate lives. Two were reachable with crisis text, so a
// message that trips the deterministic detector could never reach detection:
//
//   * needsFreshStart  — a first-ever message returns the Twilio opt-in script.
//     WORST CASE: someone reaching out for the first time, in crisis, is handed
//     compliance boilerplate. Led with, below.
//   * STAGE B3 cap     — a capped user gets "you've reached today's limit",
//     for up to 24 hours. Live today at the ordinary 20/day cap.
//   * loneName         — NOT reachable; a bare name never trips the detector
//     and a crisis phrase is never a bare name. Asserted in section 6 anyway,
//     because "not reachable" is a claim with a shelf life.
//
// STAGE B2.5 exempts a crisis message from the first two. The exemption is
// deliberately narrow — `action === 'crisis'`, NOT isSafetyOverride(), so the
// substance-guidance boundary stays capped.
//
// The exemption cannot buy free model calls: the predicate that skips the cap
// is the same one that makes understand() short-circuit. Section 3 proves that
// against the real functions rather than against the double.

(async () => {
  const { check, done } = makeChecker();

  const CRISIS = 'i want to kill myself';
  const THIRD_PARTY = 'my brother is going to hurt himself';
  const BOUNDARY = 'how much xanax can i take with alcohol';
  const ORDINARY = 'had dinner with Luca, his sister visits next month';
  const TEMPLATE_A = CRISIS_TEMPLATES['A'];

  const run = (body) => runInboundPipeline({ from: '+15550001111', body: body, messageSid: 'SM1', numSegments: 1 });

  println('\n── 1. FIRST-EVER MESSAGE IN CRISIS (the worst case) ──');
  __reset({ isNew: true, onboardingComplete: false });
  let reply = await run(CRISIS);
  check('does NOT return the Twilio opt-in boilerplate', reply !== MSG_COMPLIANCE,
    reply === MSG_COMPLIANCE ? 'got the compliance script' : 'ok');
  check('returns the fixed Category A crisis template', reply === TEMPLATE_A, JSON.stringify(reply));
  check('the reply actually carries a crisis resource (988)', String(reply).indexOf('988') >= 0);
  check('the model was never invoked', __openaiInvocations.length === 0, JSON.stringify(__openaiInvocations));

  println('\n── 2. CAPPED USER IN CRISIS ──');
  __reset({ allowed: false });
  reply = await run(CRISIS);
  check('does NOT return MSG_RATE_LIMIT', reply !== MSG_RATE_LIMIT,
    reply === MSG_RATE_LIMIT ? 'got the cap message' : 'ok');
  check('returns the fixed Category A crisis template', reply === TEMPLATE_A, JSON.stringify(reply));
  check('the model was never invoked', __openaiInvocations.length === 0, JSON.stringify(__openaiInvocations));

  __reset({ allowed: false });
  reply = await run(THIRD_PARTY);
  check('third-party crisis (Category C) is exempt too', reply === CRISIS_TEMPLATES['C'], JSON.stringify(reply));
  check('the model was never invoked', __openaiInvocations.length === 0);

  println('\n── 3. THE MODEL SEAM — proven against the REAL functions ──');
  // Sections 1-2 use a double for understand(). This section proves the thing
  // the double stands in for: production's gate condition holds for exactly
  // these bodies, so understand() cannot fall through to the OpenAI call.
  for (const b of [CRISIS, THIRD_PARTY]) {
    const s = evaluateSafety(b);
    check(`evaluateSafety(${JSON.stringify(b.slice(0, 24))}...) -> action 'crisis'`,
      s.action === 'crisis', JSON.stringify(s.action));
    check('  ...and isSafetyOverride() is TRUE, so understand() short-circuits pre-model',
      isSafetyOverride(s) === true);
    check('  ...and the reply is a fixed template, not model text',
      typeof s.reply === 'string' && s.reply.length > 0);
  }
  check('the bypass predicate and the no-model guarantee are the SAME condition',
    (evaluateSafety(CRISIS).action === 'crisis') === isSafetyOverride(evaluateSafety(CRISIS)));

  println('\n── 4. THE CAP STILL BITES for ordinary traffic ──');
  __reset({ allowed: false });
  reply = await run(ORDINARY);
  check('ordinary + over cap → MSG_RATE_LIMIT', reply === MSG_RATE_LIMIT, JSON.stringify(reply));
  check('and the model was NOT invoked (the cap did its job)', __openaiInvocations.length === 0);

  __reset({ allowed: true });
  reply = await run(ORDINARY);
  check('ordinary + under cap → reaches the model', __openaiInvocations.length === 1, JSON.stringify(__calls));

  println('\n── 5. ONBOARDING IS UNCHANGED for ordinary traffic ──');
  __reset({ isNew: true, onboardingComplete: false });
  reply = await run(ORDINARY);
  check('ordinary + brand-new user → the opt-in script, as before', reply === MSG_COMPLIANCE, JSON.stringify(reply));
  check('and the model was NOT invoked', __openaiInvocations.length === 0);

  println('\n── 6. THE BYPASS IS NARROW — boundary is deliberately NOT exempt ──');
  const bSafety = evaluateSafety(BOUNDARY);
  check('the boundary phrase really is action=boundary (fixture is live)',
    bSafety.action === 'boundary', JSON.stringify(bSafety.action));
  check('  ...and isSafetyOverride() would have exempted it — we chose not to',
    isSafetyOverride(bSafety) === true);
  __reset({ allowed: false });
  reply = await run(BOUNDARY);
  check('boundary + over cap → MSG_RATE_LIMIT (stays capped)', reply === MSG_RATE_LIMIT, JSON.stringify(reply));
  // The loneName path: unreachable by construction, asserted so it stays that way.
  check('a crisis phrase is never a bare name (loneName path stays unreachable)',
    !bareName(CRISIS) && !bareName(THIRD_PARTY));

  println('\n── 7. COMPLIANCE STILL OUTRANKS CRISIS ──');
  // STOP is a legal obligation and its gate sits ABOVE B2.5. Even carrying
  // crisis text, a STOP must stop.
  __reset({ allowed: false, compliance: { handled: true, reply: null } });
  reply = await run('STOP ' + CRISIS);
  check('STOP short-circuits before the crisis pre-check', reply === null, JSON.stringify(reply));
  check('no crisis template was sent', __outbound.length === 0, JSON.stringify(__outbound));

  println('\n── 8. A BYPASSED CRISIS STILL RECORDS ITS SIGNAL + §6 WINDOW ──');
  __reset({ allowed: false });
  await run(CRISIS);
  check('recordCrisisSignal fired', __crisisSignals.length === 1, JSON.stringify(__crisisSignals));
  check('  ...with the category', __crisisSignals[0] && __crisisSignals[0].category === 'A');
  check('openSuppressionWindow fired (the §6 48h cooldown opens)',
    __suppressionWindows.length === 1, JSON.stringify(__suppressionWindows));

  __reset({ isNew: true, onboardingComplete: false });
  await run(CRISIS);
  check('same on the first-message bypass path', __crisisSignals.length === 1 && __suppressionWindows.length === 1);

  println('');
  const f = done();
  println(f === 0 ? 'ALL CRISIS-BEFORE-CAP TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
