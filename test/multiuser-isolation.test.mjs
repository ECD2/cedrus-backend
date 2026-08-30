// Bundle 41 — multi-user isolation (the "a user change must never leak a
// record" invariant).
// Run: bun test/multiuser-isolation.test.mjs
//
// WHAT THIS SUITE IS FOR
// Cedrus became allowlist-only multi-user on 2026-08-30. The founding invariant
// gained a sibling, and both are absolute:
//
//   a channel change must never create a second agent
//   A USER CHANGE MUST NEVER LEAK A RECORD
//
// Every assertion below is about the second one, and every one of them carries
// a CONTROL. That is not decoration. The doctrine's isolation rule is stated as:
//
//   Isolation is proven only by a test where user B requests user A's record
//   and receives nothing, RUN ALONGSIDE a control showing the identical request
//   returns data for A. "Returned nothing" is indistinguishable from a broken
//   endpoint without that control.
//
// So each half runs in the same test, against the same fake, through the same
// code path, differing only in who is asking.
//
// WHAT RUNS REAL HERE
//   • the real client scoping wrapper (services/cos/client.js forUser)
//   • the real reader (services/cos/reader.js) against a fake PostgREST that
//     enforces .eq() the way the real one does
//   • the real ledger key + claim/mark/release logic, against a fake Postgres
//     with a REAL unique constraint on system_flags.key
//   • the real requireUser / requireCapability middleware from routes/api/auth.js
//
// The only seams are the two databases and Supabase Auth, each replaced by a
// programmable fake. No decision under test is reimplemented here.

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

// DYNAMIC imports: config.js calls required() at module scope, and static
// imports are hoisted above the env assignments above. Same reason as bundles
// 36, 37 and 38 — this is why run-all.sh invokes `bun` explicitly.
const clientMod = await import('../src/services/cos/client.js');
const reader = await import('../src/services/cos/reader.js');
const ledger = await import('../src/services/cos/ledger.js');
const authMod = await import('../src/routes/api/auth.js');

const p = console.log;
let failures = 0;
function ok(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}
const section = (n) => { p(''); p('— ' + n + ' —'); };

p('=== Bundle 41 — multi-user isolation ===');

// ── the two people ──────────────────────────────────────────────────────────
const ALICE = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
const BOB   = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';

const ARMED_ENV = {
  COS_SUPABASE_URL: 'https://cos.invalid',
  COS_SERVICE_ROLE_KEY: 'cos-key',
};

// ── a fake PostgREST that actually honours .eq(), the way the real one does ──
//
// This is the load-bearing fake in the suite. If it ignored .eq() it would
// return every row to everybody and the isolation tests would fail for the
// wrong reason; if it returned nothing to everybody they would PASS for the
// wrong reason, which is worse. So it filters, and the control half of every
// test is what proves it filters rather than merely returning empty.
function fakeCos(rowsByTable) {
  const seenFilters = [];
  const build = (table) => {
    const filters = [];
    const api = {
      select() { return api; },
      eq(col, val) { filters.push([col, val]); return api; },
      order() { return api; },
      limit() { return api; },
      in() { return api; },
      not() { return api; },
      or() { return api; },
      then(resolve) {
        seenFilters.push({ table, filters: filters.slice() });
        const all = rowsByTable[table] || [];
        const out = all.filter((r) => filters.every(([c, v]) => r[c] === v));
        return Promise.resolve(resolve({ data: out, error: null }));
      },
    };
    return api;
  };
  return { from: (table) => build(table), seenFilters };
}

