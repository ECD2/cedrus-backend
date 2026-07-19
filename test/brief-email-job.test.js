// Proof bundle for src/jobs/briefEmail.js (N2): consent gate, delivery ledger,
// send-before-mark ordering, idempotency, retry, token issuance, env gates,
// and the never-auto-subscribe guarantee. Concatenated by
// test/run-n2-brief-email.sh after brief-email-stubs.js + the stripped real
// src files (voiceGuard, template, composer, renderer, tokens, transport,
// briefEmail) — the production logic runs against the in-memory doubles.

(async () => {
  const { check, done } = makeChecker();

  process.env.BRIEF_EMAIL_ENABLED = 'true';
  process.env.BRIEF_EMAIL_LINK_SECRET = 'test-secret';
  process.env.BRIEF_EMAIL_OUTPUT_DIR = 'memfs-out';
  delete process.env.BRIEF_EMAIL_TRANSPORT; // default = mock
  delete process.env.BRIEF_EMAIL_LIVE;

  const NOW = new Date('2026-07-19T12:00:00Z');

  const SUBSCRIBED = {
    id: 'u1', name: 'Emil', timezone: 'America/New_York', brief_day: 'sunday', brief_time: '08:00',
    plan: 'trialing', billing_status: 'trialing', opted_out: false,
    brief_email: 'emil@example.com', brief_email_status: 'subscribed',
    brief_email_verified_at: '2026-07-18T00:00:00Z',
  };

  function seedUsers() {
    __seed('app_users', [
      SUBSCRIBED,
      { ...SUBSCRIBED, id: 'u2', brief_email: 'p@example.com', brief_email_status: 'pending', brief_email_verified_at: null },
      { ...SUBSCRIBED, id: 'u3', brief_email: 'g@example.com', brief_email_status: 'unsubscribed' },
      { ...SUBSCRIBED, id: 'u4', brief_email: null, brief_email_status: null },
      { ...SUBSCRIBED, id: 'u5', brief_email: 'h@example.com', brief_email_verified_at: null }, // poked row; DB CHECK would forbid, job must defend anyway
    ]);
    __seed('people', [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Marco' }]);
  }

  function richPlan() {
    __plan = {
      userName: 'Emil', planTier: 'trial', selfNote: null,
      items: [
        { type: 'birthday', personId: 'p1', personName: 'Ana', detail: 'birthday in 3 days', priority: 100 },
        { type: 'drift', personId: 'p2', personName: 'Marco', detail: "haven't talked in about 3 weeks", priority: 62 },
      ],
      goalFollowup: null, teaser: null, quiet: false,
      closingQuestion: 'Who do you want to make time for this week?',
    };
  }

  // ── consent gate ─────────────────────────────────────────────────────────
  println('consent gate: only subscribed + verified receives anything; no state is ever written');
  __reset(); seedUsers(); richPlan();
  {
    const pending = await sendBriefEmailTo({ id: 'u2' }, NOW);
    const unsub = await sendBriefEmailTo({ id: 'u3' }, NOW);
    const none = await sendBriefEmailTo({ id: 'u4' }, NOW);
    const unverified = await sendBriefEmailTo({ id: 'u5' }, NOW);
    check('pending refused', pending.skipped === 'not_subscribed');
    check('unsubscribed refused', unsub.skipped === 'not_subscribed');
    check('no-address refused', none.skipped === 'not_subscribed');
    check('subscribed-but-unverified refused (D16 backstop mirrored)', unverified.skipped === 'not_subscribed');
    check('no delivery rows for refused users', (__db.brief_deliveries || []).length === 0);
    check('no email files for refused users', Object.keys(fs.__files).length === 0);
    check('no canonical record was even generated', (__db.briefs || []).length === 0);
  }

  // ── happy path ───────────────────────────────────────────────────────────
  println('send: canonical record + delivery ledger + send-before-mark + tokens');
  {
    // Prior-cycle token that the new note must supersede.
    __seed('brief_action_tokens', [{
      id: 'told', user_id: 'u1', brief_id: 'lastweek', action_type: 'remind_tomorrow',
      token_hash: 'x'.repeat(64), expires_at: '2026-07-25T00:00:00Z', used_at: null, superseded_at: null,
    }]);
    const res = await sendBriefEmailTo({ id: 'u1' }, NOW);
    check('send succeeded', res.sent === true);
    check('one canonical briefs row', (__db.briefs || []).length === 1);
    const items = __db.brief_items || [];
    check('items recorded once', items.length === 2, String(items.length));
    const deliveries = __db.brief_deliveries || [];
    check('exactly one email delivery row', deliveries.length === 1 && deliveries[0].channel === 'email');
    const d = deliveries[0];
    check('delivery marked sent with provider + recipient snapshot',
      d.status === 'sent' && d.provider === 'mock-eml' && d.recipient === 'emil@example.com' && d.attempts === 1);
    const wIdx = __calls.indexOf('fs.write');
    const updates = __calls.map((c, i) => [c, i]).filter(([c]) => c === 'update:brief_deliveries').map(([, i]) => i);
    check('transport wrote before the row was marked sent', wIdx >= 0 && updates.some((i) => i > wIdx), __calls.join(','));
    const eml = Object.values(fs.__files)[0] || '';
    check('.eml written with brand identity + one-click unsubscribe',
      eml.includes('From: Cedrus <brief@cedrus.life>') && eml.includes('List-Unsubscribe-Post: List-Unsubscribe=One-Click'));
    const tokens = (__db.brief_action_tokens || []).filter((t) => t.brief_id !== 'lastweek');
    check('view_full_brief token issued', tokens.some((t) => t.action_type === 'view_full_brief'));
    check('snooze tokens issued for up to two cards', tokens.filter((t) => t.action_type === 'remind_tomorrow').length === 2);
    check('all stored token hashes are 64 hex-ish chars, never raw', tokens.every((t) => String(t.token_hash).length === 64));
    check('prior-cycle token superseded (D18)', (__db.brief_action_tokens || []).find((t) => t.id === 'told').superseded_at != null);
    check('the job never touched briefs.status (SMS semantics untouched)', __db.briefs[0].status === 'generated');
  }

  println('idempotency: a second run reuses the record and refuses a second send');
  {
    const before = { briefs: __db.briefs.length, items: __db.brief_items.length, files: Object.keys(fs.__files).length };
    const res = await sendBriefEmailTo({ id: 'u1' }, NOW);
    check('second run skips as already sent', res.skipped === 'already_sent');
    check('still one briefs row / same items / no second email',
      __db.briefs.length === before.briefs && __db.brief_items.length === before.items && Object.keys(fs.__files).length === before.files);
    check('still exactly one delivery row (UNIQUE brief_id+channel held)', __db.brief_deliveries.length === 1);
  }

  // ── failure + retry ──────────────────────────────────────────────────────
  println('retry: a failed transport leaves the row pending and the next tick succeeds');
  __reset(); seedUsers(); richPlan();
  {
    let failNext = true;
    const orig = fs.writeFileSync;
    fs.writeFileSync = function (p, c) {
      if (failNext) { failNext = false; throw new Error('disk full'); }
      return orig.call(fs, p, c);
    };
    let threw = false;
    try { await sendBriefEmailTo({ id: 'u1' }, NOW); } catch { threw = true; }
    const d1 = __db.brief_deliveries[0];
    check('transport failure propagates (hourly tick will retry)', threw);
    check('row still pending, attempt counted, sanitized reason', d1.status === 'pending' && d1.attempts === 1 && d1.failure_reason === 'transport_error');
    check('never marked sent on failure', d1.delivered_at == null);

    const res = await sendBriefEmailTo({ id: 'u1' }, NOW);
    fs.writeFileSync = orig;
    const d2 = __db.brief_deliveries[0];
    check('retry reused the SAME row and succeeded', res.sent === true && __db.brief_deliveries.length === 1);
    check('attempts incremented on the reused row', d2.attempts === 2 && d2.status === 'sent');
  }

  // ── the cron entry + env gates ───────────────────────────────────────────
  println('run: hourly entry sends to due subscribed users only, env gates fail closed');
  __reset(); seedUsers(); richPlan();
  {
    delete process.env.BRIEF_EMAIL_ENABLED;
    await runBriefEmails(NOW);
    check('disabled by default: nothing generated, nothing sent', (__db.briefs || []).length === 0 && Object.keys(fs.__files).length === 0);

    process.env.BRIEF_EMAIL_ENABLED = 'true';
    const secret = process.env.BRIEF_EMAIL_LINK_SECRET;
    delete process.env.BRIEF_EMAIL_LINK_SECRET;
    await runBriefEmails(NOW);
    check('no link secret: refuses to send at all (unsubscribe is compliance)',
      Object.keys(fs.__files).length === 0 && __calls.includes('log:brief_email.config_error'));
    process.env.BRIEF_EMAIL_LINK_SECRET = secret;

    await runBriefEmails(NOW);
    const sent = (__db.brief_deliveries || []).filter((x) => x.status === 'sent');
    check('with gates open, exactly the one subscribed+verified user got email', sent.length === 1 && sent[0].user_id === 'u1');
    check('pending/unsubscribed/none/unverified users have no delivery rows',
      (__db.brief_deliveries || []).every((x) => x.user_id === 'u1'));
  }

  // ── canonical reuse when the SMS job wrote the week first ────────────────
  println('canonical: an SMS-job-authored record is reused, never regenerated');
  __reset(); seedUsers(); richPlan();
  {
    __seed('briefs', [{ id: 'bSMS', user_id: 'u1', week_of: '2026-07-13', brief_type: 'weekly', status: 'sent', summary: 'sms text' }]);
    __seed('brief_items', [
      { id: 'iSMS1', brief_id: 'bSMS', user_id: 'u1', person_id: 'p1', item_type: 'birthday', body: 'birthday in 3 days', priority: 100, is_pro_locked: false, source_data: {} },
    ]);
    const res = await sendBriefEmailTo({ id: 'u1' }, NOW);
    check('email sent from the existing record', res.sent === true);
    check('still one briefs row (no second generation)', __db.briefs.length === 1 && __db.briefs[0].id === 'bSMS');
    check('items untouched', __db.brief_items.length === 1 && __db.brief_items[0].id === 'iSMS1');
    check('briefs.status stayed as the SMS job left it', __db.briefs[0].status === 'sent');
  }

  // ── suppression window mutes the register ────────────────────────────────
  println('suppression: an active crisis window sends the muted note');
  __reset(); seedUsers(); richPlan();
  {
    __suppressed = true;
    await sendBriefEmailTo({ id: 'u1' }, NOW);
    __suppressed = false;
    const eml = Object.values(fs.__files)[0] || '';
    check('muted subject is plain ASCII "Your week" (no 🌲, so no RFC2047)', eml.includes('Subject: Your week') && !eml.includes('=?UTF-8?B?'));
  }

  // ── the strongest guarantee last ─────────────────────────────────────────
  println('never auto-subscribe: the job never writes app_users, in any path above');
  {
    check('zero app_users writes across every scenario in this file (persistent tracker)',
      __userWrites.length === 0, __userWrites.join(','));
  }

  println('');
  const f = done();
  println(f === 0 ? 'ALL N2 JOB TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
