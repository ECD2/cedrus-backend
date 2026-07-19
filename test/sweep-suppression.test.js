// Proof: the §6 suppression window withholds drift nudges (the playful
// proactive layer) while goal follow-ups and day-of birthdays continue.
// Concatenated after reliability-core.js + stripped src/jobs/sweeps/select.js
// by run-tests.sh.

// Test double for utils/time.js: fixtures encode days-until-birthday directly
// in birthday_month (0 = today).
function daysUntilBirthday(month, _day, _tz) { return month; }

(() => {
  const { check, done } = makeChecker();
  const proUser = { plan: 'pro', billing_status: 'active', timezone: 'America/New_York' };
  const oldGoal = new Date(Date.now() - 5 * 86400000).toISOString();

  const driftOnly = () => ({
    context: [{ person_id: 'p1', name: 'Ana', proactive_enabled: true, is_self: false, relationship_health_score: 30, days_since_contact: 21 }],
    birthdays: [], goals: [], cooldowns: [],
  });

  println('sweeps §6: drift withheld, factual nudges continue');
  const normal = selectNudge(proUser, driftOnly());
  check('outside window: drift nudge selected', !!normal && normal.type === 'drift', JSON.stringify(normal));

  const suppressed = selectNudge(proUser, driftOnly(), new Date(), { suppressPromo: true });
  check('inside window: drift withheld (silence, not substitution)', suppressed === null, JSON.stringify(suppressed));

  const withFactual = () => ({
    context: [
      { person_id: 'p1', name: 'Ana', proactive_enabled: true, is_self: false, relationship_health_score: 30, days_since_contact: 21 },
      { person_id: 'p2', name: 'Beto', proactive_enabled: true, is_self: false, relationship_health_score: 90, is_core_five: true },
    ],
    birthdays: [{ id: 'p2', name: 'Beto', birthday_month: 0, birthday_day: 1, is_core_five: true }],
    goals: [{ id: 'g1', person_id: 'p2', goal_text: 'call Beto', created_at: oldGoal }],
    cooldowns: [],
  });

  const factual = selectNudge(proUser, withFactual(), new Date(), { suppressPromo: true });
  check('inside window: day-of birthday still nudges (factual, unmissable)', !!factual && factual.type === 'birthday', JSON.stringify(factual));

  const goalOnly = selectNudge(proUser, {
    context: [{ person_id: 'p2', name: 'Beto', proactive_enabled: true, is_self: false, is_core_five: true }],
    birthdays: [],
    goals: [{ id: 'g1', person_id: 'p2', goal_text: 'call Beto', created_at: oldGoal }],
    cooldowns: [],
  }, new Date(), { suppressPromo: true });
  check('inside window: goal follow-up still asks (their own intention)', !!goalOnly && goalOnly.type === 'goal_followup', JSON.stringify(goalOnly));

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