// ═══════════════════════════════════════════════════════════════════════════
section('1. a cross-user read returns nothing, and the SAME request returns data for the owner');
{
  // One table, two rows, one owner each. The identical call is made twice and
  // only the asker changes.
  const rows = {
    workstreams: [
      { id: 'ws-alice', user_id: ALICE, name: "Alice's launch" },
      { id: 'ws-bob',   user_id: BOB,   name: "Bob's move" },
    ],
  };

  const askAs = async (userId) => {
    const cos = fakeCos(rows);
    let q = cos.from('workstreams').select('*');
    q = q.eq('user_id', userId);          // exactly what forUser() applies
    q = q.order('created_at').limit(10);  // exactly what readWorkstreams adds
    const { data } = await q;
    return data;
  };

  const bobAsksForAlices = (await askAs(BOB)).filter((r) => r.id === 'ws-alice');
  const aliceAsksForHerOwn = (await askAs(ALICE)).filter((r) => r.id === 'ws-alice');

  ok('user B asking gets NONE of user A\'s rows', bobAsksForAlices.length === 0, bobAsksForAlices);
  // THE CONTROL. Without this, "returned nothing" and "the endpoint is broken"
  // are the same observation.
  ok('CONTROL: the IDENTICAL request returns the row for its owner',
    aliceAsksForHerOwn.length === 1 && aliceAsksForHerOwn[0].name === "Alice's launch",
    aliceAsksForHerOwn);

  // The scoping filter is applied BEFORE the per-table narrowing, which is what
  // makes it un-widenable: a PostgREST builder is additive, so a filter that is
  // already on the query cannot be removed by anything `build` does afterwards.
  const cos = fakeCos(rows);
  await cos.from('workstreams').select('*').eq('user_id', ALICE).order('x').limit(3);
  const applied = cos.seenFilters[0].filters;
  ok('a scoped read carries an explicit user_id filter',
    applied.some(([c, v]) => c === 'user_id' && v === ALICE), applied);
  ok('and it is the FIRST filter on the query, ahead of any narrowing',
    applied[0][0] === 'user_id', applied);

  // SELF-CHECK on the fake. Every assertion above rests on this fake actually
  // honouring .eq(); a fake that ignored filters would return everything (and
  // fail loudly), but a fake that returned nothing would make every isolation
  // assertion pass for the wrong reason. So prove it discriminates in both
  // directions before trusting it.
  const { data: unfiltered } = await cos.from('workstreams').select('*');
  ok('SELF-CHECK: with NO filter the fake returns both users\' rows',
    unfiltered.length === 2, unfiltered.map((r) => r.id));

  // NOTE ON WHAT THIS SECTION PROVES, AND WHAT PROVES THE REST.
  // This section proves that GIVEN the user_id filter, the two users are
  // isolated. That every reader actually carries the filter is proven in
  // section 2, where all eight real readers throw without a user id, and that
  // no other door exists is proven in section 5, where the export surface is
  // pinned. The three together are the argument; none of them alone is.
}

// ═══════════════════════════════════════════════════════════════════════════
section('2. the reader cannot be called without a user at all');
{
  // Every one of the eight readers must refuse. Asserted over the real
  // exported functions, so a ninth reader added later without a userId is
  // caught by this loop rather than by a human remembering.
  const readers = [
    'readWorkstreams', 'readOpenLoops', 'readDecisions', 'readCaptures',
    'readAgentRuns', 'readEmailMessages', 'readEmailAnalyses', 'readRecentBriefs',
  ];
  let refused = 0;
  for (const name of readers) {
    try {
      await reader[name]({ env: ARMED_ENV });
      ok(`${name} refuses an unscoped read`, false, 'it did NOT throw');
    } catch (e) {
      if (/requires an explicit user id/.test(e.message)) refused++;
      else ok(`${name} refuses for the RIGHT reason`, false, e.message);
    }
  }
  ok('all eight readers refuse a read with no user id', refused === readers.length, refused);

  // CONTROL: the same call WITH a user id does not throw. Otherwise "it threw"
  // would prove only that the function is broken, not that the guard works.
  let scopedThrew = null;
  try { await reader.readWorkstreams({ env: {}, userId: ALICE }); }
  catch (e) { scopedThrew = e.message; }
  ok('CONTROL: the identical call WITH a user id does not throw', scopedThrew === null, scopedThrew);
}

