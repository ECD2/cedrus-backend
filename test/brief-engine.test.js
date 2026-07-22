// Proof for the Brief Engine (src/services/briefEngine.js). Exercises the PURE
// stages (selectBriefReasons entitlement + §6 suppression, composeBriefContent
// determinism + voice, buildFirstBrief cold-start without fabrication) and the
// READ layer (generateBrief / generateFirstBrief) via injected gather/compute/
// suppression deps. Concatenated after reliability-core.js + stripped
// src/services/briefEngine.js by run-tests.sh. Runs under bun/node/jsc.

(async () => {
  const { check, done } = makeChecker();
  const NOW = new Date('2026-07-21T12:00:00Z');

  const freeUser = { id: 'u1', name: 'Emil', plan: 'free', billing_status: null, timezone: 'America/New_York' };
  const proUser = { id: 'u1', name: 'Emil', plan: 'pro', billing_status: 'active', timezone: 'America/New_York' };

  const mk = (o) => Object.assign({
    personId: 'p', personName: 'X', isCoreFive: false, type: 'recency', score: 50,
    detail: {}, entitlement: 'pro', gated: true, message: 'A reason.',
  }, o);

  // A ranked, entitlement-tagged feed (one per person) exactly as computeInsights
  // returns it: two Core 5 (free/ungated) reasons, two outside-circle (Pro/gated).
  const feed = () => ([
    mk({ personId: 'p1', personName: 'Ana', isCoreFive: true, type: 'birthday', score: 108, entitlement: 'free', gated: false, message: "Ana's birthday is in 2 days." }),
    mk({ personId: 'p2', personName: 'Beto', isCoreFive: true, type: 'recency', score: 70, entitlement: 'free', gated: false, message: "It's been about 3 weeks since you connected with Beto." }),
    mk({ personId: 'p3', personName: 'Cira', isCoreFive: false, type: 'recency', score: 65, entitlement: 'pro', gated: true, message: "It's been about 6 weeks since you connected with Cira." }),
    mk({ personId: 'p4', personName: 'Dex', isCoreFive: false, type: 'birthday', score: 60, entitlement: 'pro', gated: true, message: "Dex's birthday is in 5 days." }),
  ]);

  // ── entitlement: Core 5 reasons free/actionable; gated Pro reasons -> teaser ──
  println('select: entitlement — free sees Core 5 only; Pro sees everyone');
  const freeSel = selectBriefReasons(freeUser, { insights: feed() });
  check('free: only ungated (Core 5) reasons are actionable',
    freeSel.reasons.length === 2 && freeSel.reasons.every((r) => r.gated === false && r.entitlement === 'free'),
    JSON.stringify(freeSel.reasons.map((r) => r.personName + ':' + r.entitlement)));
  check('free: gated (outside-circle) people become the teaser',
    !!freeSel.teaser && freeSel.teaser.count === 2 && freeSel.teaser.names.join(',') === 'Cira,Dex',
    JSON.stringify(freeSel.teaser));
  check('free: no action offers ever', freeSel.reasons.every((r) => r.actionOffer === false));

  const proSel = selectBriefReasons(proUser, { insights: feed() });
  check('pro: all people actionable incl. gated (capped to 3)',
    proSel.reasons.length === 3 && proSel.reasons.some((r) => r.gated === true),
    JSON.stringify(proSel.reasons.map((r) => r.personName)));
  check('pro: action offers on', proSel.reasons.every((r) => r.actionOffer === true));
  check('pro: no teaser (teaser is a free-tier upsell)', proSel.teaser === null);
  check('select keeps the insight feed order (already ranked)',
    proSel.reasons[0].personName === 'Ana' && proSel.reasons[1].personName === 'Beto' && proSel.reasons[2].personName === 'Cira');

  // ── §6 crisis suppression — the load-bearing safety contract, insight path ──
  println('select: §6 suppression strips promo (teaser + offers), keeps factual reasons');
  const proSup = selectBriefReasons(proUser, { insights: feed() }, { suppressPromo: true });
  check('pro suppressed: every action offer off', proSup.reasons.length > 0 && proSup.reasons.every((r) => r.actionOffer === false));
  check('pro suppressed: same factual reason count as normal', proSup.reasons.length === proSel.reasons.length);
  check('pro suppressed: closing question unchanged', proSup.closingQuestion === proSel.closingQuestion);
  check('pro suppressed: suppressed flag set', proSup.suppressed === true);

  const freeSup = selectBriefReasons(freeUser, { insights: feed() }, { suppressPromo: true });
  check('free suppressed: teaser (upsell) removed', freeSup.teaser === null, JSON.stringify(freeSup.teaser));
  check('free suppressed: Core 5 factual reasons still present', freeSup.reasons.length === 2 && freeSup.reasons.some((r) => r.type === 'birthday'));

  // ── quiet ──
  println('select: quiet when nothing surfaces');
  const quietSel = selectBriefReasons(proUser, { insights: [] });
  check('quiet flag set when no reasons', quietSel.quiet === true && quietSel.reasons.length === 0);

  // ── compose: deterministic, voice-safe, acknowledge -> task -> open-door ──
  println('compose: deterministic, voice-safe, compose.js-compatible plan');
  const composed = composeBriefContent(proUser, proSel, { now: NOW });
  check('variant weekly + viewerTier pro', composed.variant === 'weekly' && composed.viewerTier === 'pro');
  check('text is voice-safe (no em dash / exclamation / banned cheer)', composed.voice.ok === true, JSON.stringify(composed.voice.violations));
  check('every reason message appears in the text', proSel.reasons.every((r) => composed.text.includes(r.detail)));
  check('open-door: text ends on the closing question', /\?$/.test(composed.text), composed.text);
  check('acknowledge: text opens with a warm line, not a reason', composed.text.startsWith('Hey Emil.'), composed.text);
  check('plan matches compose.js shape (items/planTier/closingQuestion)',
    Array.isArray(composed.plan.items) && composed.plan.items.length === proSel.reasons.length &&
    composed.plan.planTier === 'pro' && typeof composed.plan.closingQuestion === 'string');
  check('same inputs -> identical text (deterministic, no clock/model)',
    composeBriefContent(proUser, proSel, { now: NOW }).text === composed.text);

  println('compose: a self note is acknowledged WITHOUT resurfacing the raw fact');
  const withSelf = composeBriefContent(freeUser, selectBriefReasons(freeUser, { insights: feed(), selfNote: 'lost my job' }), { now: NOW });
  check('raw negative self note never printed in the text', !withSelf.text.includes('lost my job'), withSelf.text);
  check('but it is threaded into the plan for the model path', withSelf.plan.selfNote === 'lost my job');
  check('self-note brief still voice-safe', withSelf.voice.ok === true, JSON.stringify(withSelf.voice.violations));

  println('compose: a quiet week is acknowledged, never manufactured');
  const quietComposed = composeBriefContent(proUser, quietSel, { now: NOW });
  check('quiet text still invites one reach-out (ends on the question)', /\?$/.test(quietComposed.text));
  check('quiet text voice-safe', quietComposed.voice.ok === true);

  // ── voiceScan backstop ──
  println('voiceScan: catches em dash, exclamation, banned cheer');
  check('clean line passes', voiceScan('All good here. Who is on your mind.').ok === true);
  check('exclamation + cheer flagged', (() => { const v = voiceScan('This is great!'); return !v.ok && v.violations.includes('exclamation') && v.violations.includes('banned_cheer:great'); })());
  check('em dash flagged', voiceScan('A thought — here').violations.includes('em_dash'));

  // ── buildFirstBrief: onboarding payoff from a thin profile, no fabrication ──
  println('first brief: thin profile reflects ONLY real people / interests / goals');
  const profile = {
    people: [
      { id: 'self', name: 'Emil', is_self: true },       // self excluded
      { id: 'p1', name: 'Ana', relationship: 'sister' },
      { id: 'p2', name: 'Beto' },
    ],
    interests: [
      { category: 'sports_team', label: 'Inter Miami' },
      { category: 'hobby', label: 'bouldering' },
    ],
    goals: [{ goal_text: 'call my dad on Sundays' }],
    location: 'Miami',
  };
  const realBday = [mk({ personId: 'p1', personName: 'Ana', isCoreFive: true, type: 'birthday', entitlement: 'free', gated: false, message: "Ana's birthday is in 4 days." })];
  const first = buildFirstBrief(freeUser, profile, { insights: realBday, now: NOW });
  check('variant first, not empty', first.variant === 'first' && first.empty === false && first.quiet === false);
  check('greets by name', first.text.startsWith('Good to have you here, Emil.'), first.text);
  check('reflects the real people they named', first.text.includes('Ana') && first.text.includes('Beto'));
  check('excludes the self person from the greeting', first.sections.people.every((p) => p.id !== 'self') && first.sections.people.length === 2);
  check('surfaces a REAL insight (a birthday they entered)', first.text.includes("Ana's birthday is in 4 days."));
  check('reflects real interests', first.text.includes('Inter Miami') && first.text.includes('bouldering'));
  check('a freshly-set goal reads forward-looking, not the weekly past tense',
    /You set a goal to call my dad on Sundays/.test(first.text) && !/hope you got/i.test(first.text), first.text);
  check('does NOT invent a person who was never named', !first.text.includes('Zed') && !/reached out to/i.test(first.text));
  check('open-door question present', /\?$/.test(first.text.trim()) || first.text.includes('?'));
  check('first brief voice-safe', first.voice.ok === true, JSON.stringify(first.voice.violations));

  println('first brief: the truly-empty cold start is honest, never fabricated');
  const empty = buildFirstBrief(freeUser, { people: [], interests: [], goals: [], location: null }, { insights: [], now: NOW });
  check('empty flagged', empty.empty === true && empty.quiet === true);
  check('says plainly there is no one yet', /do not have anyone in here yet/i.test(empty.text), empty.text);
  check('still opens a door (invites the first person)', /tell me about someone/i.test(empty.text));
  check('empty brief fabricates nothing (no names, no fake activity)',
    !/birthday|reached out|slipping|weeks since/i.test(empty.text), empty.text);
  check('empty brief voice-safe', empty.voice.ok === true, JSON.stringify(empty.voice.violations));

  // ── read layer: generateBrief wires gather -> compute -> select -> compose ──
  println('read layer: generateBrief threads injected gather/compute/suppression');
  const ctxWithSelf = [{ person_id: 'self', name: 'Emil', is_self: true, current_facts: [{ type: 'life_event', value: 'lost my job', created_at: NOW.toISOString() }] }];
  const genDeps = (suppressed) => ({
    gatherInsightSignals: async () => ({ context: ctxWithSelf, birthdays: [], goals: [{ id: 'g1', person_id: 'p1', goal_text: 'grab coffee with Ana' }], reminders: [], prompts: [] }),
    computeInsights: () => ({ insights: feed(), generatedAt: NOW.toISOString() }),
    isInSuppressionWindow: async () => suppressed,
  });
  const genPro = await generateBrief(proUser, { now: NOW }, genDeps(false));
  check('generateBrief returns a composed weekly brief', genPro.variant === 'weekly' && genPro.text.length > 0);
  check('reasons flowed through from the (injected) insight feed', genPro.sections.reasons.length === 3);
  check('goal follow-up threaded from signals.goals', !!genPro.plan.goalFollowup && genPro.plan.goalFollowup.goalText === 'grab coffee with Ana');
  check('self note threaded but not resurfaced in text', genPro.plan.selfNote === 'lost my job' && !genPro.text.includes('lost my job'));
  check('generateBrief output voice-safe', genPro.voice.ok === true, JSON.stringify(genPro.voice.violations));

  const genProSup = await generateBrief(proUser, { now: NOW }, genDeps(true));
  check('generateBrief honors §6 window: suppressed + no action offers',
    genProSup.suppressed === true && genProSup.sections.reasons.every((r) => r.actionOffer === false));
  const genFreeSup = await generateBrief(freeUser, { now: NOW }, genDeps(true));
  check('generateBrief free + §6: teaser suppressed, factual reasons remain',
    genFreeSup.sections.teaser === null && genFreeSup.sections.reasons.length === 2);

  let threw = false;
  try { await generateBrief({}, {}, genDeps(false)); } catch { threw = true; }
  check('generateBrief enforces the ownership guard (user.id required)', threw);

  // ── read layer: generateFirstBrief gathers the thin profile ──
  println('read layer: generateFirstBrief gathers people + interests + goals');
  const firstDeps = {
    gatherInsightSignals: async () => ({ context: [{ person_id: 'self', name: 'Emil', is_self: true }, { person_id: 'p1', name: 'Ana', relationship: 'sister' }], birthdays: [], goals: [{ id: 'g1', person_id: 'p1', goal_text: 'call my dad' }], reminders: [], prompts: [] }),
    computeInsights: () => ({ insights: [], generatedAt: NOW.toISOString() }),
    listInterests: async () => ({ interests: [{ category: 'hobby', label: 'bouldering' }] }),
    isInSuppressionWindow: async () => false,
  };
  const genFirst = await generateFirstBrief({ ...freeUser, location: 'Miami' }, { now: NOW }, firstDeps);
  check('generateFirstBrief returns a first brief', genFirst.variant === 'first');
  check('gathered the real person (Ana), excluded self', genFirst.sections.people.length === 1 && genFirst.sections.people[0].name === 'Ana');
  check('gathered the real interest (bouldering)', genFirst.text.includes('bouldering'));
  check('carried location into sections', genFirst.sections.location === 'Miami');
  check('generateFirstBrief voice-safe', genFirst.voice.ok === true, JSON.stringify(genFirst.voice.violations));

  const genFirstEmpty = await generateFirstBrief(freeUser, { now: NOW }, {
    gatherInsightSignals: async () => ({ context: [{ person_id: 'self', name: 'Emil', is_self: true }], birthdays: [], goals: [], reminders: [], prompts: [] }),
    computeInsights: () => ({ insights: [] }),
    listInterests: async () => ({ interests: [] }),
    isInSuppressionWindow: async () => false,
  });
  check('generateFirstBrief cold start is honest + empty', genFirstEmpty.empty === true && /do not have anyone in here yet/i.test(genFirstEmpty.text));

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
