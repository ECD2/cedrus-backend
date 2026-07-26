// Proof for user-set goals (src/services/goals.js). Two things are proven:
//
//   1. selectVitalFew / compareGoalsForFocus — the PURE, deterministic 3–5
//      ranking (priority desc, created_at asc, id asc): ordering, every
//      tiebreak, clamping to the max, order-independence (determinism),
//      non-mutation, and the empty/below-floor edges.
//
//   2. the store/read layer (add / list / update / remove / getVitalFew) over
//      the reliability-core mock db: UNLIMITED storage, the load-bearing
//      isolation (a user-set goal is origin='user_set' + status='active', so a
//      read mimicking memory.getOpenGoals — .eq('status','open') — never sees
//      it), ownership scoping (foreign id → 404, cross-tenant invisible),
//      origin scoping (the route can't touch a pipeline intention),
//      server-owned field rejection, person_id ownership, and input validation.
//
// Note on ids: the mock db mints non-UUID ids ('id_<n>'); the service (rightly)
// gates update/remove behind UUID_RE so a malformed id can't reach Postgres as
// a 500. So create-then-mutate flows seed rows with real UUID-shaped ids via
// seedRow() rather than round-tripping the mock id. In production Supabase
// returns real UUIDs, so the gate and these tests agree.
//
// Concatenated after test/reliability-core.js + import/export-stripped
// src/services/goals.js by run-tests.sh. Runs under bun/node/jsc.

