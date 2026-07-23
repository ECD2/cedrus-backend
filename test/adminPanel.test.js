// Proof suite for the N1 admin panel (docs/ADMIN_API_CONTRACT.md).
// Bundle order: reliability-core.js + prelude-admin.js + stripped
// src/utils/phone.js + stripped src/routes/admin.js + `const adminRouter =
// router;` glue + stripped src/services/adminOps.js + stripped
// src/routes/adminPanel.js + this file. The REAL panel routes, adminOps
// logic AND the real founder-admin reset handler run against the doubles.
//
// What is proven, per the N1 brief:
//   1. auth rejects missing/wrong token, and the compare is timing-safe
//      (crypto.timingSafeEqual spy), with fail-closed 404 when no token env
//      exists at all;
//   2. reset respects the TESTER_PHONES allowlist and preserves consent
//      rows (plus subscriptions/agent_runs/integrations) — via the real
//      admin.js handler, not a copy;
//   3. the users list (and every other response) never leaks a full phone
//      or any message content;
//   4. every mutating route writes an audit log entry.

(async () => {
  const { check, done } = makeChecker();

  // ── dispatch helper: synthetic request into the panel router ────────────
  function call(method, url, { key, body, session } = {}) {
    return new Promise((resolve) => {
      const headers = {};
      if (key !== undefined) headers['x-admin-key'] = key;
      const req = { method, url, headers, body: body || {} };
      // A live admin session, as adminSessionAdapter would attach in production.
      // requirePanelAuth accepts it directly (stronger than the shared token).
      if (session !== undefined) req.adminSession = session;
      const res = {
        statusCode: 200,
        headersSent: false,
        status(c) { this.statusCode = c; return this; },
        json(o) { this.headersSent = true; resolve({ status: this.statusCode, body: o }); },
        send(t) { this.headersSent = true; resolve({ status: this.statusCode, body: { text: String(t) } }); },
        end() { this.headersSent = true; resolve({ status: this.statusCode, body: null }); },
      };
      panel(req, res, () => resolve({ status: 404, body: { fellThrough: true } }));
    });
  }

  const KEY = 'test-admin-key';
  const HAS_ENV = typeof process !== 'undefined' && !!process.env;
  const iso = (t) => new Date(t).toISOString();
  const NOW = Date.now();

  const U1 = '11111111-1111-4111-8111-111111111111'; // allowlisted tester
  const U2 = '22222222-2222-4222-8222-222222222222'; // NOT allowlisted
  const U1_PHONE = '15550001111';
  const U2_PHONE = '15559998888';
  const NO_SUCH = '99999999-9999-4999-8999-999999999999';

  function seedAll() {
    __reset();
    __seed('app_users', [
      {
        id: U1, phone: U1_PHONE, name: 'Tess Tester', plan: 'trialing',
        billing_status: 'trialing', trial_started_at: iso(NOW - 3 * 86400000),
        trial_ends_at: iso(NOW + 11 * 86400000), trial_downgraded_at: null,
        created_at: iso(NOW - 3 * 86400000), onboarding_complete: true,
        opted_out: false, last_active_at: iso(NOW - 3600000),
        stripe_customer_id: 'cus_secret123', showing_up_count: 4,
        total_briefs_sent: 2, briefs_opened_streak: 1,
      },
      {
        id: U2, phone: U2_PHONE, name: 'Norm Nontester', plan: 'free',
        billing_status: 'inactive', trial_started_at: iso(NOW - 30 * 86400000),
        trial_ends_at: iso(NOW - 16 * 86400000), trial_downgraded_at: iso(NOW - 16 * 86400000),
        created_at: iso(NOW - 30 * 86400000), onboarding_complete: true,
        opted_out: false, last_active_at: null, stripe_customer_id: null,
      },
    ]);
    __seed('people', [
      { id: 'p1', user_id: U1, is_self: true, name: 'Tess' },
      { id: 'p2', user_id: U1, is_self: false, name: 'Mom' },
      { id: 'p3', user_id: U1, is_self: false, name: 'Ravi' },
      { id: 'p4', user_id: U2, is_self: true, name: 'Norm' },
    ]);
    __seed('facts', [
      { id: 'f1', user_id: U1, fact: 'likes tea' },
      { id: 'f2', user_id: U1, fact: 'ran a 10k' },
      { id: 'f3', user_id: U2, fact: 'plays chess' },
    ]);
    __seed('reminders', [
      { id: 'r1', user_id: U1, status: 'pending', trigger_at: iso(NOW + 86400000) },
      { id: 'r2', user_id: U1, status: 'pending', trigger_at: iso(NOW - 7200000) }, // overdue
      { id: 'r3', user_id: U1, status: 'sent', trigger_at: iso(NOW - 86400000) },
      { id: 'r4', user_id: U2, status: 'canceled', trigger_at: iso(NOW - 86400000) },
    ]);
    __seed('messages', [
      // U1 outbound inside the 7-day window:
      { id: 'm1', user_id: U1, direction: 'outbound', body: 'SECRET-OUTBOUND-BODY', message_type: 'reply', provider_status: 'delivered', sent_at: iso(NOW - 3600000) },
      { id: 'm2', user_id: U1, direction: 'outbound', body: 'SECRET-OUTBOUND-BODY', message_type: 'reminder', provider_status: 'failed', provider_payload: { last_status: 'failed', error_code: 30003 }, sent_at: iso(NOW - 7200000) },
      { id: 'm3', user_id: U1, direction: 'outbound', body: 'SECRET-OUTBOUND-BODY', message_type: 'reply', provider_status: 'delivered', sent_at: iso(NOW - 10800000) },
      { id: 'm4', user_id: U1, direction: 'outbound', body: 'SECRET-OUTBOUND-BODY', message_type: 'nudge', provider_status: null, sent_at: iso(NOW - 14400000) },
      // U1 outbound OUTSIDE the window (40 days old):
      { id: 'm5', user_id: U1, direction: 'outbound', body: 'SECRET-OUTBOUND-BODY', message_type: 'reply', provider_status: 'delivered', sent_at: iso(NOW - 40 * 86400000) },
      // U1 inbound:
      { id: 'm6', user_id: U1, direction: 'inbound', body: 'SECRET-INBOUND-BODY', received_at: iso(NOW - 1800000) },
    ]);
    __seed('consent_events', [
      { id: 'c1', user_id: U1, kind: 'opt_in', at: iso(NOW - 3 * 86400000) },
      { id: 'c2', user_id: U1, kind: 'quiet_hours_ack', at: iso(NOW - 2 * 86400000) },
      { id: 'c3', user_id: U2, kind: 'opt_in', at: iso(NOW - 30 * 86400000) },
    ]);
    __seed('subscriptions', [
      { id: 's1', user_id: U1, plan: 'pro', status: 'active', stripe_customer_id: 'cus_secret123', stripe_subscription_id: 'sub_secret456', current_period_end: iso(NOW + 20 * 86400000), canceled_at: null, created_at: iso(NOW - 86400000) },
    ]);
    __seed('agent_runs', [
      { id: 'a1', user_id: U1, run_type: 'understand' },
      { id: 'a2', user_id: U1, run_type: 'brief' },
    ]);
    __seed('integrations', [{ id: 'i1', user_id: U1, provider: 'google' }]);
    config.adminKey = KEY;
    config.testerPhones = [U1_PHONE, '15559990002'];
    if (HAS_ENV) delete process.env.ADMIN_PANEL_TOKEN;
    clearEvents();
  }

  // ═══ 1. Auth ═══════════════════════════════════════════════════════════
  println('auth: fail closed, reject wrong tokens, timing-safe compare');
  seedAll();

  config.adminKey = '';
  let r = await call('GET', '/users', { key: KEY });
  check('no token configured anywhere -> 404 (panel does not exist)', r.status === 404);
  check('404 is audit-logged with panel_disabled reason',
    eventsNamed('admin_panel.auth.rejected').some((e) => e.reason === 'panel_disabled_no_token'));
  config.adminKey = KEY;

  r = await call('GET', '/users', {});
  check('missing x-admin-key -> 403', r.status === 403);

  r = await call('GET', '/users', { key: 'totally-wrong' });
  check('wrong (different-length) key -> 403', r.status === 403);

  const tseBefore = __tseCalls;
  r = await call('GET', '/users', { key: 'test-admin-keX' }); // same length as KEY
  check('wrong (same-length) key -> 403', r.status === 403);
  check('same-length compare went through crypto.timingSafeEqual (timing-safe)', __tseCalls > tseBefore);

  check('rejections audit-logged (admin_panel.auth.rejected x3)',
    eventsNamed('admin_panel.auth.rejected').filter((e) => e.status_code === 403).length === 3);

  r = await call('GET', '/users', { key: KEY });
  check('correct key -> 200', r.status === 200);

  if (HAS_ENV) {
    process.env.ADMIN_PANEL_TOKEN = 'panel-secret-token';
    r = await call('GET', '/users', { key: KEY });
    check('ADMIN_PANEL_TOKEN set: old ADMIN_KEY no longer accepted', r.status === 403);
    r = await call('GET', '/users', { key: 'panel-secret-token' });
    check('ADMIN_PANEL_TOKEN set: panel token accepted', r.status === 200);
    delete process.env.ADMIN_PANEL_TOKEN;
  }

  println('');

  // ═══ 2. Users list ═══════════════════════════════════════════════════════
  println('GET /users: roster fields, counts, pagination, zero leakage');
  seedAll();

  r = await call('GET', '/users', { key: KEY });
  check('200 with users array', r.status === 200 && Array.isArray(r.body.users));
  check('page total counts every account', r.body.page.total === 2);
  const u1row = r.body.users.find((u) => u.id === U1);
  check('tester row present with user_ref', !!u1row && u1row.user_ref === 'u_' + U1);
  check('phone is last-4 only', u1row.phone_last4 === '1111' && !('phone' in u1row));
  check('counts: people 3 / facts 2 / reminders 3',
    u1row.counts.people === 3 && u1row.counts.facts === 2 && u1row.counts.reminders === 3,
    JSON.stringify(u1row.counts));
  const listStr = JSON.stringify(r.body);
  check('full phone appears nowhere in the list response', !listStr.includes(U1_PHONE) && !listStr.includes(U2_PHONE));
  check('message content appears nowhere in the list response',
    !listStr.includes('SECRET-OUTBOUND-BODY') && !listStr.includes('SECRET-INBOUND-BODY'));
  check('read was audit-logged', eventsNamed('admin_panel.users.listed').length === 1);

  const page1 = await call('GET', '/users?limit=1&offset=0', { key: KEY });
  const page2 = await call('GET', '/users?limit=1&offset=1', { key: KEY });
  check('pagination: one row per page', page1.body.users.length === 1 && page2.body.users.length === 1);
  check('pagination: pages do not overlap', page1.body.users[0].id !== page2.body.users[0].id);
  check('pagination: page meta echoes limit/offset',
    page1.body.page.limit === 1 && page2.body.page.offset === 1);

  println('');

  // ═══ 3. Health ═══════════════════════════════════════════════════════════
  println('GET /users/:id/health: delivery outcomes, reminder queue, last inbound');
  seedAll();

  r = await call('GET', '/users/' + U1 + '/health', { key: KEY });
  check('200 with found:true', r.status === 200 && r.body.found === true);
  const d = r.body.delivery.counts;
  check('delivery counts from callback data (2 delivered / 1 failed / 1 unknown in window)',
    d.delivered === 2 && d.failed === 1 && d.unknown === 1 && d.undelivered === 0 && d.sent === 0 && d.queued === 0,
    JSON.stringify(d));
  check('40-day-old outbound is outside the 7-day window', d.delivered === 2);
  check('last_failure carries when/status/error_code/type, no body',
    r.body.delivery.last_failure &&
    r.body.delivery.last_failure.status === 'failed' &&
    r.body.delivery.last_failure.error_code === '30003' &&
    r.body.delivery.last_failure.message_type === 'reminder' &&
    !('body' in (r.body.delivery.last_failure || {})));
  const rc = r.body.reminders.counts;
  check('reminder queue state (2 pending / 1 sent)', rc.pending === 2 && rc.sent === 1, JSON.stringify(rc));
  check('overdue pending reminder is surfaced', r.body.reminders.overdue_pending === 1);
  check('next_due_at is the earliest pending trigger', r.body.reminders.next_due_at === iso(NOW - 7200000));
  check('last_inbound_at reflects the newest inbound', r.body.last_inbound_at === iso(NOW - 1800000));
  check('last_outbound_at reflects the newest outbound', r.body.last_outbound_at === iso(NOW - 3600000));
  const healthStr = JSON.stringify(r.body);
  check('no message content in health response',
    !healthStr.includes('SECRET-OUTBOUND-BODY') && !healthStr.includes('SECRET-INBOUND-BODY'));
  check('no full phone in health response', !healthStr.includes(U1_PHONE));
  check('read was audit-logged', eventsNamed('admin_panel.user_health.viewed').length === 1);

  r = await call('GET', '/users/' + NO_SUCH + '/health', { key: KEY });
  check('unknown id -> 404 found:false', r.status === 404 && r.body.found === false);
  r = await call('GET', '/users/not-a-uuid/health', { key: KEY });
  check('malformed id -> 400 (never reaches the db)', r.status === 400);

  println('');

  // ═══ 4. Billing stub ═════════════════════════════════════════════════════
  println('GET /users/:id/billing: schema fields only, Stripe ids as booleans');
  seedAll();

  r = await call('GET', '/users/' + U1 + '/billing', { key: KEY });
  check('200 with plan/billing_status', r.status === 200 && r.body.plan === 'trialing' && r.body.billing_status === 'trialing');
  check('stripe customer presence is a boolean', r.body.has_stripe_customer === true);
  check('sub_status comes from the newest subscriptions row', r.body.sub_status === 'active');
  check('subscription summary present with boolean sub-id presence',
    r.body.subscription && r.body.subscription.has_stripe_subscription === true);
  check('stripe block is a marked placeholder, not integrated',
    r.body.stripe.placeholder === true && r.body.stripe.integrated === false);
  const billStr = JSON.stringify(r.body);
  check('raw stripe ids never leave the server', !billStr.includes('cus_secret123') && !billStr.includes('sub_secret456'));
  check('no full phone in billing response', !billStr.includes(U1_PHONE));

  r = await call('GET', '/users/' + U2 + '/billing', { key: KEY });
  check('user with no stripe/no sub: booleans false, sub_status null',
    r.body.has_stripe_customer === false && r.body.sub_status === null && r.body.subscription === null);
  check('reads were audit-logged', eventsNamed('admin_panel.user_billing.viewed').length === 2);

  println('');

  // ═══ 5. Testers (env-only allowlist) ═════════════════════════════════════
  println('testers: masked read-only view; POST is 501 with the env procedure');
  seedAll();

  r = await call('GET', '/testers', { key: KEY });
  check('view lists masked phones from env config',
    r.status === 200 && r.body.count === 2 &&
    JSON.stringify(r.body.phones_last4) === JSON.stringify(['1111', '0002']));
  check('source is explicit about env management', r.body.source === 'env:TESTER_PHONES');
  check('no full phone in testers view', !JSON.stringify(r.body).includes(U1_PHONE));

  r = await call('POST', '/testers', { key: KEY, body: { phone: '15551234567' } });
  check('mutation refused with 501', r.status === 501);
  check('response carries the operator how-to', typeof r.body.how_to === 'string' && r.body.how_to.includes('TESTER_PHONES'));
  check('refusal was audit-logged', eventsNamed('admin_panel.testers.mutation_refused').length === 1);

  println('');

  // ═══ 6. Reset pass-through (the real admin.js handler runs) ══════════════
  println('reset: allowlist gate, consent preservation, audit trail');
  seedAll();

  // 6a. Non-allowlisted target: refused by the INNER tool, nothing deleted.
  r = await call('POST', '/users/' + U2 + '/reset', { key: KEY });
  check('non-tester -> 403 from the real allowlist gate', r.status === 403 && r.body.reset === false);
  check('nothing was deleted on refusal',
    __rows('facts').filter((f) => f.user_id === U2).length === 1 &&
    __rows('consent_events').length === 3);
  check('inner denial audit entry written (admin.reset_user.denied)',
    eventsNamed('admin.reset_user.denied').length === 1);
  check('panel denial audit entry written',
    eventsNamed('admin_panel.reset.requested').some((e) => e.outcome === 'denied' && e.reason === 'not_on_tester_allowlist'));

  // 6b. Unknown / malformed ids.
  r = await call('POST', '/users/' + NO_SUCH + '/reset', { key: KEY });
  check('unknown id -> 404, audit-logged',
    r.status === 404 && eventsNamed('admin_panel.reset.requested').some((e) => e.reason === 'user_not_found'));
  r = await call('POST', '/users/oops/reset', { key: KEY });
  check('malformed id -> 400', r.status === 400);

  // 6c. Inner tool disabled (ADMIN_KEY unset) while the panel has its own
  // token: report 503, never bypass the inner gate.
  if (HAS_ENV) {
    process.env.ADMIN_PANEL_TOKEN = 'panel-secret-token';
    config.adminKey = '';
    r = await call('POST', '/users/' + U1 + '/reset', { key: 'panel-secret-token' });
    check('ADMIN_KEY unset -> 503, reset backend reported disabled',
      r.status === 503 && r.body.reset === false);
    check('no data touched on 503', __rows('facts').filter((f) => f.user_id === U1).length === 2);
    config.adminKey = KEY;
    delete process.env.ADMIN_PANEL_TOKEN;
  }

  // 6d. Allowlisted target: the real reset runs end-to-end.
  const consentBefore = __rows('consent_events').length;
  r = await call('POST', '/users/' + U1 + '/reset', { key: KEY });
  check('allowlisted tester -> 200 reset:true', r.status === 200 && r.body.reset === true);
  check('product memory cleared (facts/messages/reminders empty for user)',
    __rows('facts').filter((x) => x.user_id === U1).length === 0 &&
    __rows('messages').filter((x) => x.user_id === U1).length === 0 &&
    __rows('reminders').filter((x) => x.user_id === U1).length === 0);
  check('CONSENT ROWS PRESERVED — count unchanged', __rows('consent_events').length === consentBefore);
  check('subscriptions / agent_runs / integrations preserved',
    __rows('subscriptions').length === 1 && __rows('agent_runs').length === 2 && __rows('integrations').length === 1);
  const selfRows = __rows('people').filter((p) => p.user_id === U1);
  check('people: only the blanked self row remains',
    selfRows.length === 1 && selfRows[0].is_self === true && selfRows[0].name === 'Me');
  const u1After = __rows('app_users').find((u) => u.id === U1);
  check('account rewound: onboarding restarts, fresh trial, identity kept',
    u1After.onboarding_complete === false && u1After.plan === 'trialing' &&
    u1After.name === null && u1After.phone === U1_PHONE);
  check('response names what was preserved',
    JSON.stringify(r.body.preserved) === JSON.stringify(['consent_events', 'subscriptions', 'agent_runs', 'integrations']));
  check('inner audit entry written (admin.reset_user)', eventsNamed('admin.reset_user').length === 1);
  check('panel audit entry written (accepted)',
    eventsNamed('admin_panel.reset.requested').some((e) => e.outcome === 'accepted' && e.user_ref === 'u_' + U1));

  // 6e. INFRA-26: an ADMIN SESSION authorizes resetting a NON-allowlisted user.
  //     First confirm the allow-list still gates the raw x-admin-key path (weak
  //     auth stays testers-only), then that a session bypasses it end-to-end.
  seedAll();
  r = await call('POST', '/users/' + U2 + '/reset', { key: KEY }); // no session
  check('raw x-admin-key + non-allowlisted -> still 403 (gate intact for weak auth)',
    r.status === 403 && r.body.reset === false);
  check('U2 untouched by the refusal', __rows('facts').filter((x) => x.user_id === U2).length === 1);

  seedAll(); // reseed + clearEvents, so the counts below are scoped to the session reset
  const consentBeforeSession = __rows('consent_events').length;
  r = await call('POST', '/users/' + U2 + '/reset', { session: { email: 'admin@cedrus', jti: 'sess-1' } });
  check('admin session -> resets NON-allowlisted user (200 reset:true)',
    r.status === 200 && r.body.reset === true, JSON.stringify(r.body));
  check('U2 product memory cleared under session auth',
    __rows('facts').filter((x) => x.user_id === U2).length === 0 &&
    __rows('reminders').filter((x) => x.user_id === U2).length === 0);
  check('U2 self row blanked + account rewound', (() => {
    const self = __rows('people').filter((p) => p.user_id === U2 && p.is_self === true);
    const acct = __rows('app_users').find((u) => u.id === U2);
    return self.length === 1 && self[0].name === 'Me' &&
      acct.onboarding_complete === false && acct.name === null && acct.plan === 'trialing';
  })());
  check('CONSENT preserved under the session reset', __rows('consent_events').length === consentBeforeSession);
  check('NO allowlist-denial event fired for the session reset',
    eventsNamed('admin.reset_user.denied').length === 0);
  check('inner audit records authorized_via: admin_session',
    eventsNamed('admin.reset_user').some((e) => e.outcome === 'accepted' && e.meta && e.meta.authorized_via === 'admin_session'));
  check('panel audit records session authorization + user_ref',
    eventsNamed('admin_panel.reset.requested').some((e) =>
      e.outcome === 'accepted' && e.authorized_via === 'admin_session' && e.user_ref === 'u_' + U2));

  println('');

  // ═══ 7. Founder-admin paths fall through the panel router ════════════════
  println('mount safety: /admin/user and /admin/reset-user are not intercepted');
  r = await call('POST', '/user', { key: KEY, body: { phone: U1_PHONE } });
  check('POST /user falls through to the next router', r.body && r.body.fellThrough === true);
  r = await call('POST', '/reset-user', { key: KEY, body: { phone: U1_PHONE } });
  check('POST /reset-user falls through to the next router', r.body && r.body.fellThrough === true);

  println('');
  const f = done();
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
