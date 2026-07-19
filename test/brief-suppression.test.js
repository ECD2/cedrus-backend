// Proof: the §6 suppression window strips the promotional/playful layer from
// the brief plan (Pro teaser + action offers) while factual content keeps
// flowing. Concatenated after reliability-core.js + stripped
// src/jobs/brief/select.js by run-tests.sh.

// Test double for utils/time.js: fixtures encode days-until-birthday directly
// in birthday_month (0 = today, 30 = outside the 7-day brief window).
function daysUntilBirthday(month, _day, _tz) { return month; }

(() => {
  const { check, done } = makeChecker();
  const freeUser = { plan: 'free', billing_status: null, name: 'Emil', timezone: 'America/New_York' };
  const proUser = { plan: 'pro', billing_status: 'active', name: 'Emil', timezone: 'America/New_York' };
  const recent = new Date(Date.now() - 5 * 86400000).toISOString();

  const candidates = () => ({
    context: [
      { person_id: 'p1', name: 'Ana', proactive_enabled: true, is_self: false, relationship_health_score: 30, days_since_contact: 21, current_facts: [{ type: 'life_event', value: 'started a new job', created_at: recent }], active_saved_items: [] },
      { person_id: 'p2', name: 'Beto', proactive_enabled: false, is_self: false, relationship_health_score: 20, current_facts: [], active_saved_items: [] },
    ],
    birthdays: [{ id: 'p1', name: 'Ana', birthday_month: 0, birthday_day: 1, is_core_five: true }],
    openGoals: [],
  });

  println('brief §6: promo layer suppressed, factual content kept');
  const proNormal = selectBriefItems(proUser, candidates());
  check('pro outside window: action offers on', proNormal.items.length > 0 && proNormal.items.every(i => i.actionOffer === true), JSON.stringify(proNormal.items));

  const proSuppressed = selectBriefItems(proUser, candidates(), { suppressPromo: true });
  check('pro inside window: every action offer off', proSuppressed.items.length > 0 && proSuppressed.items.every(i => i.actionOffer === false), JSON.stringify(proSuppressed.items));
  check('factual moments still present (same count)', proSuppressed.items.length === proNormal.items.length, proSuppressed.items.length + ' vs ' + proNormal.items.length);
  check('closing question unchanged (ordinary brief function)', proSuppressed.closingQuestion === proNormal.closingQuestion);

  const freeNormal = selectBriefItems(freeUser, candidates());
  check('free outside window: teaser present (Beto slipping)', !!freeNormal.teaser && freeNormal.teaser.count === 1, JSON.stringify(freeNormal.teaser));

  const freeSuppressed = selectBriefItems(freeUser, candidates(), { suppressPromo: true });
  check('free inside window: teaser (upsell) suppressed', freeSuppressed.teaser === null, JSON.stringify(freeSuppressed.teaser));
  check('free inside window: core-five birthday still surfaces', freeSuppressed.items.some(i => i.type === 'birthday'), JSON.stringify(freeSuppressed.items));

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