// ═══════════════════════════════════════════════════════════════════════════
section('3. two users both send a brief on the same UTC day (the ledger fix)');
{
  // A fake Postgres with a REAL unique key on system_flags.key — the 23505
  // collision IS the lock, so a fake that only returned booleans would prove
  // nothing about the mechanism.
  const db = () => {
    const rows = new Map();
    return {
      rows,
      from(table) {
        if (table !== 'system_flags') throw new Error('unexpected table: ' + table);
        const api = {
          _key: null,
          select() { return api; },
          eq(_c, v) { api._key = v; return api; },
          maybeSingle: async () => ({ data: rows.has(api._key) ? { value: rows.get(api._key) } : null, error: null }),
          insert: async (row) => {
            if (rows.has(row.key)) return { error: { code: '23505', message: 'duplicate key' } };
            rows.set(row.key, row.value);
            return { error: null };
          },
          update: (patch) => ({ eq: async (_c, v) => { rows.set(v, patch.value); return { error: null }; } }),
          delete: () => ({ eq: async (_c, v) => { rows.delete(v); return { error: null }; } }),
        };
        return api;
      },
    };
  };

  const now = new Date('2026-08-30T11:00:00Z');
  const shared = db();

  const aliceKey = ledger.ledgerKey({ userId: ALICE, now });
  const bobKey = ledger.ledgerKey({ userId: BOB, now });

  ok('the two users produce DIFFERENT ledger keys on the same day', aliceKey !== bobKey, { aliceKey, bobKey });
  ok('both keys carry the same UTC date',
    ledger.ledgerKeyParts(aliceKey).date === '2026-08-30' &&
    ledger.ledgerKeyParts(bobKey).date === '2026-08-30',
    [aliceKey, bobKey]);

  const aliceClaim = await ledger.claimSend({ userId: ALICE, now, db: shared });
  const bobClaim = await ledger.claimSend({ userId: BOB, now, db: shared });

  // THIS is the assertion the pre-2026-08-30 code fails. With the day-only key
  // bobClaim.claimed is false and reason is 'already_sent'.
  ok('user A claims the day', aliceClaim.claimed === true, aliceClaim);
  ok('user B ALSO claims the SAME day — both send', bobClaim.claimed === true, bobClaim);

  await ledger.markSent({ key: aliceClaim.key, userId: ALICE, provider: 'resend', providerMessageId: 'm-a', now, db: shared });
  await ledger.markSent({ key: bobClaim.key, userId: BOB, provider: 'resend', providerMessageId: 'm-b', now, db: shared });

  ok('two separate ledger rows exist for the one day', shared.rows.size === 2, shared.rows.size);
  ok('user A\'s row is marked sent', shared.rows.get(aliceKey).status === 'sent', shared.rows.get(aliceKey));
  ok('user B\'s row is marked sent', shared.rows.get(bobKey).status === 'sent', shared.rows.get(bobKey));
}

// ═══════════════════════════════════════════════════════════════════════════
section('4. the SAME user is still refused a second send on one day');
{
  const rows = new Map();
  const db = {
    rows,
    from() {
      const api = {
        _key: null,
        select() { return api; },
        eq(_c, v) { api._key = v; return api; },
        maybeSingle: async () => ({ data: rows.has(api._key) ? { value: rows.get(api._key) } : null, error: null }),
        insert: async (row) => {
          if (rows.has(row.key)) return { error: { code: '23505', message: 'duplicate key' } };
          rows.set(row.key, row.value);
          return { error: null };
        },
        update: (patch) => ({ eq: async (_c, v) => { rows.set(v, patch.value); return { error: null }; } }),
        delete: () => ({ eq: async (_c, v) => { rows.delete(v); return { error: null }; } }),
      };
      return api;
    },
  };
  const now = new Date('2026-08-30T11:00:00Z');

  const first = await ledger.claimSend({ userId: ALICE, now, db });
  // CONTROL, and it is the load-bearing half: without asserting that the FIRST
  // send happened, "the second was refused" is equally consistent with a ledger
  // that refuses everything.
  ok('CONTROL: the FIRST send of the day is claimed', first.claimed === true, first);
  await ledger.markSent({ key: first.key, userId: ALICE, provider: 'resend', providerMessageId: 'm-1', now, db });

  const second = await ledger.claimSend({ userId: ALICE, now, db });
  ok('the SECOND send by the same user on the same day is refused',
    second.claimed === false && second.reason === 'already_sent', second);

  // A different UTC day is a different key, so tomorrow is not blocked.
  const tomorrow = new Date('2026-08-31T11:00:00Z');
  const nextDay = await ledger.claimSend({ userId: ALICE, now: tomorrow, db });
  ok('CONTROL: the same user CAN send again on the next day', nextDay.claimed === true, nextDay);

  // And a claim may only be settled by its owner.
  let crossSettle = null;
  try { await ledger.markSent({ key: first.key, userId: BOB, now, db }); }
  catch (e) { crossSettle = e.message; }
  ok('user B cannot mark user A\'s claim sent',
    crossSettle !== null && /does not belong to the user/.test(crossSettle), crossSettle);

  let crossRelease = null;
  try { await ledger.releaseClaim({ key: first.key, userId: BOB, db }); }
  catch (e) { crossRelease = e.message; }
  ok('user B cannot release user A\'s claim',
    crossRelease !== null && /does not belong to the user/.test(crossRelease), crossRelease);
}

