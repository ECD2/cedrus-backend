// Bundle 26 — the trial-downgrade job announces its silent failures.
//
// This is the flag-14 shape in the one job with a date attached: both live
// trials lapse 2026-08-06 and 2026-08-08, and this hourly job (`30 * * * *`)
// is what flips them to `free`.
//
// It had TWO silent modes, both proven below:
//
//   1. SCAN FAILS  → `expired` undefined → `|| []` → the loop never runs.
//      Nobody is downgraded and nothing says so. Expired trials keep their
//      trial entitlements indefinitely, which is invisible because "no expired
//      trials today" produces exactly the same empty run.
//   2. UPDATE FAILS → the user silently stays on `trialing`, AND the summary
//      counted rows FOUND rather than rows CHANGED — so a run where every
//      update failed still logged "Downgraded 2 expired trial(s) to free".
//      That false success line is asserted against directly in section 4.
//
// Control flow is UNCHANGED and stays fail-safe in direction: a scan failure
// still no-ops (users keep more access, not less), and one failed user does not
// abort the rest of the batch. Only the reporting changed.

(async () => {
  const { check, done } = makeChecker();
  const TWO = [{ id: 'u1' }, { id: 'u2' }];

  println('\n── 1. scan fails → nothing downgraded, and it LOGS ──');
  __reset();
  __setOp('app_users.select', { error: { code: '42501', message: 'permission denied for table app_users' } });
  let threw = false;
  try { await runTrialDowngrades(); } catch { threw = true; }
  check('does NOT throw (the scheduler guard sees a clean tick)', threw === false);
  check('no update was attempted', __updates.length === 0, JSON.stringify(__updates));
  check('emitted exactly one event', __events.length === 1, JSON.stringify(__names()));
  check('event is trial.downgrade.scan_failed', __events[0].name === 'trial.downgrade.scan_failed', __eventText(0));
  check('carries error_code', __events[0].fields.error_code === '42501', __eventText(0));
  check('carries err.message', __eventText(0).indexOf('permission denied') >= 0, __eventText(0));
  check('says nobody was downgraded', __events[0].fields.outcome === 'no_op', __eventText(0));
  check('no summary line claiming work', __infos.length === 0, JSON.stringify(__infos));

  println('\n── 2. happy path: both users downgraded, SILENT except the summary ──');
  __reset();
  __setOp('app_users.select', { rows: TWO });
  await runTrialDowngrades();
  check('two updates landed', __updates.length === 2, JSON.stringify(__updates));
  check('each sets plan=free', __updates.every((u) => u.plan === 'free'), JSON.stringify(__updates));
  check('each stamps trial_downgraded_at', __updates.every((u) => !!u.trial_downgraded_at), JSON.stringify(__updates));
  check('no error events', __events.length === 0, JSON.stringify(__names()));
  check('summary reports 2', __infos.length === 1 && __infos[0].indexOf('Downgraded 2') >= 0, JSON.stringify(__infos));

  println('\n── 3. one update fails: the OTHER user still gets processed ──');
  // The loop must not abort on one bad row. With the double, both updates share
  // an outcome, so this section proves the failure path is per-user by checking
  // that two failures produce two events rather than one abort.
  __reset();
  __setOp('app_users.select', { rows: TWO });
  __setOp('app_users.update', { error: { code: '40001', message: 'could not serialize access' } });
  await runTrialDowngrades();
  check('both users were attempted (loop did not abort on the first failure)',
    __events.length === 2, JSON.stringify(__names()));
  check('both events are trial.downgrade.failed',
    __names().every((n) => n === 'trial.downgrade.failed'), JSON.stringify(__names()));
  check('each names its own user', __eventText(0).indexOf('u_u1') >= 0 && __eventText(1).indexOf('u_u2') >= 0,
    __eventText(0) + ' | ' + __eventText(1));
  check('says the user is still trialing', __events[0].fields.outcome === 'still_trialing', __eventText(0));

  println('\n── 4. THE FALSE SUCCESS LINE is gone ──');
  // Previously: every update failed, yet the job logged "Downgraded 2 expired
  // trial(s) to free" because it counted rows found, not rows changed.
  check('no summary line at all when zero users were actually downgraded',
    __infos.length === 0, JSON.stringify(__infos));

  println('\n── 5. genuinely nothing to do → completely silent ──');
  __reset();
  __setOp('app_users.select', { rows: [] });
  await runTrialDowngrades();
  check('no updates', __updates.length === 0);
  check('no events', __events.length === 0, JSON.stringify(__names()));
  check('no summary', __infos.length === 0, JSON.stringify(__infos));

  println('\n── 6. THE DISCRIMINATOR — the bug itself, encoded ──');
  // "no expired trials today" and "the scan failed" both do nothing at all.
  // Before the fix that was the entire observable difference: none. This is the
  // one that matters on Aug 6/8 — a scan failure must not look like a quiet day.
  __reset();
  __setOp('app_users.select', { rows: [] });
  await runTrialDowngrades();
  const quietUpdates = __updates.length, quietEvents = __events.length;

  __reset();
  __setOp('app_users.select', { error: { code: '08006', message: 'connection failure' } });
  await runTrialDowngrades();
  const brokenUpdates = __updates.length, brokenEvents = __events.length;

  check('both do exactly nothing (no behaviour change, still fail-safe)',
    quietUpdates === 0 && brokenUpdates === 0);
  check('but they are now DISTINGUISHABLE: quiet=0 events, broken=1 event',
    quietEvents === 0 && brokenEvents === 1, `quiet=${quietEvents} broken=${brokenEvents}`);

  println('');
  const f = done();
  println(f === 0 ? 'ALL TRIAL-DOWNGRADE TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
