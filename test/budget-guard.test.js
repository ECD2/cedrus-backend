// Bundle 28 — the budget guard: first consumer of the cost views (flag 17).
//
// Real budget.js + budgetGuard.js over the programmable seam. What matters:
//   • the verdict math (>= trips AT the budget line; per-dimension arming),
//   • string bigints from supabase-js sum correctly (prod returns "5272"),
//   • every read failure is fail-OPEN and ANNOUNCED (quota.read.failed),
//   • the job announces its mode every run (armed / DISARMED / unreadable),
//   • the switch row round-trips (job writes → gate reads),
//   • outbound-job gate skips loudly and fails open.

(async () => {
  const { check, done } = makeChecker();
  const NOW = new Date('2026-07-29T15:30:00.000Z');

  println('\n── 1. utcDayStart anchors to the view\'s UTC day ──');
  check('mid-day UTC → that day 00:00Z', utcDayStart(NOW) === '2026-07-29T00:00:00.000Z', utcDayStart(NOW));
  check('23:59Z stays same UTC day', utcDayStart(new Date('2026-07-29T23:59:59.999Z')) === '2026-07-29T00:00:00.000Z');

  println('\n── 2. evaluateBudget — pure verdicts ──');
  let v = evaluateBudget({ tokens: 100, smsSegments: 10 }, { tokenBudget: null, smsBudget: null });
  check('no budgets set → never active', v.active === false && v.reason === null);
  v = evaluateBudget({ tokens: 199, smsSegments: 0 }, { tokenBudget: 200, smsBudget: null });
  check('under budget → inactive', v.active === false);
  v = evaluateBudget({ tokens: 200, smsSegments: 0 }, { tokenBudget: 200, smsBudget: null });
  check('AT the budget line → ACTIVE (>= trips: the allowance is spent)', v.active === true && v.reason === 'tokens');
  v = evaluateBudget({ tokens: 0, smsSegments: 500 }, { tokenBudget: null, smsBudget: 500 });
  check('sms-only arming works', v.active === true && v.reason === 'sms');
  v = evaluateBudget({ tokens: 999, smsSegments: 999 }, { tokenBudget: 10, smsBudget: 10 });
  check('both over → reason is the first tripped, both listed', v.reason === 'tokens' && v.over.length === 2, JSON.stringify(v));
  v = evaluateBudget({ tokens: null, smsSegments: null }, { tokenBudget: 10, smsBudget: 10 });
  check('unreadable usage → dimension is OPEN (no false pause)', v.active === false, JSON.stringify(v));

  println('\n── 3. readDailyUsage — sums, string bigints, empties ──');
  __resetBudget();
  __setOutcome('v_daily_token_usage', { data: [{ total_tokens: '5272' }, { total_tokens: '907' }], error: null });
  __setOutcome('v_daily_sms_usage', { data: [{ sms_segments: '10' }, { sms_segments: 3 }], error: null });
  let usage = await readDailyUsage(NOW);
  check('string bigints sum as numbers (prod shape)', usage.tokens === 6179, JSON.stringify(usage));
  check('sms segments sum across rows', usage.smsSegments === 13);
  check('healthy reads emit NOTHING', __events.length === 0, JSON.stringify(__events));

  __resetBudget();
  __setOutcome('v_daily_token_usage', { data: [], error: null });
  __setOutcome('v_daily_sms_usage', { data: [], error: null });
  usage = await readDailyUsage(NOW);
  check('no rows today → zero, not null', usage.tokens === 0 && usage.smsSegments === 0);

  println('\n── 4. readDailyUsage — failure branches announce and open ──');
  __resetBudget();
  __setOutcome('v_daily_token_usage', { data: null, error: { code: '42P01', message: 'relation does not exist' } });
  __setOutcome('v_daily_sms_usage', { data: [{ sms_segments: 7 }], error: null });
  usage = await readDailyUsage(NOW);
  check('failed view → null (unknowable), other view still read', usage.tokens === null && usage.smsSegments === 7);
  let ev = __eventsNamed('quota.read.failed');
  check('quota.read.failed emitted once, fail_open, with code', ev.length === 1 && ev[0].fields.outcome === 'fail_open' && ev[0].fields.error_code === '42P01', JSON.stringify(ev));

  __resetBudget();
  __setOutcome('v_daily_token_usage', { data: [{ total_tokens: 1 }], error: null });
  __setThrow('v_daily_sms_usage', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
  usage = await readDailyUsage(NOW);
  check('a THROWN read is also caught → null + announced', usage.smsSegments === null && __eventsNamed('quota.read.failed').length === 1);

  println('\n── 5. runBudgetGuard — the hourly job, every mode announced ──');
  __resetBudget();
  config.dailyTokenBudget = null; config.dailySmsBudget = null;
  __setOutcome('v_daily_token_usage', { data: [{ total_tokens: 50 }], error: null });
  __setOutcome('v_daily_sms_usage', { data: [{ sms_segments: 5 }], error: null });
  let out = await runBudgetGuard(NOW);
  check('disarmed → inactive verdict', out.active === false && out.armed === false);
  let up = __lastUpsert();
  check('kill-switch row still written (active:false, mode disarmed)', up && up.table === 'system_flags' && up.row.value.active === false && up.row.value.mode === 'disarmed', JSON.stringify(up));
  check('upsert keyed for idempotency (onConflict key)', up.options && up.options.onConflict === 'key');
  ev = __eventsNamed('budget.check');
  check('budget.check announces DISARMED', ev.length === 1 && ev[0].fields.message.indexOf('DISARMED') >= 0, JSON.stringify(ev));

  __resetBudget();
  config.dailyTokenBudget = 100000; config.dailySmsBudget = 200;
  __setOutcome('v_daily_token_usage', { data: [{ total_tokens: 500 }], error: null });
  __setOutcome('v_daily_sms_usage', { data: [{ sms_segments: 3 }], error: null });
  out = await runBudgetGuard(NOW);
  check('armed + under → inactive, outcome ok', out.active === false && __eventsNamed('budget.check')[0].fields.outcome === 'ok');
  check('payload carries the numbers Emil will read', __lastUpsert().row.value.tokens_used === 500 && __lastUpsert().row.value.token_budget === 100000);

  __resetBudget();
  config.dailyTokenBudget = 100000; config.dailySmsBudget = 200;
  __setOutcome('v_daily_token_usage', { data: [{ total_tokens: 100000 }], error: null });
  __setOutcome('v_daily_sms_usage', { data: [{ sms_segments: 3 }], error: null });
  out = await runBudgetGuard(NOW);
  check('armed + over tokens → ACTIVE, reason tokens', out.active === true && out.reason === 'tokens');
  check('switch row active:true persisted', __lastUpsert().row.value.active === true);
  check('budget.check outcome paused', __eventsNamed('budget.check')[0].fields.outcome === 'paused');

  // Recovery: a later run under budget overwrites the row inactive.
  __resetBudget();
  __setOutcome('v_daily_token_usage', { data: [], error: null });
  __setOutcome('v_daily_sms_usage', { data: [], error: null });
  out = await runBudgetGuard(NOW);
  check('next under-budget run clears the switch (day rollover recovery)', out.active === false && __lastUpsert().row.value.active === false);

  __resetBudget();
  config.dailyTokenBudget = 10; config.dailySmsBudget = null;
  __setOutcome('v_daily_token_usage', { data: null, error: { code: '57014', message: 'timeout' } });
  __setOutcome('v_daily_sms_usage', { data: [], error: null });
  out = await runBudgetGuard(NOW);
  check('armed but view unreadable → stays OPEN (no false pause)', out.active === false);
  check('  ...and the unreadable read was announced', __eventsNamed('quota.read.failed').length === 1);
  check('  ...and budget.check says unreadable', __eventsNamed('budget.check')[0].fields.message.indexOf('unreadable') >= 0);

  __resetBudget();
  config.dailyTokenBudget = 10; config.dailySmsBudget = null;
  __setOutcome('v_daily_token_usage', { data: [{ total_tokens: 99 }], error: null });
  __setOutcome('v_daily_sms_usage', { data: [], error: null });
  __setOutcome('system_flags:upsert', { data: null, error: { code: '42P01', message: 'system_flags missing' } });
  out = await runBudgetGuard(NOW);
  check('upsert refused → budget.write.failed announced, job survives', out.persisted === false && __eventsNamed('budget.write.failed').length === 1);

  println('\n── 6. getBudgetGate — the read side round-trips and opens ──');
  __resetBudget();
  __setOutcome('system_flags', { data: { value: { active: true, reason: 'sms' } }, error: null });
  let gate = await getBudgetGate();
  check('active row → paused with reason', gate.paused === true && gate.reason === 'sms' && gate.degraded === false);

  __resetBudget();
  __setOutcome('system_flags', { data: { value: { active: false, reason: null } }, error: null });
  gate = await getBudgetGate();
  check('inactive row → not paused', gate.paused === false);

  __resetBudget();
  __setOutcome('system_flags', { data: null, error: null });
  gate = await getBudgetGate();
  check('no row yet (guard never ran) → not paused, silent, not degraded', gate.paused === false && gate.degraded === false && __events.length === 0);

  __resetBudget();
  __setOutcome('system_flags', { data: null, error: { code: '42P01', message: 'relation "system_flags" does not exist' } });
  gate = await getBudgetGate();
  check('missing table → OPEN + degraded + announced (pre-migration deploy is survivable)', gate.paused === false && gate.degraded === true && __eventsNamed('quota.read.failed').length === 1);

  __resetBudget();
  __setThrow('system_flags', new Error('fetch failed'));
  gate = await getBudgetGate();
  check('thrown read → OPEN + degraded + announced', gate.paused === false && gate.degraded === true && __eventsNamed('quota.read.failed').length === 1);

  println('\n── 7. shouldRunOutboundJob — skips loudly, opens on doubt ──');
  __resetBudget();
  __setOutcome('system_flags', { data: { value: { active: true, reason: 'tokens' } }, error: null });
  let run = await shouldRunOutboundJob('weekly-briefs');
  ev = __eventsNamed('budget.job.skipped');
  check('paused → job skipped', run === false);
  check('  ...with a per-job structured event', ev.length === 1 && ev[0].fields.job_id === 'weekly-briefs' && ev[0].fields.outcome === 'skipped', JSON.stringify(ev));

  __resetBudget();
  __setOutcome('system_flags', { data: { value: { active: false } }, error: null });
  run = await shouldRunOutboundJob('daily-sweeps');
  check('not paused → runs, silent', run === true && __eventsNamed('budget.job.skipped').length === 0);

  __resetBudget();
  __setThrow('system_flags', new Error('db down'));
  run = await shouldRunOutboundJob('reminder-dispatch');
  check('gate unreadable → job RUNS (fail open) and the read failure was announced', run === true && __eventsNamed('quota.read.failed').length === 1);

  println('');
  const f = done();
  println(f === 0 ? 'ALL BUDGET-GUARD TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