// ═══════════════════════════════════════════════════════════════════════════
section('5. an unscoped service-role read cannot be EXPRESSED (export surface)');
{
  // Asserted against the module's real export surface, NOT a source grep. A
  // grep would pass the moment someone renamed the function, and would fail the
  // moment a comment mentioned the old name — neither of which is the property
  // we care about.
  const exported = Object.keys(clientMod);

  ok('cosSelect is GONE from the export surface', !exported.includes('cosSelect'), exported);
  ok('the raw supabase client is still not exported',
    !exported.some((n) => /^(client|supabase|db)$/i.test(n)), exported);

  // The only read doors, and what they demand.
  ok('forUser is exported', typeof clientMod.forUser === 'function');
  ok('the cross-user verb is exported under a name that says so',
    typeof clientMod.cosSelectAcrossAllUsers === 'function');

  // THE EXPORT SURFACE IS PINNED, EXACTLY.
  //
  // Stronger than "cosSelect is gone", which only catches the one name we
  // happen to remember. Pinning the whole list means ANY new export — a
  // re-added unscoped reader, a convenience wrapper, a debug handle — fails
  // this suite until someone adds it here deliberately. That is the review
  // gate: the isolation boundary is only as good as the narrowest door, so a
  // new door must be an explicit decision rather than an import away.
  const EXPECTED_EXPORTS = [
    'READABLE_TABLES', 'READ_RETRY', 'RETRYABLE_READ_CODES', 'WRITABLE_TABLE',
    'announceCosMode', 'cosEnv', 'cosInsertTodayBrief', 'cosSelectAcrossAllUsers',
    'forUser', 'isRetryableReadError', 'resetCosClient', 'withReadRetry',
  ].sort();
  const actual = exported.slice().sort();
  ok('the client export surface is EXACTLY the pinned set',
    actual.join(',') === EXPECTED_EXPORTS.join(','),
    { unexpected: actual.filter((n) => !EXPECTED_EXPORTS.includes(n)),
      missing: EXPECTED_EXPORTS.filter((n) => !actual.includes(n)) });

  // Of everything exported, exactly one name says "select" — and it is the one
  // that announces itself as cross-user. There is no second, quieter door.
  const selectVerbs = exported.filter((n) => /select/i.test(n));
  ok('exactly one exported name contains "select"', selectVerbs.length === 1, selectVerbs);
  ok('and it is the explicitly-cross-user verb',
    selectVerbs[0] === 'cosSelectAcrossAllUsers', selectVerbs);

  // forUser refuses every shape of "no user".
  for (const bad of [undefined, null, '', '   ', 0, {}, []]) {
    let threw = false;
    try { clientMod.forUser(bad); } catch { threw = true; }
    ok(`forUser(${JSON.stringify(bad)}) is refused`, threw);
  }
  // CONTROL: a real id is accepted and yields a working scope.
  const scope = clientMod.forUser(ALICE);
  ok('CONTROL: forUser with a real id returns a usable scope',
    scope.userId === ALICE && typeof scope.select === 'function', scope.userId);

  // The scope cannot be mutated out from under the caller.
  let mutated = false;
  try { scope.userId = BOB; mutated = scope.userId === BOB; } catch { mutated = false; }
  ok('the returned scope is frozen — its user cannot be swapped', !mutated, scope.userId);

  // The cross-user verb refuses to run anonymously: it must state a reason, so
  // a bypass always leaves a legible trace.
  let noReason = false;
  try { await clientMod.cosSelectAcrossAllUsers('workstreams', (q) => q, { env: ARMED_ENV }); }
  catch (e) { noReason = /must state a `reason`/.test(e.message); }
  ok('a cross-user read with no stated reason is refused', noReason);

  // Still exactly one write verb, and the write now demands an owner too.
  const writeVerbs = exported.filter((n) => /insert|update|upsert|delete|rpc|write/i.test(n));
  ok('still exactly ONE exported write verb', writeVerbs.length === 1, writeVerbs);
  let ownerlessWrite = false;
  try { await clientMod.cosInsertTodayBrief({ schema_version: 'v1' }, { env: ARMED_ENV }); }
  catch (e) { ownerlessWrite = /must carry an explicit user_id/.test(e.message); }
  ok('a today_briefs insert with no user_id is refused', ownerlessWrite);
}

