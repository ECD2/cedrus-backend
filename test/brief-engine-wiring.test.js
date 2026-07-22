// End-to-end proof that the REAL insight engine feeds the brief. Unlike
// brief-engine.test.js (which injects a fake feed), this bundle concatenates the
// REAL src/services/insights.js AND src/services/briefEngine.js, seeds real
// signals, and drives generateBrief with the REAL computeInsights (resolved as the
// read layer's default). It proves: real ranked/entitlement-tagged insights flow
// into the brief, free vs Pro is honored end to end, and §6 suppression still
// fires on the real path. Concatenated after reliability-core.js by run-tests.sh.

// Test double for utils/time.js (import-stripped from insights.js): encode
// days-until-birthday directly in birthday_month, exactly as insights.test.js.
function daysUntilBirthday(month, _day, _tz) { return month; }

(async () => {
  const { check, done } = makeChecker();
  const DAY = 86400000;
  const NOW = new Date('2026-07-21T12:00:00Z');
  const at = (d) => new Date(NOW.getTime() + d * DAY).toISOString();

  const freeUser = { id: 'u1', name: 'Emil', plan: 'free', billing_status: null, timezone: 'America/New_York' };
  const proUser = { id: 'u1', name: 'Emil', plan: 'pro', billing_status: 'active', timezone: 'America/New_York' };

  // Real, realistic signals (fresh per call). Ana is Core 5; Beto is outside the
  // circle. Both are drifting; Ana also has a birthday 3 days out (stub -> month).
  const signals = () => ({
    context: [
      { person_id: 'self', name: 'Me', is_self: true, current_facts: [{ type: 'mood', value: 'tired', created_at: at(-1) }], active_saved_items: [] },
      { person_id: 'p1', name: 'Ana', is_core_five: true, relationship_health_score: 30, days_since_contact: 40,
        current_facts: [{ type: 'life_event', value: 'started a new job', created_at: at(-2) }],
        active_saved_items: [{ title: 'Kaytranada show', event_date: at(5) }] },
      { person_id: 'p2', name: 'Beto', is_core_five: false, relationship_health_score: 35, days_since_contact: 45, current_facts: [], active_saved_items: [] },
    ],
    birthdays: [{ id: 'p1', name: 'Ana', birthday_month: 3, birthday_day: 1, is_core_five: true }],
    goals: [{ id: 'g1', person_id: 'p1', goal_text: 'grab coffee with Ana' }],
    reminders: [], prompts: [],
  });

  // Read-layer deps: inject the gather (seeded signals) + the §6 window (safetyFlags
  // is NOT in this bundle). computeInsights is deliberately NOT injected, so the read
  // layer resolves the REAL computeInsights default — that IS the wiring under test.
  const deps = (suppressed) => ({
    gatherInsightSignals: async () => signals(),
    isInSuppressionWindow: async () => !!suppressed,
  });

  // ── the real engine tags the feed the brief will consume ──
  println('wiring: the REAL computeInsights produces the entitlement-tagged feed');
  const { insights: realFeed } = computeInsights({ user: proUser, ...signals(), now: NOW, perPerson: 1 });
  const ana = realFeed.find((i) => i.personId === 'p1');
  const beto = realFeed.find((i) => i.personId === 'p2');
  check('self excluded from the feed', !realFeed.some((i) => i.personId === 'self'));
  check('Ana (Core 5) tagged free + ungated, top reason is her birthday', ana && ana.entitlement === 'free' && ana.gated === false && ana.type === 'birthday', ana && ana.type);
  check('Beto (outside circle) tagged pro + gated', beto && beto.entitlement === 'pro' && beto.gated === true);

  // ── free: real feed -> only Core 5 actionable, outside people become teaser ──
  println('wiring: generateBrief (free) surfaces Core 5 reasons + a real teaser');
  const gFree = await generateBrief(freeUser, { now: NOW }, deps(false));
  check('free brief: exactly the ungated reason(s) are actionable', gFree.sections.reasons.length === 1 && gFree.sections.reasons[0].personName === 'Ana' && gFree.sections.reasons[0].gated === false);
  check('free brief: the gated outside person becomes the teaser', !!gFree.sections.teaser && gFree.sections.teaser.count === 1 && gFree.sections.teaser.names.join(',') === 'Beto');
  check("free brief text carries Ana's real birthday reason", gFree.text.includes("Ana's birthday is in 3 days."), gFree.text);
  check('free brief text names the drifting outside person', gFree.text.includes('Beto'));
  check('free brief is voice-safe', gFree.voice.ok === true, JSON.stringify(gFree.voice.violations));

  // ── pro: real feed -> everyone actionable, no teaser ──
  println('wiring: generateBrief (pro) surfaces everyone, no teaser');
  const gPro = await generateBrief(proUser, { now: NOW }, deps(false));
  check('pro brief: gated (outside) reason is now actionable', gPro.sections.reasons.length === 2 && gPro.sections.reasons.some((r) => r.personName === 'Beto' && r.gated === true));
  check('pro brief: action offers on', gPro.sections.reasons.every((r) => r.actionOffer === true));
  check('pro brief: no teaser', gPro.sections.teaser === null);
  check('pro brief text carries the real recency reason for Beto', /It's been about 6 weeks since you connected with Beto\./.test(gPro.text), gPro.text);
  check('pro brief is voice-safe', gPro.voice.ok === true, JSON.stringify(gPro.voice.violations));

  // ── deterministic through the whole real stack ──
  println('wiring: deterministic gather -> compute -> select -> compose');
  const gPro2 = await generateBrief(proUser, { now: NOW }, deps(false));
  check('same inputs -> identical brief text', gPro2.text === gPro.text);

  // ── §6 suppression still fires on the real path ──
  println('wiring: §6 suppression holds end to end (real feed)');
  const gProSup = await generateBrief(proUser, { now: NOW }, deps(true));
  check('pro + §6: suppressed flag set, every action offer off', gProSup.suppressed === true && gProSup.sections.reasons.every((r) => r.actionOffer === false));
  check('pro + §6: factual reasons still flow (count unchanged)', gProSup.sections.reasons.length === gPro.sections.reasons.length);
  const gFreeSup = await generateBrief(freeUser, { now: NOW }, deps(true));
  check('free + §6: teaser (upsell) suppressed', gFreeSup.sections.teaser === null);
  check('free + §6: Core 5 factual reason still present', gFreeSup.sections.reasons.length === 1 && gFreeSup.sections.reasons[0].personName === 'Ana');

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
