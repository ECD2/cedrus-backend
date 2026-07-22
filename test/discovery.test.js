// Proof for the Discovery Planner (src/services/discovery.js). The pure core
// (computeDiscoveryPlan) is exercised for EACH interest category + goals +
// people-with-upcoming-dates, deterministic ranking, the cap (global +
// per-type), source-tracing / no-fabrication, self-exclusion, empty-profile,
// and the free/Pro entitlement tag. The read layer (getDiscoveryPlan) is
// exercised via injected deps, including location resolution and the spec §6
// crisis-suppression gate. Concatenated after reliability-core.js + stripped
// src/services/discovery.js by run-tests.sh. Runs under bun/node/jsc.

// Test double for utils/time.js (import-stripped from the bundle): encode
// days-until-birthday directly in birthday_month, exactly as insights.test.js.
function daysUntilBirthday(month, _day, _tz) { return month; }

(async () => {
  const { check, done } = makeChecker();
  const DAY = 86400000;
  const NOW = new Date('2026-07-21T12:00:00Z');           // fixed clock → deterministic
  const at = (deltaDays) => new Date(NOW.getTime() + deltaDays * DAY).toISOString();

  const freeUser = { id: 'u1', plan: 'free', billing_status: null, timezone: 'America/New_York' };
  const proUser = { id: 'u1', plan: 'pro', billing_status: 'active', timezone: 'America/New_York' };

  // Fresh fixtures per call so nothing mutates across assertions. Shapes mirror
  // the real reads: interests = interests.listInterests().interests (active-only),
  // goals = memory.getOpenGoals(), birthdays = people.getBirthdaysForUser(),
  // context = people.getAgentContext() (is_self + active_saved_items).
  const fixtures = () => ({
    interests: [
      { id: 'i1', category: 'sports_team', label: 'Kansas City Chiefs', provenance: 'user_stated', surfacing_state: 'active', last_affirmed_at: at(-2), created_at: at(-100) },
      { id: 'i2', category: 'hobby', label: 'padel', provenance: 'user_stated', surfacing_state: 'active', last_affirmed_at: at(-2), created_at: at(-50) },
      { id: 'i3', category: 'media_show', label: 'Severance', provenance: 'inferred', surfacing_state: 'active', last_affirmed_at: at(-40), created_at: at(-40) },
      { id: 'i4', category: 'media_music', label: 'Radiohead', provenance: 'user_stated', surfacing_state: 'active', last_affirmed_at: at(-5), created_at: at(-5) },
      { id: 'i5', category: 'place', label: 'Miami', provenance: 'user_stated', surfacing_state: 'active', last_affirmed_at: at(-1), created_at: at(-10) },
      // These two categories have no v1 lookup shape — must NOT be planned.
      { id: 'i6', category: 'food', label: 'ramen', provenance: 'user_stated', surfacing_state: 'active', last_affirmed_at: at(-1), created_at: at(-1) },
      { id: 'i7', category: 'other_freeform', label: 'stoicism', provenance: 'user_stated', surfacing_state: 'active', last_affirmed_at: at(-1), created_at: at(-1) },
    ],
    goals: [{ id: 'g1', goal_text: 'run a half marathon', person_id: null, week_of: at(-3), status: 'open' }],
    birthdays: [
      { id: 'p1', name: 'Ana', birthday_month: 3, birthday_day: 1, is_core_five: true },   // 3 days out, core five
      { id: 'p4', name: 'Dex', birthday_month: 2, birthday_day: 1, is_core_five: false },   // 2 days out, non-core
      { id: 'p2', name: 'Beto', birthday_month: 20, birthday_day: 1, is_core_five: false }, // 20 days out → OUTSIDE 14d window
      { id: 'self', name: 'Me', birthday_month: 2, birthday_day: 1, is_core_five: false },  // self → excluded
    ],
    context: [
      { person_id: 'self', name: 'Me', is_self: true },
      { person_id: 'p1', name: 'Ana', is_core_five: true, active_saved_items: [{ title: 'Kaytranada show', event_date: at(5) }] },
      { person_id: 'p4', name: 'Dex', is_core_five: false, active_saved_items: [] },
      { person_id: 'p3', name: 'Cira', is_core_five: false, active_saved_items: [{ title: 'gallery opening', event_date: at(40) }] }, // 40d > 30d window
    ],
  });

  // A location already resolved from the place interest (what the read layer's
  // resolveLocation would produce here), for the pure-core tests.
  const miami = { value: 'Miami', source: { kind: 'interest_place', interestId: 'i5' } };
  const core = (over = {}) => ({ user: proUser, ...fixtures(), location: miami, now: NOW, ...over });

  const r = computeDiscoveryPlan(core());
  const bySubject = (sub) => r.plan.find((x) => x.subject === sub);
  const types = r.plan.map((x) => x.type);
  const subjects = r.plan.map((x) => x.subject);

  // ── each mapped category / goal / person date produces its plan item ───────
  println('each real profile datum produces its plan item; unmapped + self excluded');
  check('sports_schedule from sports_team (subject = team, why = followed team)',
    bySubject('Kansas City Chiefs') && bySubject('Kansas City Chiefs').type === 'sports_schedule' && bySubject('Kansas City Chiefs').why === 'followed team');
  check('local_event from hobby (subject = hobby, near resolved)',
    bySubject('padel') && bySubject('padel').type === 'local_event' && bySubject('padel').near === 'Miami' && bySubject('padel').why === 'hobby');
  check('media_release from media_show (why = followed show)',
    bySubject('Severance') && bySubject('Severance').type === 'media_release' && bySubject('Severance').why === 'followed show');
  check('media_release from media_music (why = followed artist)',
    bySubject('Radiohead') && bySubject('Radiohead').type === 'media_release' && bySubject('Radiohead').why === 'followed artist');
  check('place_context from place (subject = place)',
    bySubject('Miami') && bySubject('Miami').type === 'place_context' && bySubject('Miami').why === 'place you follow');
  check('goal_context from open goal (subject = goal text, verbatim)',
    bySubject('run a half marathon') && bySubject('run a half marathon').type === 'goal_context' && bySubject('run a half marathon').why === 'open goal');
  check('person_occasion from upcoming birthday (Ana, 3d)',
    bySubject("Ana's birthday") && bySubject("Ana's birthday").type === 'person_occasion' && bySubject("Ana's birthday").why === 'upcoming birthday');
  check('person_occasion from upcoming saved event (Kaytranada, 5d)',
    bySubject('Kaytranada show') && bySubject('Kaytranada show').type === 'person_occasion' && bySubject('Kaytranada show').why === 'upcoming event');

  // ── no fabrication: unmapped categories, out-of-window dates, self ─────────
  println('no fabrication: unmapped categories / out-of-window dates / self are absent');
  check('food NOT planned (no v1 lookup shape)', !subjects.includes('ramen'));
  check('other_freeform NOT planned', !subjects.includes('stoicism'));
  check('birthday 20d out is OUTSIDE the 14d window (Beto absent)', !subjects.includes("Beto's birthday"));
  check('saved event 40d out is OUTSIDE the 30d window (gallery opening absent)', !subjects.includes('gallery opening'));
  check('self is excluded (no "Me\'s birthday", no self source)',
    !subjects.includes("Me's birthday") && !r.plan.some((x) => x.source && x.source.personId === 'self'));
  check('every item traces to a real datum via a source.kind',
    r.plan.every((x) => x.source && ['interest', 'goal', 'person'].includes(x.source.kind)));
  check('interest items carry interestId; goal carries goalId; person carries personId',
    bySubject('padel').source.interestId === 'i2' &&
    bySubject('run a half marathon').source.goalId === 'g1' &&
    bySubject("Ana's birthday").source.personId === 'p1');
  check('local_event near is itself source-traced (place interest i5 → Miami)',
    bySubject('padel').source.near && bySubject('padel').source.near.kind === 'interest_place' &&
    bySubject('padel').source.near.interestId === 'i5' && bySubject('padel').source.near.value === 'Miami');

  // ── deterministic ranking ─────────────────────────────────────────────────
  println('ranking is deterministic and correctly ordered');
  const r2 = computeDiscoveryPlan(core());
  check('same inputs → identical output (deterministic, no clock/model/fetch)',
    JSON.stringify(r.plan) === JSON.stringify(r2.plan));
  check('full plan is 9 items (5 mapped interests + 1 goal + 2 person + 1 non-core birthday)',
    r.plan.length === 9, 'len ' + r.plan.length);
  check('top ordering by score: Ana-bday > Kaytranada > Dex-bday > goal > Chiefs > padel',
    subjects.slice(0, 6).join('|') === ["Ana's birthday", 'Kaytranada show', "Dex's birthday", 'run a half marathon', 'Kansas City Chiefs', 'padel'].join('|'),
    subjects.slice(0, 6).join('|'));
  check('score-tie (Severance vs Miami, both 56) broken by fixed type order → media_release first',
    subjects.slice(6).join('|') === ['Radiohead', 'Severance', 'Miami'].join('|'), subjects.slice(6).join('|'));
  check('Ana birthday score = 82 base + 12 (<=3d) + 10 ring = 104', bySubject("Ana's birthday").score === 104, String(bySubject("Ana's birthday").score));
  check('Dex birthday score = 82 + 12 + 0 ring = 94 (non-core, no boost)', bySubject("Dex's birthday").score === 94, String(bySubject("Dex's birthday").score));

  // ── the cap ───────────────────────────────────────────────────────────────
  println('cap: global limit + optional per-type diversity cap');
  check('limit caps the plan to the top N', computeDiscoveryPlan(core({ limit: 3 })).plan.length === 3);
  check('limit=3 keeps exactly the top 3', computeDiscoveryPlan(core({ limit: 3 })).plan.map((x) => x.subject).join('|') === ["Ana's birthday", 'Kaytranada show', "Dex's birthday"].join('|'));
  const perType = computeDiscoveryPlan(core({ maxPerType: 1 })).plan;
  check('maxPerType=1 keeps at most one of each type',
    perType.filter((x) => x.type === 'person_occasion').length === 1 &&
    perType.filter((x) => x.type === 'media_release').length === 1);
  check('maxPerType keeps the HIGHEST-scored of each type (Ana bday, not Kaytranada)',
    perType.find((x) => x.type === 'person_occasion').subject === "Ana's birthday");

  // ── empty profile → empty plan (no invention) ─────────────────────────────
  println('empty profile → empty plan (no invention)');
  const empty = computeDiscoveryPlan({ user: proUser, interests: [], goals: [], birthdays: [], context: [], location: null, now: NOW });
  check('empty profile yields a strictly empty plan', empty.plan.length === 0);
  check('empty plan still returns a generatedAt string', typeof empty.generatedAt === 'string');
  const noLoc = computeDiscoveryPlan(core({ location: null }));
  check('no location → hobby still planned, near = null (not fabricated)',
    noLoc.plan.find((x) => x.subject === 'padel').near === null &&
    !noLoc.plan.find((x) => x.subject === 'padel').source.near);

  // ── entitlement: tag, don't enforce (mirror insights) ─────────────────────
  println('entitlement tag: Core-5 occasion free/ungated; all richer discovery Pro/gated');
  check('Core-5 person occasions tagged free + ungated (Ana bday + Kaytranada)',
    bySubject("Ana's birthday").entitlement === 'free' && bySubject("Ana's birthday").gated === false &&
    bySubject('Kaytranada show').entitlement === 'free' && bySubject('Kaytranada show').gated === false);
  check('non-core person occasion is Pro/gated (Dex birthday)',
    bySubject("Dex's birthday").entitlement === 'pro' && bySubject("Dex's birthday").gated === true);
  check('all interest + goal lookups are Pro/gated (the internet-lookup feature)',
    ['Kansas City Chiefs', 'padel', 'Severance', 'Radiohead', 'Miami', 'run a half marathon']
      .every((s) => bySubject(s).entitlement === 'pro' && bySubject(s).gated === true));
  check('exactly the two Core-5 occasions are free; everything else gated',
    r.plan.filter((x) => x.entitlement === 'free').length === 2);

  // ── formatPlanItem: swappable phrasing, house style (no em dash / no "!") ──
  println('formatPlanItem: swappable NL layer, house style');
  const msgs = r.plan.map((x) => x.message);
  check('every item has a message string', r.plan.every((x) => typeof x.message === 'string' && x.message.length > 0));
  check('sports phrasing', /Look up the Kansas City Chiefs schedule/.test(bySubject('Kansas City Chiefs').message));
  check('local phrasing includes the resolved place', /near Miami/.test(bySubject('padel').message));
  check('birthday phrasing', /Look up ways to mark Ana's birthday/.test(bySubject("Ana's birthday").message));
  check('no em dash in any message', !msgs.join(' ').includes('—'));
  check('no exclamation mark in any message (voice spec)', !msgs.join(' ').includes('!'));

  // ── read layer: gather → resolve location → compute, via injected deps ─────
  println('read layer: getDiscoveryPlan wires gather → resolve → compute');
  const s = fixtures();
  const baseDeps = (over = {}) => ({
    getInterests: async () => s.interests,
    getOpenGoals: async () => s.goals,
    getBirthdays: async () => s.birthdays,
    getAgentContext: async () => s.context,
    getUserLocation: async () => null,
    isInSuppressionWindow: async () => false,
    ...over,
  });

  const feed = await getDiscoveryPlan(proUser, { now: NOW }, baseDeps());
  check('feed returns generatedAt + suppressed:false + a capped plan', typeof feed.generatedAt === 'string' && feed.suppressed === false);
  check('default cap = 6 (the handful, not the firehose)', feed.plan.length === 6, 'len ' + feed.plan.length);
  check('feed top is the Core-5 birthday (deterministic through the read layer)', feed.plan[0].subject === "Ana's birthday");
  check('feed resolved near from the place interest (Miami) end to end', feed.plan.find((x) => x.subject === 'padel').near === 'Miami');
  check('viewerTier reflects the pro viewer', feed.viewerTier === 'pro');
  check('viewerTier reflects a free viewer', (await getDiscoveryPlan(freeUser, { now: NOW }, baseDeps())).viewerTier === 'free');
  check('ownership guard: no user.id throws', await threw(() => getDiscoveryPlan({}, { now: NOW }, baseDeps())));

  // location precedence: caller opts.location > profile > place interest
  const viaCaller = await getDiscoveryPlan(proUser, { now: NOW, location: 'Austin' }, baseDeps());
  check('opts.location wins (caller) and is source-traced as caller',
    viaCaller.plan.find((x) => x.subject === 'padel').near === 'Austin' &&
    viaCaller.plan.find((x) => x.subject === 'padel').source.near.kind === 'caller');
  const viaProfile = await getDiscoveryPlan(proUser, { now: NOW }, baseDeps({ getUserLocation: async () => 'Denver' }));
  check('profile location beats the place interest and is traced as profile',
    viaProfile.plan.find((x) => x.subject === 'padel').near === 'Denver' &&
    viaProfile.plan.find((x) => x.subject === 'padel').source.near.kind === 'profile');

  // ── SAFETY §6: crisis-suppression window silences discovery BEFORE gather ──
  println('safety §6: crisis-suppression window returns an empty plan, before any gather');
  const suppressed = await getDiscoveryPlan(proUser, { now: NOW }, baseDeps({
    isInSuppressionWindow: async () => true,
    // If the gate did not short-circuit, these would throw and fail the test.
    getInterests: async () => { throw new Error('gather ran despite suppression'); },
    getOpenGoals: async () => { throw new Error('gather ran despite suppression'); },
    getBirthdays: async () => { throw new Error('gather ran despite suppression'); },
    getAgentContext: async () => { throw new Error('gather ran despite suppression'); },
  }));
  check('suppressed window → empty plan', suppressed.plan.length === 0);
  check('suppressed window → suppressed:true flag', suppressed.suppressed === true);
  check('suppressed window → gate ran BEFORE gather (no gather deps invoked)', typeof suppressed.generatedAt === 'string');

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();

// Small async-throw probe (no dependency on any harness assert style).
async function threw(fn) {
  try { await fn(); return false; } catch { return true; }
}
