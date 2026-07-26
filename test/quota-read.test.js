// Bundle 21 — quota reads: the fail-open path must announce itself.
//
// checkRateLimit() is the ONLY per-user spend ceiling in the application. It
// guards the single OpenAI call on the inbound SMS path (pipeline STAGE B3) and
// the same call on the web capture path. Nothing reads v_daily_token_usage or
// v_daily_sms_usage, and there is no alerting, budget guard, or kill switch
// anywhere in src/ — so if this guard stops enforcing, nothing else notices.
//
// It failed open SILENTLY: getMessageQuota discarded `error` without binding it,
// so an unreadable v_message_quota and a user comfortably under their cap both
// produced `{ allowed: true }` and an empty log. Identical observation, opposite
// meanings — the assertSecureBoot shape, on the spend ceiling.
//
// Fail-open is DELIBERATELY PRESERVED and asserted here. On the inbound path
// checkRateLimit runs at STAGE B3, before understand() reaches the Priority 0
// crisis gate, so a false "over quota" would answer a crisis message with the
// rate-limit template. The fix is visibility, not a different verdict.
//
// These assertions pin the value AND whether an event was emitted, so a future
// refactor can neither re-merge the branches nor start logging the healthy path
// (which would be one line per inbound message and would get filtered out).

(async () => {
  const { check, done } = makeChecker();

  println('\n── 1. getMessageQuota: query error → null AND one event ──');
  __reset();
  __setTable('v_message_quota', { error: { code: '42P01', message: 'relation "v_message_quota" does not exist' } });
  let q = await getMessageQuota('u-err');
  check('returns null', q === null, 'got ' + JSON.stringify(q));
  check('emitted exactly one event', __events.length === 1, JSON.stringify(__events));
  check('event is quota.read.failed', __events[0].name === 'quota.read.failed', __eventText(0));
  check('carries error_code (the SQLSTATE)', __events[0].fields.error_code === '42P01', __eventText(0));
  check('carries err.message', __eventText(0).indexOf('does not exist') >= 0, __eventText(0));
  check('marked outcome=fail_open', __events[0].fields.outcome === 'fail_open', __eventText(0));
  check('error_category is db_error (an allowed category)',
    __events[0].fields.error_category === 'db_error', __eventText(0));
  check('names the view whose cap is unenforced',
    __eventText(0).indexOf('v_message_quota') >= 0, __eventText(0));

  println('\n── 2. getMessageQuota: no row → null AND one event ──');
  __reset();
  __setTable('v_message_quota', { data: null, error: null });
  q = await getMessageQuota('u-ghost');
  check('returns null', q === null, 'got ' + JSON.stringify(q));
  check('emitted exactly one event', __events.length === 1, JSON.stringify(__events));
  check('error_code marks it as a missing row, not a driver error',
    __events[0].fields.error_code === 'no_row', __eventText(0));

  println('\n── 3. getMessageQuota: healthy → row AND SILENT ──');
  __reset();
  __setTable('v_message_quota', { data: { user_id: 'u1', daily_limit: 20, inbound_last_24h: 3 } });
  q = await getMessageQuota('u1');
  check('returns the row', q && q.daily_limit === 20, JSON.stringify(q));
  check('emitted NOTHING (one line per inbound message would be noise)',
    __events.length === 0, JSON.stringify(__events));

  println('\n── 4. getNudgeUsage: same three branches ──');
  __reset();
  __setTable('v_weekly_nudge_usage', { error: { code: '08006', message: 'connection failure' } });
  let n = await getNudgeUsage('u-err');
  check('error → null', n === null, 'got ' + JSON.stringify(n));
  check('error → one event naming its own view',
    __events.length === 1 && __eventText(0).indexOf('v_weekly_nudge_usage') >= 0, __eventText(0));

  __reset();
  __setTable('v_weekly_nudge_usage', { data: null, error: null });
  n = await getNudgeUsage('u-ghost');
  check('no row → null + one event', n === null && __events.length === 1, __eventText(0));

  __reset();
  __setTable('v_weekly_nudge_usage', { data: { user_id: 'u1', weekly_budget: 1, nudges_sent_this_week: 0 } });
  n = await getNudgeUsage('u1');
  check('healthy → row', n && n.weekly_budget === 1, JSON.stringify(n));
  check('healthy → SILENT', __events.length === 0, JSON.stringify(__events));

  println('\n── 5. checkRateLimit still fails open — deliberately ──');
  __reset();
  __setTable('v_message_quota', { error: { code: '42P01', message: 'relation missing' } });
  let r = await checkRateLimit('u-err');
  check('allowed:true on an unreadable quota (crisis must still reach STAGE C)',
    r.allowed === true, JSON.stringify(r));
  check('quota is null so the caller knows it is unknown', r.quota === null, JSON.stringify(r));
  check('and the fail-open was ANNOUNCED', __events.length === 1, JSON.stringify(__events));

  println('\n── 6. checkRateLimit normal verdicts are unchanged and silent ──');
  __reset();
  __setTable('v_message_quota', { data: { user_id: 'u1', daily_limit: 20, inbound_last_24h: 3 } });
  r = await checkRateLimit('u1');
  check('under quota → allowed:true', r.allowed === true, JSON.stringify(r));
  check('under quota → silent', __events.length === 0, JSON.stringify(__events));

  __reset();
  __setTable('v_message_quota', { data: { user_id: 'u1', daily_limit: 20, inbound_last_24h: 20 } });
  r = await checkRateLimit('u1');
  check('at the cap → allowed:false (the cap still bites)', r.allowed === false, JSON.stringify(r));
  check('at the cap → silent (a real cap hit is not a fault)',
    __events.length === 0, JSON.stringify(__events));

  println('\n── 7. THE DISCRIMINATOR — the bug itself, encoded ──');
  // "under quota" and "couldn't read the quota" both allow the request. Before
  // the fix that was the entire observable difference: none.
  __reset();
  __setTable('v_message_quota', { data: { user_id: 'u1', daily_limit: 20, inbound_last_24h: 1 } });
  const healthy = await checkRateLimit('u1');
  const healthyEvents = __events.length;

  __reset();
  __setTable('v_message_quota', { error: { code: '42501', message: 'permission denied for view' } });
  const broken = await checkRateLimit('u1');
  const brokenEvents = __events.length;

  check('both still allow the request (fail-open preserved, no behaviour change)',
    healthy.allowed === true && broken.allowed === true);
  check('but they are now DISTINGUISHABLE: healthy=0 events, broken=1 event',
    healthyEvents === 0 && brokenEvents === 1, `healthy=${healthyEvents} broken=${brokenEvents}`);

  println('');
  const f = done();
  println(f === 0 ? 'ALL QUOTA-READ TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