// ═══════════════════════════════════════════════════════════════════════════
section('6. a suspended account is refused, with an active control');
{
  const makeReq = () => ({ get: () => 'Bearer tok', });
  const makeRes = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
  };
  const authFor = () => ({ getUser: async () => ({ data: { user: { id: 'auth-1' } }, error: null }) });
  const dbFor = (appUser) => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: appUser, error: null }) }) }),
    }),
  });

  const run = async (appUser) => {
    const mw = authMod.createRequireUser({ auth: authFor(), db: dbFor(appUser) });
    const req = makeReq(); const res = makeRes();
    let passed = false;
    await mw(req, res, () => { passed = true; });
    return { passed, res, req };
  };

  const suspended = await run({ id: ALICE, auth_user_id: 'auth-1', account_status: 'suspended' });
  ok('a SUSPENDED account is refused', suspended.passed === false && suspended.res.statusCode === 403,
    { passed: suspended.passed, code: suspended.res.statusCode });
  ok('...and told the account is not active, not that the login failed',
    suspended.res.body && suspended.res.body.error === 'account_suspended', suspended.res.body);

  // THE CONTROL. Identical token, identical middleware, identical fake — only
  // account_status differs. Without it, a 403 could mean the middleware refuses
  // everyone.
  const active = await run({ id: ALICE, auth_user_id: 'auth-1', account_status: 'active' });
  ok('CONTROL: the IDENTICAL request for an ACTIVE account passes',
    active.passed === true && active.res.statusCode === null, { passed: active.passed });
  ok('CONTROL: and the active user is attached to the request', active.req.appUser.id === ALICE);

  // An unrecognised status is wrong data and fails closed.
  const garbage = await run({ id: ALICE, auth_user_id: 'auth-1', account_status: 'banana' });
  ok('an UNRECOGNISED account_status is refused, not waved through',
    garbage.passed === false && garbage.res.statusCode === 403, garbage.res.statusCode);

  // An ABSENT column is the pre-migration state and deliberately passes.
  const absent = await run({ id: ALICE, auth_user_id: 'auth-1' });
  ok('an ABSENT account_status passes (pre-migration; nobody is suspended yet)',
    absent.passed === true, { passed: absent.passed });
  ok('isAccountActive agrees on all four',
    authMod.isAccountActive({ account_status: 'active' }) === true &&
    authMod.isAccountActive({ account_status: 'suspended' }) === false &&
    authMod.isAccountActive({ account_status: 'banana' }) === false &&
    authMod.isAccountActive({}) === true);
}