(async () => {
  const { check, done } = makeChecker();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  let uidSeq = 0;
  const uuid = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const seedRow = (o) => ({
    id: o.id || uuid(++uidSeq),
    user_id: o.user_id || 'u1',
    origin: o.origin || 'user_set',
    status: o.status || 'active',
    priority: o.priority == null ? 0 : o.priority,
    goal_text: o.goal_text || 'g',
    person_id: o.person_id == null ? null : o.person_id,
    due_at: o.due_at == null ? null : o.due_at,
    week_of: o.week_of == null ? null : o.week_of,
    completed_at: o.completed_at == null ? null : o.completed_at,
    created_at: o.created_at || '2026-01-01T00:00:00Z',
    updated_at: o.updated_at == null ? null : o.updated_at,
  });

  // ── 1. selectVitalFew: PURE deterministic ranking ─────────────────────────
  println('vital few: pure, deterministic 3–5 selection');

  // Distinct priorities → strict priority-desc order.
  const byPriority = [
    { id: 'a', priority: 10, created_at: '2026-01-01T00:00:00Z' },
    { id: 'b', priority: 90, created_at: '2026-01-01T00:00:00Z' },
    { id: 'c', priority: 50, created_at: '2026-01-01T00:00:00Z' },
  ];
  check('orders by priority descending',
    eq(selectVitalFew(byPriority).map((g) => g.id), ['b', 'c', 'a']));

  // Equal priority → older created_at first.
  const byAge = [
    { id: 'new', priority: 5, created_at: '2026-06-01T00:00:00Z' },
    { id: 'old', priority: 5, created_at: '2026-01-01T00:00:00Z' },
    { id: 'mid', priority: 5, created_at: '2026-03-01T00:00:00Z' },
  ];
  check('breaks a priority tie by created_at ascending (older first)',
    eq(selectVitalFew(byAge).map((g) => g.id), ['old', 'mid', 'new']));

  // Equal priority AND created_at → id ascending (final total-order tiebreak).
  const byId = [
    { id: 'z', priority: 1, created_at: '2026-01-01T00:00:00Z' },
    { id: 'm', priority: 1, created_at: '2026-01-01T00:00:00Z' },
    { id: 'a', priority: 1, created_at: '2026-01-01T00:00:00Z' },
  ];
  check('breaks a full tie by id ascending (stable to the row)',
    eq(selectVitalFew(byId).map((g) => g.id), ['a', 'm', 'z']));

  // Missing priority sorts as 0 (below any positive priority).
  const mixedPriority = [
    { id: 'has', priority: 3, created_at: '2026-01-01T00:00:00Z' },
    { id: 'none', created_at: '2026-01-01T00:00:00Z' },
  ];
  check('a missing priority sorts as 0',
    eq(selectVitalFew(mixedPriority).map((g) => g.id), ['has', 'none']));

  // Clamp to the max: 7 in → exactly 5 out, the top 5.
  const seven = Array.from({ length: 7 }, (_, i) => ({
    id: 'g' + i, priority: i, created_at: '2026-01-01T00:00:00Z',
  }));
  const fewOfSeven = selectVitalFew(seven);
  check('caps the vital few at VITAL_FEW_MAX (5)', fewOfSeven.length === VITAL_FEW_MAX);
  check('keeps exactly the top 5 by priority (g6..g2)',
    eq(fewOfSeven.map((g) => g.id), ['g6', 'g5', 'g4', 'g3', 'g2']));
  check('VITAL_FEW_MAX is 5 and VITAL_FEW_MIN is 3', VITAL_FEW_MAX === 5 && VITAL_FEW_MIN === 3);

  // Determinism: the SAME goals in a different arrival order yield the SAME few.
  const shuffled = [seven[3], seven[0], seven[6], seven[1], seven[5], seven[2], seven[4]];
  check('deterministic: input order does not change the output',
    eq(selectVitalFew(seven), selectVitalFew(shuffled)));

  // Purity: the input array is never mutated.
  const original = [seven[2], seven[0], seven[1]];
  const snapshot = original.map((g) => g.id);
  selectVitalFew(original);
  check('does not mutate its input array', eq(original.map((g) => g.id), snapshot));

  // Edges.
  check('empty in → empty out', eq(selectVitalFew([]), []));
  check('non-array in → empty out (defensive)', eq(selectVitalFew(null), []));
  check('fewer than the max are all returned', selectVitalFew(byPriority).length === 3);
  check('a custom max is honored', selectVitalFew(seven, { max: 2 }).length === 2);

  // compareGoalsForFocus is a proper comparator (exported for reuse).
  check('compareGoalsForFocus: higher priority sorts first (negative)',
    compareGoalsForFocus({ id: 'x', priority: 9 }, { id: 'y', priority: 1 }) < 0);

  // ── 2. store/read layer over the mock db ──────────────────────────────────
  const user = { id: 'u1' };
  const other = { id: 'u2' };

  // add: stores a user-set, active goal and returns a clean public shape ──────
  println('add: stores an active user-set goal, unlimited, public shape only');
  __reset();
  const added = await addGoal({ user, body: { goal_text: '  Run a half marathon  ' } });
  check('add returns created:true', added.created === true);
  check('add trims and stores the goal text', added.goal.goal_text === 'Run a half marathon');
  check('add defaults priority to 0', added.goal.priority === 0);
  check('add sets status active', added.goal.status === 'active');
  check('add stamps created_at', typeof added.goal.created_at === 'string' && added.goal.created_at.length > 0);
  check('public shape hides user_id / origin / week_of',
    !('user_id' in added.goal) && !('origin' in added.goal) && !('week_of' in added.goal));
  // The stored row carries the isolation columns even though they never surface.
  const storedRow = __rows('user_goals').find((r) => r.id === added.goal.id);
  check('stored row is origin=user_set', storedRow.origin === 'user_set');
  check('stored row is status=active (NOT open)', storedRow.status === 'active');
  check('stored row week_of is null (not a weekly intention)', storedRow.week_of === null);

  // unlimited: no per-user cap ────────────────────────────────────────────────
  println('add: unlimited — no per-user storage cap');
  __reset();
  for (let i = 0; i < 12; i++) await addGoal({ user, body: { goal_text: 'goal ' + i, priority: i } });
  const all = await listGoals({ user, status: 'all' });
  check('12 goals all stored (unlimited)', all.goals.length === 12);

  // add validation ────────────────────────────────────────────────────────────
  println('add: input validation');
  __reset();
  check('empty text → 422', await rejectedWith(() => addGoal({ user, body: { goal_text: '   ' } }), 422));
  check('missing text → 422', await rejectedWith(() => addGoal({ user, body: {} }), 422));
  check('non-object body → 422', await rejectedWith(() => addGoal({ user, body: 'nope' }), 422));
  const tooLong = 'x'.repeat(MAX_GOAL_TEXT_CHARS + 1);
  check('over-long text → 422', await rejectedWith(() => addGoal({ user, body: { goal_text: tooLong } }), 422));
  check('float priority → 422', await rejectedWith(() => addGoal({ user, body: { goal_text: 'g', priority: 1.5 } }), 422));
  check('out-of-range priority → 422', await rejectedWith(() => addGoal({ user, body: { goal_text: 'g', priority: 999 } }), 422));
  check('bad due_at → 422', await rejectedWith(() => addGoal({ user, body: { goal_text: 'g', due_at: 'someday' } }), 422));
  check('server-owned field (status) → 422', await rejectedWith(() => addGoal({ user, body: { goal_text: 'g', status: 'active' } }), 422));
  check('server-owned field (origin) → 422', await rejectedWith(() => addGoal({ user, body: { goal_text: 'g', origin: 'cedrus_inferred' } }), 422));

  // optional fields: priority, due_at, person_id ownership ─────────────────────
  println('add: optional priority / due_at / person_id (ownership-checked)');
  __reset();
  __seed('people', [{ id: '11111111-1111-1111-1111-111111111111', user_id: 'u1', name: 'Ana' }]);
  const withOpts = await addGoal({ user, body: {
    goal_text: 'Call Ana weekly', priority: 40,
    due_at: '2026-08-01T09:00:00Z', person_id: '11111111-1111-1111-1111-111111111111',
  } });
  check('valid priority stored', withOpts.goal.priority === 40);
  check('due_at normalized to ISO', withOpts.goal.due_at === '2026-08-01T09:00:00.000Z');
  check('owned person_id stored', withOpts.goal.person_id === '11111111-1111-1111-1111-111111111111');
  check('foreign person_id → 422 (never a dangling cross-tenant link)',
    await rejectedWith(() => addGoal({ user, body: {
      goal_text: 'x', person_id: '22222222-2222-2222-2222-222222222222',
    } }), 422));
  check('malformed person_id → 422',
    await rejectedWith(() => addGoal({ user, body: { goal_text: 'x', person_id: 'not-a-uuid' } }), 422));

  // list: default active-only, filters, focus order ───────────────────────────
  println('list: default active-only, status filter, focus order');
  __reset();
  __seed('user_goals', [
    seedRow({ goal_text: 'low', priority: 1, status: 'active' }),
    seedRow({ goal_text: 'high', priority: 99, status: 'active' }),
    seedRow({ goal_text: 'mid', priority: 50, status: 'completed', completed_at: '2026-02-01T00:00:00Z' }),
  ]);
  const active = await listGoals({ user });
  check('default lists active only (completed excluded)',
    active.goals.length === 2 && active.goals.every((g) => g.status === 'active'));
  check('active list is in focus order (high before low)',
    eq(active.goals.map((g) => g.goal_text), ['high', 'low']));
  const completed = await listGoals({ user, status: 'completed' });
  check('status=completed shows only completed', completed.goals.length === 1 && completed.goals[0].goal_text === 'mid');
  const listAll = await listGoals({ user, status: 'all' });
  check('status=all shows both', listAll.goals.length === 3);
  check('bad list filter → 422', await rejectedWith(() => listGoals({ user, status: 'bogus' }), 422));

  // ISOLATION: a user-set goal is invisible to a memory.getOpenGoals-shaped read
  println('isolation: user-set goals never leak into the weekly-intention reads');
  __reset();
  // A pipeline-captured intention (what memory.addGoal writes): origin inferred,
  // status open, a week + a person.
  __seed('user_goals', [{
    id: 'inferred-1', user_id: 'u1', origin: 'cedrus_inferred', status: 'open',
    goal_text: 'reach out to Ana', person_id: 'p-ana', week_of: '2026-07-20', created_at: '2026-07-20T00:00:00Z',
  }]);
  await addGoal({ user, body: { goal_text: 'user-set standing goal', priority: 80 } });
  // The exact filter memory.getOpenGoals / getOpenGoalsThisWeek / relationships
  // use: .eq('user_id').eq('status','open'). It must see ONLY the inferred row.
  const openShaped = await supabase.from('user_goals').select('*')
    .eq('user_id', 'u1').eq('status', 'open');
  check('an .eq(status,open) read returns ONLY the inferred intention',
    openShaped.data.length === 1 && openShaped.data[0].id === 'inferred-1');
  check("that read never returns the user-set goal (brief's getOpenGoals()[0] is safe)",
    !openShaped.data.some((r) => r.origin === 'user_set'));
  const mine = await listGoals({ user, status: 'all' });
  check('listGoals never returns the inferred intention (origin scoped)',
    mine.goals.length === 1 && mine.goals[0].goal_text === 'user-set standing goal');
  const vf = await getVitalFew({ user });
  check('getVitalFew never includes the inferred intention',
    vf.total === 1 && vf.vitalFew.every((g) => g.goal_text === 'user-set standing goal'));

  // update: edit / re-rank / complete / reactivate; ownership + origin scope ───
  println('update: edit, re-rank, complete, reactivate; ownership + origin scope');
  __reset();
  const gid = uuid(100);
  const infId = '44444444-4444-4444-4444-444444444444';
  __seed('user_goals', [
    seedRow({ id: gid, goal_text: 'draft', priority: 10, status: 'active' }),
    seedRow({ id: infId, goal_text: 'intention', origin: 'cedrus_inferred', status: 'open' }),
  ]);
  const renamed = await updateGoal({ user, goalId: gid, patch: { goal_text: 'final', priority: 70 } });
  check('rename + re-rank applied', renamed.goal.goal_text === 'final' && renamed.goal.priority === 70);
  const doneG = await updateGoal({ user, goalId: gid, patch: { status: 'completed' } });
  check('complete sets status + stamps completed_at',
    doneG.goal.status === 'completed' && typeof doneG.goal.completed_at === 'string');
  const reopened = await updateGoal({ user, goalId: gid, patch: { status: 'active' } });
  check('reactivate clears completed_at', reopened.goal.status === 'active' && reopened.goal.completed_at === null);
  check('empty patch → 422', await rejectedWith(() => updateGoal({ user, goalId: gid, patch: {} }), 422));
  check('unknown patch field → 422', await rejectedWith(() => updateGoal({ user, goalId: gid, patch: { color: 'red' } }), 422));
  check('bad status → 422', await rejectedWith(() => updateGoal({ user, goalId: gid, patch: { status: 'open' } }), 422));
  check('malformed id → 404', await rejectedWith(() => updateGoal({ user, goalId: 'nope', patch: { priority: 1 } }), 404));
  check('unknown id → 404', await rejectedWith(() => updateGoal({ user, goalId: '33333333-3333-3333-3333-333333333333', patch: { priority: 1 } }), 404));
  // Cannot mutate a pipeline intention through this route (origin scoped).
  check('update refuses an inferred goal (origin scoped) → 404',
    await rejectedWith(() => updateGoal({ user, goalId: infId, patch: { priority: 1 } }), 404));

  // remove: real delete; ownership + origin scope ─────────────────────────────
  println('remove: real delete; ownership + origin scope');
  __reset();
  const delId = uuid(200);
  const infId2 = '66666666-6666-6666-6666-666666666666';
  __seed('user_goals', [
    seedRow({ id: delId, goal_text: 'delete me' }),
    seedRow({ id: infId2, goal_text: 'intention', origin: 'cedrus_inferred', status: 'open' }),
  ]);
  const removed = await removeGoal({ user, goalId: delId });
  check('remove returns removed:true + id', removed.removed === true && removed.id === delId);
  check('the row is gone', __rows('user_goals').every((r) => r.id !== delId));
  check('remove unknown id → 404', await rejectedWith(() => removeGoal({ user, goalId: '55555555-5555-5555-5555-555555555555' }), 404));
  check('remove refuses an inferred goal (origin scoped) → 404',
    await rejectedWith(() => removeGoal({ user, goalId: infId2 }), 404));

  // cross-tenant: another user's goal is invisible and untouchable ────────────
  println('cross-tenant: a foreign goal is invisible and untouchable');
  __reset();
  const mineId = uuid(300);
  __seed('user_goals', [seedRow({ id: mineId, goal_text: 'mine', user_id: 'u1' })]);
  check("other user's list does not see it", (await listGoals({ user: other, status: 'all' })).goals.length === 0);
  check('other user cannot update it → 404', await rejectedWith(() => updateGoal({ user: other, goalId: mineId, patch: { priority: 1 } }), 404));
  check('other user cannot remove it → 404', await rejectedWith(() => removeGoal({ user: other, goalId: mineId }), 404));

  // getVitalFew: total, below-floor hint, band echo ───────────────────────────
  println('getVitalFew: total, below-floor hint, band');
  __reset();
  await addGoal({ user, body: { goal_text: 'only one' } });
  const one = await getVitalFew({ user });
  check('below the floor of 3 flags belowFloor:true', one.total === 1 && one.belowFloor === true);
  check('echoes the band (min 3, max 5)', one.min === 3 && one.max === 5);
  __reset();
  for (let i = 0; i < 6; i++) await addGoal({ user, body: { goal_text: 'g' + i, priority: i } });
  const many = await getVitalFew({ user });
  check('6 active goals → total 6, belowFloor false', many.total === 6 && many.belowFloor === false);
  check('vital few capped at 5', many.vitalFew.length === 5);
  check('vital few are the top 5 by priority (g5..g1)',
    eq(many.vitalFew.map((g) => g.goal_text), ['g5', 'g4', 'g3', 'g2', 'g1']));

  // ownership guards + db error propagation ───────────────────────────────────
  println('ownership guards throw; db errors propagate');
  check('listGoals without user throws', await threw(() => listGoals({})));
  check('addGoal without user throws', await threw(() => addGoal({ body: { goal_text: 'x' } })));
  check('updateGoal without user throws', await threw(() => updateGoal({ goalId: 'x', patch: {} })));
  check('removeGoal without user throws', await threw(() => removeGoal({ goalId: 'x' })));
  check('getVitalFew without user throws', await threw(() => getVitalFew({})));
  const errDb = { from: () => {
    const api = {
      select: () => api, eq: () => api, insert: () => api, update: () => api, delete: () => api,
      single: () => Promise.resolve({ error: { message: 'boom' } }),
      maybeSingle: () => Promise.resolve({ error: { message: 'boom' } }),
      then: (res, rej) => Promise.resolve({ error: { message: 'boom' } }).then(res, rej),
    };
    return api;
  } };
  check('a db error surfaces as a throw (not a silent empty)', await threw(() => listGoals({ user }, { db: errDb })));

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();

// Did fn() throw at all?
async function threw(fn) { try { await fn(); return false; } catch { return true; } }
// Did fn() throw a typed httpError carrying this status?
async function rejectedWith(fn, status) {
  try { await fn(); return false; } catch (e) { return e && e.status === status; }
}
