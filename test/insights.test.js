// Proof for the Insight Engine (src/services/insights.js). The pure core
// (computeInsights) is exercised for EACH real signal, deterministic ranking,
// ring/tier weighting, and the free/Pro entitlement tag; the read layer
// (getInsightsForUser / getInsightsForPerson) is exercised via injected gather
// deps. Concatenated after reliability-core.js + stripped src/services/insights.js
// by run-tests.sh. Runs under bun/node/jsc.

// Test double for utils/time.js (import-stripped from the bundle): encode
// days-until-birthday directly in birthday_month, exactly as brief-suppression.
function daysUntilBirthday(month, _day, _tz) { return month; }

(async () => {
  const { check, done } = makeChecker();
  const DAY = 86400000;
  const NOW = new Date('2026-07-21T12:00:00Z');           // fixed clock → deterministic
  const at = (deltaDays) => new Date(NOW.getTime() + deltaDays * DAY).toISOString();

  const freeUser = { id: 'u1', plan: 'free', billing_status: null, timezone: 'America/New_York' };
  const proUser = { id: 'u1', plan: 'pro', billing_status: 'active', timezone: 'America/New_York' };

  // Fresh fixtures per call so nothing mutates across assertions.
  const signals = () => ({
    context: [
      { person_id: 'self', name: 'Me', is_self: true },
      { person_id: 'p1', name: 'Ana', is_core_five: true, relationship_health_score: 30, days_since_contact: 40,
        current_facts: [
          { type: 'life_event', value: 'started a new job', created_at: at(-2) },
          { type: 'mood', value: 'stressed', created_at: at(-1) },   // churny — must be skipped
        ],
        active_saved_items: [{ title: 'Kaytranada show', event_date: at(5) }] },
      { person_id: 'p2', name: 'Beto', is_core_five: false, relationship_health_score: 80, days_since_contact: 10,
        current_facts: [], active_saved_items: [] },
      { person_id: 'p3', name: 'Cira', is_core_five: false, relationship_health_score: null, days_since_contact: null,
        current_facts: [], active_saved_items: [] },
    ],
    birthdays: [{ id: 'p1', name: 'Ana', birthday_month: 3, birthday_day: 1, is_core_five: true }], // 3 days out
    reminders: [{ id: 'r1', person_id: 'p2', title: 'lease renewal', trigger_at: at(2), status: 'pending' }],
    prompts: [{ id: 'q1', person_id: 'p3', question_text: 'did you get to reach out to Cira about the trip?', created_at: at(-4), status: 'open' }],
    goals: [{ id: 'g1', person_id: 'p1', goal_text: 'grab coffee with Ana' }],
  });

  // ── each real signal produces its insight type; self is excluded ──────────
  println('each real signal produces its insight type; self is excluded');
  const r = computeInsights({ user: proUser, ...signals(), now: NOW, perPerson: Infinity });
  const typesOf = (pid) => (r.byPerson[pid] || []).map((i) => i.type);
  check('p1 birthday (people.birthday_month/day)', typesOf('p1').includes('birthday'));
  check('p1 recency (40d, core threshold 14)', typesOf('p1').includes('recency'));
  check('p1 new_fact (2d-old life_event)', typesOf('p1').includes('new_fact'));
  check('new_fact skipped the mood fact + kept the job',
    r.byPerson.p1.filter((i) => i.type === 'new_fact').length === 1 &&
    r.byPerson.p1.find((i) => i.type === 'new_fact').detail.value === 'started a new job');
  check('p1 saved_event (event_date in 5d)', typesOf('p1').includes('saved_event'));
  check('p1 open_goal', typesOf('p1').includes('open_goal'));
  check('p2 open_reminder', typesOf('p2').includes('open_reminder'));
  check('p2 NO recency (10d < 30 regular threshold)', !typesOf('p2').includes('recency'));
  check('p3 open_prompt', typesOf('p3').includes('open_prompt'));
  check('p3 NO recency (days_since_contact null)', !typesOf('p3').includes('recency'));
  check('self excluded entirely', !r.insights.some((i) => i.personId === 'self') && !r.byPerson.self);

  // ── ranking is deterministic and correctly ordered ───────────────────────
  println('ranking is deterministic and correctly ordered');
  const r2 = computeInsights({ user: proUser, ...signals(), now: NOW, perPerson: Infinity });
  check('same inputs → identical output (deterministic, no clock/model)',
    JSON.stringify(r.insights) === JSON.stringify(r2.insights));
  const p1order = r.byPerson.p1.map((i) => i.type);
  check('p1 ranked birthday > saved_event > recency', p1order[0] === 'birthday' && p1order[1] === 'saved_event' && p1order[2] === 'recency', p1order.join(','));
  check('p1 score-tie (new_fact vs open_goal) broken by fixed type order → open_goal first',
    p1order[3] === 'open_goal' && p1order[4] === 'new_fact', p1order.join(','));

  const feed = computeInsights({ user: proUser, ...signals(), now: NOW, perPerson: 1 }).insights;
  check('feed = one per person (3 non-self people)', feed.length === 3, 'len ' + feed.length);
  check('feed order p1-birthday > p2-reminder > p3-prompt',
    feed[0].personId === 'p1' && feed[0].type === 'birthday' &&
    feed[1].personId === 'p2' && feed[1].type === 'open_reminder' &&
    feed[2].personId === 'p3' && feed[2].type === 'open_prompt',
    feed.map((i) => i.personId + ':' + i.type).join(' '));
  check('limit caps the feed', computeInsights({ user: proUser, ...signals(), now: NOW, perPerson: 1, limit: 2 }).insights.length === 2);

  // ── tier weighting: ring priority tightens recency AND boosts score ──────
  println('tier weighting: Inner/Core 5 watched closer + scored higher');
  const drift = (core) => ({
    context: [{ person_id: 'p4', name: 'Dex', is_core_five: core, relationship_health_score: null, days_since_contact: 20, current_facts: [], active_saved_items: [] }],
    birthdays: [], reminders: [], prompts: [], goals: [],
  });
  check('core five: 20d drift surfaces (threshold 14)',
    (computeInsights({ user: proUser, ...drift(true), now: NOW, perPerson: Infinity }).byPerson.p4 || []).some((i) => i.type === 'recency'));
  check('non-core: 20d drift does NOT surface (threshold 30)',
    !(computeInsights({ user: proUser, ...drift(false), now: NOW, perPerson: Infinity }).byPerson.p4 || []).some((i) => i.type === 'recency'));

  // Isolate the ring boost with a signal whose urgency is tier-independent
  // (birthday urgency depends only on days-until), so the delta is exactly the boost.
  const bday = (core) => ({
    context: [{ person_id: 'p6', name: 'Fin', is_core_five: core, days_since_contact: null, current_facts: [], active_saved_items: [] }],
    birthdays: [{ id: 'p6', name: 'Fin', birthday_month: 3, birthday_day: 1, is_core_five: core }],
    reminders: [], prompts: [], goals: [],
  });
  const finCore = computeInsights({ user: proUser, ...bday(true), now: NOW, perPerson: Infinity }).byPerson.p6.find((i) => i.type === 'birthday');
  const finReg = computeInsights({ user: proUser, ...bday(false), now: NOW, perPerson: Infinity }).byPerson.p6.find((i) => i.type === 'birthday');
  check('core-five boosts the score by exactly 12 (same birthday urgency)', finCore.score - finReg.score === 12, finCore.score + ' vs ' + finReg.score);

  // ── entitlement: Core 5 free/ungated; everyone else Pro/gated (TAG only) ──
  println('entitlement tag: Core 5 free (ungated), everyone else Pro (gated) — no enforcement');
  check('core-five (Ana) insights tagged free + not gated',
    r.byPerson.p1.length > 0 && r.byPerson.p1.every((i) => i.entitlement === 'free' && i.gated === false));
  const nonCore = [...(r.byPerson.p2 || []), ...(r.byPerson.p3 || [])];
  check('non-core (Beto/Cira) insights tagged pro + gated',
    nonCore.length > 0 && nonCore.every((i) => i.entitlement === 'pro' && i.gated === true));
  check('engine computes for ALL people regardless of tag (no filtering)',
    Object.keys(r.byPerson).sort().join(',') === 'p1,p2,p3');

  // ── formatInsight: swappable phrasing, house style (no em dash) ──────────
  println('formatInsight: swappable NL layer, house style');
  const byType = {};
  for (const i of Object.values(r.byPerson).flat()) byType[i.type] = i.message;
  check('birthday phrasing', /birthday is (today|tomorrow|in \d+ days)\./.test(byType.birthday), byType.birthday);
  check('recency phrasing', /since you connected with/.test(byType.recency), byType.recency);
  check('new_fact phrasing', /^Recently learned about/.test(byType.new_fact), byType.new_fact);
  check('open_reminder phrasing', /reminder about/.test(byType.open_reminder), byType.open_reminder);
  check('no em dash in any message', !Object.values(r.byPerson).flat().map((i) => i.message).join(' ').includes('—'));

  // ── read layer: gather → compute wiring, via injected deps ───────────────
  println('read layer: getInsightsForUser / getInsightsForPerson wire gather → compute');
  const s = signals();
  const deps = {
    getAgentContext: async () => s.context,
    getBirthdays: async () => s.birthdays,
    getOpenGoals: async () => s.goals,
    getOpenReminders: async () => s.reminders,
    getOpenPrompts: async () => s.prompts,
  };
  const out = await getInsightsForUser(freeUser, { now: NOW, perPerson: 1 }, deps);
  check('feed returned with generatedAt + 3 items', typeof out.generatedAt === 'string' && out.insights.length === 3);
  check('viewerTier reflects the free viewer', out.viewerTier === 'free');
  check('feed top is the birthday (deterministic through the read layer)', out.insights[0].type === 'birthday' && out.insights[0].personId === 'p1');
  check('viewerTier reflects a pro viewer', (await getInsightsForUser(proUser, { now: NOW }, deps)).viewerTier === 'pro');

  const person = await getInsightsForPerson(proUser, 'p1', { now: NOW }, deps);
  check('getInsightsForPerson returns ALL of that person\'s ranked insights',
    person.personId === 'p1' && person.insights.length === 5 && person.insights.every((i) => i.personId === 'p1'));
  check('getInsightsForPerson on self/unknown → empty',
    (await getInsightsForPerson(proUser, 'self', { now: NOW }, deps)).insights.length === 0);

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
