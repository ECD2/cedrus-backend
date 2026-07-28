// Bundle 27 — planTier(), the one entitlement decision, and it knows the clock.
//
// Six near-identical copies used to live in jobs/sweeps/select.js,
// jobs/brief/select.js, services/discovery.js, services/briefEngine.js (as
// `tierOf`), services/insights.js and services/brief/composer.js. They had
// already drifted — three guarded `user &&`, three threw a TypeError on a
// nullish user — and none of them looked at trial_ends_at.
//
// That last part was flag 23. `v_people_for_agent.proactive_enabled` checks
// `plan = 'trialing' AND trial_ends_at > now()`, so SQL stops honouring a trial
// the instant it expires. The JS copies checked only the plan column, which the
// hourly downgrade cron owns. If that cron silently no-ops, SQL and JS disagree
// permanently: the view says free, the code says trial, and the free-tier gates
// at sweeps/select.js:36 and :47 never engage.
//
// The rule under test: a trial past trial_ends_at is not a trial, whatever the
// column says. Entitlement does not depend on a cron having run.

(async () => {
  const { check, done } = makeChecker();

  const NOW = new Date('2026-07-27T12:00:00.000Z');
  const FUTURE = '2026-08-08T05:36:12.271Z';   // Emil's real trial_ends_at
  const PAST = '2026-07-20T00:00:00.000Z';

  println('\n── 1. the four ordinary verdicts ──');
  check('active trial → trial',
    planTier({ plan: 'trialing', billing_status: 'trialing', trial_ends_at: FUTURE }, NOW) === 'trial');
  check('pro + active billing → pro',
    planTier({ plan: 'pro', billing_status: 'active' }, NOW) === 'pro');
  check('free → free',
    planTier({ plan: 'free', billing_status: 'none' }, NOW) === 'free');
  check('pro but billing NOT active → free (unchanged)',
    planTier({ plan: 'pro', billing_status: 'past_due' }, NOW) === 'free');

  println('\n── 2. THE FIX: expired trial with a stale plan column → free ──');
  // The cron has not run (or silently failed), so plan still reads 'trialing'.
  // The old copies returned 'trial' here, forever. The view already said free.
  const stale = { plan: 'trialing', billing_status: 'trialing', trial_ends_at: PAST };
  check('expired trial → free even though plan still says trialing',
    planTier(stale, NOW) === 'free', planTier(stale, NOW));
  check('the plan column really is still trialing (fixture is honest)',
    stale.plan === 'trialing');

  println('\n── 3. the boundary, exactly at trial_ends_at ──');
  // The view uses strict `>`, so at the instant of expiry the trial is over.
  const at = new Date('2026-07-27T12:00:00.000Z').toISOString();
  check('exactly AT trial_ends_at → free (matches the view\'s strict >)',
    planTier({ plan: 'trialing', trial_ends_at: at }, NOW) === 'free',
    planTier({ plan: 'trialing', trial_ends_at: at }, NOW));
  check('one millisecond BEFORE expiry → still trial',
    planTier({ plan: 'trialing', trial_ends_at: new Date(NOW.getTime() + 1).toISOString() }, NOW) === 'trial');
  check('one millisecond AFTER expiry → free',
    planTier({ plan: 'trialing', trial_ends_at: new Date(NOW.getTime() - 1).toISOString() }, NOW) === 'free');

  println('\n── 4. the drift is resolved: a nullish user never throws ──');
  // Three of the six copies threw a TypeError here; three returned 'free'.
  let threw = false;
  try { check('null user → free', planTier(null, NOW) === 'free'); } catch { threw = true; }
  check('null user did not throw (three old copies did)', threw === false);
  threw = false;
  try { check('undefined user → free', planTier(undefined, NOW) === 'free'); } catch { threw = true; }
  check('undefined user did not throw', threw === false);

  println('\n── 5. a loader that forgot the column FAILS OPEN ──');
  // app_users.trial_ends_at is NOT NULL, so a missing value cannot be a data
  // state — only a SELECT that omitted it. Failing closed here would have
  // downgraded every live trial the moment this deployed.
  check('trialing with NO trial_ends_at → trial (fail open, not free)',
    planTier({ plan: 'trialing', billing_status: 'trialing' }, NOW) === 'trial');
  check('trialing with an unparseable trial_ends_at → trial',
    planTier({ plan: 'trialing', trial_ends_at: 'not-a-date' }, NOW) === 'trial');
  check('a missing column can NEVER turn a pro user free',
    planTier({ plan: 'pro', billing_status: 'active' }, NOW) === 'pro');

  println('\n── 6. isProLike collapses the third duplicated expression ──');
  check('pro is pro-like', isProLike('pro') === true);
  check('trial is pro-like', isProLike('trial') === true);
  check('free is not', isProLike('free') === false);

  println('\n── 7. SHIP-DARK: both live trials are unaffected today ──');
  // The whole change must be a no-op for current production. Emil's trial ends
  // 2026-08-08, the other 2026-08-06; today is 2026-07-27.
  const today = new Date('2026-07-27T12:00:00.000Z');
  check('Emil (ends 2026-08-08) still trial',
    planTier({ plan: 'trialing', billing_status: 'trialing', trial_ends_at: '2026-08-08T05:36:12.271Z' }, today) === 'trial');
  check('second user (ends 2026-08-06) still trial',
    planTier({ plan: 'trialing', billing_status: 'trialing', trial_ends_at: '2026-08-06T22:47:25.585Z' }, today) === 'trial');
  check('...and both flip to free once their date passes',
    planTier({ plan: 'trialing', trial_ends_at: '2026-08-06T22:47:25.585Z' }, new Date('2026-08-07T00:00:00Z')) === 'free' &&
    planTier({ plan: 'trialing', trial_ends_at: '2026-08-08T05:36:12.271Z' }, new Date('2026-08-09T00:00:00Z')) === 'free');

  println('\n── 8. THE DISCRIMINATOR — the bug itself, encoded ──');
  // Identical `plan` column, opposite verdicts. The old copies could not tell
  // these apart because they never looked past `plan`.
  const active = { plan: 'trialing', billing_status: 'trialing', trial_ends_at: FUTURE };
  const expired = { plan: 'trialing', billing_status: 'trialing', trial_ends_at: PAST };
  check('both rows carry the SAME plan value', active.plan === expired.plan);
  check('but they are now DISTINGUISHABLE: active=trial, expired=free',
    planTier(active, NOW) === 'trial' && planTier(expired, NOW) === 'free',
    planTier(active, NOW) + '/' + planTier(expired, NOW));

  println('');
  const f = done();
  println(f === 0 ? 'ALL ENTITLEMENTS TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