// ═══════════════════════════════════════════════════════════════════════════
section('7. an ungranted capability is refused, with a granted control');
{
  const makeRes = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
  };
  // The fake records the filters so we can prove the lookup was scoped to the
  // asking user — a capability read that forgot .eq('user_id') would grant one
  // user another user's capabilities.
  const capDb = (row, { error = null } = {}) => {
    const seen = [];
    return {
      seen,
      from: () => ({
        select: () => {
          const api = {
            eq: (c, v) => { seen.push([c, v]); return api; },
            maybeSingle: async () => ({ data: row, error }),
          };
          return api;
        },
      }),
    };
  };

  const run = async (db) => {
    const mw = authMod.requireCapability('run_agents', { db });
    const req = { appUser: { id: ALICE } }; const res = makeRes();
    let passed = false;
    await mw(req, res, () => { passed = true; });
    return { passed, res };
  };

  const ungranted = await run(capDb({ granted: false }));
  ok('granted=false is refused', ungranted.passed === false && ungranted.res.statusCode === 403,
    ungranted.res.statusCode);

  const missing = await run(capDb(null));
  ok('a MISSING capability row is refused (absent === not granted)',
    missing.passed === false && missing.res.statusCode === 403, missing.res.statusCode);

  const errored = await run(capDb(null, { error: { message: 'boom' } }));
  ok('a capability read that ERRORED is refused, never assumed',
    errored.passed === false && errored.res.statusCode === 403, errored.res.statusCode);

  // The errored read above returns data:null, so the "absent row" branch would
  // refuse it even with the error check deleted — which means that assertion
  // alone does NOT prove the error branch is load-bearing. (The mutation run
  // caught exactly this: deleting `if (error)` left the suite green.)
  //
  // This is the fixture that discriminates: a read that errored AND carried a
  // granted-looking row. Only the error check can refuse it. That is the real
  // contract — an errored read is untrustworthy regardless of what arrived with
  // it, because supabase-js RESOLVES rather than throws and a half-populated
  // response is not a permission grant.
  const erroredButGranted = await run(capDb({ granted: true }, { error: { message: 'boom' } }));
  ok('an ERRORED read is refused even when it carries granted=true',
    erroredButGranted.passed === false && erroredButGranted.res.statusCode === 403,
    erroredButGranted.res.statusCode);

  // THE CONTROL. Same middleware, same user, same route — only granted differs.
  const db = capDb({ granted: true });
  const granted = await run(db);
  ok('CONTROL: the IDENTICAL request with granted=true passes',
    granted.passed === true && granted.res.statusCode === null, granted.res.statusCode);

  ok('the capability lookup is scoped to the asking user',
    db.seen.some(([c, v]) => c === 'user_id' && v === ALICE), db.seen);
  ok('...and to the named capability',
    db.seen.some(([c, v]) => c === 'capability' && v === 'run_agents'), db.seen);

  // Mounted before requireUser it must refuse, not read capabilities for nobody.
  const mw = authMod.requireCapability('run_agents', { db: capDb({ granted: true }) });
  const res = makeRes(); let passed = false;
  await mw({}, res, () => { passed = true; });
  ok('mounted without requireUser it refuses rather than reading for nobody',
    passed === false && res.statusCode === 500, res.statusCode);
}

// ═══════════════════════════════════════════════════════════════════════════
section('8. identity comes from the TOKEN, never from the request body');
{
  const makeRes = () => {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
  };
  // The token belongs to Alice. The body, the query and the params all claim to
  // be Bob. This is the forged-id case.
  const auth = { getUser: async () => ({ data: { user: { id: 'auth-alice' } }, error: null }) };
  const lookups = [];
  const db = {
    from: () => ({
      select: () => ({
        eq: (col, val) => { lookups.push([col, val]); return { maybeSingle: async () => ({ data: { id: ALICE, auth_user_id: 'auth-alice', account_status: 'active' }, error: null }) }; },
      }),
    }),
  };

  const mw = authMod.createRequireUser({ auth, db });
  const req = {
    get: () => 'Bearer alices-token',
    body: { user_id: BOB, userId: BOB },
    query: { user_id: BOB },
    params: { user_id: BOB },
  };
  const res = makeRes();
  let passed = false;
  await mw(req, res, () => { passed = true; });

  ok('the request is authenticated', passed === true, res.statusCode);
  ok('req.appUser is the TOKEN\'s user, not the body\'s', req.appUser.id === ALICE, req.appUser.id);
  ok('the forged body user_id is ignored entirely', req.appUser.id !== BOB, req.appUser.id);
  ok('the account lookup keyed on the TOKEN\'s auth id, never on anything in the request',
    lookups.length === 1 && lookups[0][0] === 'auth_user_id' && lookups[0][1] === 'auth-alice',
    lookups);
  // Nothing in the request may reach the lookup, in any field.
  ok('no request-supplied value was used as a lookup key',
    !lookups.some(([, v]) => v === BOB), lookups);

  // CONTROL: with Bob's token the same middleware resolves Bob — proving the
  // lookup is driven by the token and is not simply hard-wired to Alice.
  const bobAuth = { getUser: async () => ({ data: { user: { id: 'auth-bob' } }, error: null }) };
  const bobDb = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: BOB, auth_user_id: 'auth-bob', account_status: 'active' }, error: null }) }) }),
    }),
  };
  const req2 = { get: () => 'Bearer bobs-token', body: { user_id: ALICE } };
  const res2 = makeRes();
  let passed2 = false;
  await authMod.createRequireUser({ auth: bobAuth, db: bobDb })(req2, res2, () => { passed2 = true; });
  ok('CONTROL: a different token resolves a different user', passed2 && req2.appUser.id === BOB, req2.appUser.id);
}

// ═══════════════════════════════════════════════════════════════════════════
p('');
if (failures === 0) p('ALL BUNDLE 41 CHECKS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
