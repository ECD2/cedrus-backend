// Regression proof for the interests-table gap (Station 7 read-path fix).
//
// The blocker: the `interests` table is missing in prod (its N5 foundation
// migration is unrun — docs/INTERESTS.proposed.sql), so the discovery gather's
// interest read (interests.listInterests) errored on a missing relation and
// sank the WHOLE discovery plan. The fix (src/services/discovery.js,
// gatherDiscoverySignals) degrades that ONE read to [] on any error, exactly as
// briefEngine.gatherBriefProfile already does, so goals / people / location
// still drive the plan.
//
// This proves: (a) a throwing interest read degrades to no interests instead of
// propagating; (b) the rest of the plan is still built; (c) a WORKING read is
// untouched (the catch does not swallow good data). Concatenated after
// reliability-core.js + stripped src/services/discovery.js by run-tests.sh
// (register the bundle per docs/FLAGS_FROM_STATION7.md). Runs under bun/node/jsc.

// Stub for utils/time.js (import-stripped from the bundle). Unused here (no
// birthdays are passed) but defined so any birthday path stays safe, mirroring
// discovery.test.js.
function daysUntilBirthday(month, _day, _tz) { return month; }

(async () => {
  const { check, done } = makeChecker();
  const DAY = 86400000;
  const NOW = new Date('2026-07-21T12:00:00Z');
  const at = (deltaDays) => new Date(NOW.getTime() + deltaDays * DAY).toISOString();

  const user = { id: 'u1', plan: 'pro', billing_status: 'active', timezone: 'America/New_York' };

  // A single open goal is enough to prove the plan survives without interests:
  // goal_context needs no location/birthday/interest input.
  const goals = [{ id: 'g1', goal_text: 'run a half marathon', person_id: null, week_of: at(-3), status: 'open' }];

  // Every non-interest read is a benign stub; the isInSuppressionWindow gate is
  // OFF so the gather actually runs (the suppression path is covered separately
  // in discovery.test.js). Only getInterests is varied per case.
  const deps = (getInterests) => ({
    getInterests,
    getOpenGoals: async () => goals,
    getBirthdays: async () => [],
    getAgentContext: async () => [],
    getUserLocation: async () => null,
    isInSuppressionWindow: async () => false,
  });

  // The exact failure prod hit: a missing-relation error out of the interest read.
  const throwMissingTable = async () => { throw new Error('relation "interests" does not exist'); };
  const throwPlainError = async () => { throw new Error('boom'); };

  println('interests read throws during a normal gather → degrade, do not propagate');

  // (a) gatherDiscoverySignals degrades the interest read to [] and still returns
  //     the other signals.
  const signals = await gatherDiscoverySignals(user, {}, deps(throwMissingTable));
  check('gather returns interests: [] when the interest read throws (missing table)',
    Array.isArray(signals.interests) && signals.interests.length === 0);
  check('gather still returns the other real signals (goals flowed through)',
    Array.isArray(signals.goals) && signals.goals.length === 1 && signals.goals[0].id === 'g1');
  check('gather degrades on ANY read error, not only a recognizable one',
    (await gatherDiscoverySignals(user, {}, deps(throwPlainError))).interests.length === 0);

  // (b) getDiscoveryPlan does NOT throw and still builds a plan from the goal.
  let plan;
  let threw = false;
  try {
    plan = await getDiscoveryPlan(user, { now: NOW }, deps(throwMissingTable));
  } catch { threw = true; }
  check('getDiscoveryPlan does not throw when the interest read fails', threw === false);
  check('plan is still built from the surviving signals (the open goal is present)',
    !!plan && plan.plan.some((x) => x.type === 'goal_context' && x.subject === 'run a half marathon'));
  check('plan carries no interest-derived items (interests degraded to none)',
    !!plan && !plan.plan.some((x) => x.source && x.source.kind === 'interest'));
  check('a normal (non-suppressed) plan still reports suppressed:false',
    !!plan && plan.suppressed === false);

  // (c) A WORKING interest read is untouched — the catch must not swallow good data.
  println('a working interest read is unaffected (no over-catching)');
  const okInterests = [
    { id: 'i1', category: 'sports_team', label: 'Kansas City Chiefs', provenance: 'user_stated', surfacing_state: 'active', last_affirmed_at: at(-2), created_at: at(-100) },
  ];
  const okSignals = await gatherDiscoverySignals(user, {}, deps(async () => okInterests));
  check('a healthy interest read flows through unchanged',
    okSignals.interests.length === 1 && okSignals.interests[0].id === 'i1');
  const okPlan = await getDiscoveryPlan(user, { now: NOW }, deps(async () => okInterests));
  check('the healthy interest produces its plan item (sports_schedule for the team)',
    okPlan.plan.some((x) => x.type === 'sports_schedule' && x.subject === 'Kansas City Chiefs'));

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
