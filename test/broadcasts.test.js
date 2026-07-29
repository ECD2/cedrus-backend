// Bundle 33 — admin broadcasts: draft → explicit approve → send/publish.
//
// The laws under proof:
//   • POST creates a DRAFT and nothing else moves it (never auto-send: the
//     only sender is the explicit approve call, and there is no job),
//   • SMS gates run before anything sends, dry-run or not: quiet hours
//     21:00–09:00 ET, the 1/ET-day hard cap, opted-out exclusion, the
//     500-recipient refusal (never truncate), the budget kill switch,
//   • dry-run = zero Twilio calls, recorded per recipient,
//   • web channel publishes to the feed with no SMS machinery at all.

(async () => {
  const { check, done } = makeChecker();

  const MIDDAY = new Date('2026-07-29T15:00:00.000Z');      // 11:00 EDT
  const QUIET_EVE = new Date('2026-07-30T01:30:00.000Z');   // 21:30 EDT (29th)
  const QUIET_EARLY = new Date('2026-07-29T12:59:00.000Z'); // 08:59 EDT
  const NINE_SHARP = new Date('2026-07-29T13:00:00.000Z');  // 09:00 EDT exactly
  const PREV_ET_DAY = '2026-07-29T01:00:00.000Z';           // 21:00 EDT on the 28th

  const U = (n, over = {}) => Object.assign({
    id: 'u' + n, phone: '1555000' + (1000 + n), opted_out: false, member_status: 'founding',
  }, over);

  function seedUsers(rows) { __seed('app_users', rows); }
  function draftRow(over = {}) {
    return Object.assign({
      id: 'b_' + Math.floor(Math.random() * 1e9), segment: 'all', channel: 'sms',
      body: 'Cedrus update for members.', status: 'draft', created_by: 'admin',
      created_at: '2026-07-29T00:00:00.000Z', approved_at: null, approved_by: null,
      sent_at: null, recipient_count: null, expires_at: null,
    }, over);
  }

  println('\n── 1. isQuietHoursET — the boundary is the law ──');
  check('21:30 ET is quiet', isQuietHoursET(QUIET_EVE) === true);
  check('08:59 ET is quiet', isQuietHoursET(QUIET_EARLY) === true);
  check('09:00 ET exactly is allowed', isQuietHoursET(NINE_SHARP) === false);
  check('11:00 ET is allowed', isQuietHoursET(MIDDAY) === false);

  println('\n── 2. DRAFT — created inert, validated ──');
  __resetBroadcasts();
  const d = await createDraft({ segment: 'all', channel: 'sms', body: 'Hello members.' });
  check('draft status, nothing sent, zero outbound', d.status === 'draft' && __sentSms.length === 0 && __outboundLog.length === 0);
  let threw = null;
  try { await createDraft({ segment: 'weird', channel: 'sms', body: 'x' }); } catch (e) { threw = e; }
  check('unknown segment → 400', threw && threw.status === 400 && threw.code === 'bad_segment');
  threw = null;
  try { await createDraft({ segment: 'all', channel: 'carrier_pigeon', body: 'x' }); } catch (e) { threw = e; }
  check('unknown channel → 400', threw && threw.status === 400 && threw.code === 'bad_channel');
  threw = null;
  try { await createDraft({ segment: 'all', channel: 'web', body: '' }); } catch (e) { threw = e; }
  check('empty body → 400', threw && threw.status === 400 && threw.code === 'bad_body');

  println('\n── 3. WEB — approve publishes; the feed reads it; no SMS machinery ──');
  __resetBroadcasts();
  __budgetGate = { paused: true, reason: 'tokens', degraded: false }; // web ignores the switch: no spend
  const webDraft = draftRow({ id: 'b_web', channel: 'web' });
  __seed('broadcasts', [webDraft, draftRow({ id: 'b_expired', channel: 'web', status: 'sent', sent_at: '2026-07-01T00:00:00Z', expires_at: '2026-07-08T00:00:00Z', body: 'old news' })]);
  let r = await approveBroadcast({ id: 'b_web', now: MIDDAY });
  const webRow = __rows('broadcasts').find((b) => b.id === 'b_web');
  check('web approve → sent + stamped', r.sent === true && webRow.status === 'sent' && webRow.sent_at === MIDDAY.toISOString());
  check('  expires_at defaulted to +7d', webRow.expires_at === new Date(MIDDAY.getTime() + 7 * 24 * 3600 * 1000).toISOString());
  check('  zero Twilio calls, zero outbound rows (web costs nothing)', __sentSms.length === 0 && __outboundLog.length === 0);
  check('  ...even while the budget switch is paused (no spend to guard)', true);
  const feed = await getActiveWebBroadcasts(MIDDAY);
  check('feed returns the live row only (expired one excluded)', feed.length === 1 && feed[0].id === 'b_web' && feed[0].body === webDraft.body, JSON.stringify(feed));
  check('feed shape is {id, body, sent_at}', Object.keys(feed[0]).sort().join(',') === 'body,id,sent_at');

  println('\n── 4. SMS dry-run — gates run, wire stays cold ──');
  __resetBroadcasts();
  seedUsers([U(1), U(2), U(3, { opted_out: true }), U(4, { phone: null })]);
  __seed('broadcasts', [draftRow({ id: 'b_dry' })]);
  r = await approveBroadcast({ id: 'b_dry', now: MIDDAY });
  let row = __rows('broadcasts').find((b) => b.id === 'b_dry');
  check('dry-run approve → sent', r.sent === true && r.dryRun === true && row.status === 'sent');
  check('opted-out and phoneless users excluded (2 of 4)', r.recipients === 2 && r.delivered === 2, JSON.stringify(r));
  check('ZERO Twilio calls under dry-run', __sentSms.length === 0);
  check('per-recipient outbound rows with provider_status dry_run', __outboundLog.length === 2 && __outboundLog.every((m) => m.providerStatus === 'dry_run' && m.messageType === 'broadcast'));
  check('recipient_count recorded', row.recipient_count === 2);
  check('broadcast.sent event announced with the count', __eventsNamed('broadcast.sent').length === 1 && __eventsNamed('broadcast.sent')[0].fields.count === 2);

  println('\n── 5. SMS live — sends, and one bad number does not kill the run ──');
  __resetBroadcasts();
  config.briefDryRun = false;
  seedUsers([U(1), U(2)]);
  __seed('broadcasts', [draftRow({ id: 'b_live' })]);
  __sendFailFor = U(2).phone;
  r = await approveBroadcast({ id: 'b_live', now: MIDDAY });
  check('live: one delivered, one failed, run completed', r.delivered === 1 && r.failed === 1 && __sentSms.length === 1, JSON.stringify(r));
  check('the failure was announced per recipient', __eventsNamed('broadcast.send.failed').length === 1);
  check('status sent with the DELIVERED count', __rows('broadcasts').find((b) => b.id === 'b_live').recipient_count === 1);

  println('\n── 6. QUIET HOURS — enforced in code, dry-run refuses too ──');
  __resetBroadcasts();
  seedUsers([U(1)]);
  __seed('broadcasts', [draftRow({ id: 'b_q' })]);
  threw = null;
  try { await approveBroadcast({ id: 'b_q', now: QUIET_EVE }); } catch (e) { threw = e; }
  check('21:30 ET → 422 quiet_hours, still a draft', threw && threw.code === 'quiet_hours' && __rows('broadcasts')[0].status === 'draft');
  threw = null;
  try { await approveBroadcast({ id: 'b_q', now: QUIET_EARLY }); } catch (e) { threw = e; }
  check('08:59 ET → 422 quiet_hours', threw && threw.code === 'quiet_hours');
  r = await approveBroadcast({ id: 'b_q', now: NINE_SHARP });
  check('09:00 ET exactly → allowed', r.sent === true);

  println('\n── 7. THE 1/ET-DAY HARD CAP ──');
  __resetBroadcasts();
  seedUsers([U(1)]);
  __seed('broadcasts', [
    draftRow({ id: 'b_prior', status: 'sent', sent_at: MIDDAY.toISOString() }),
    draftRow({ id: 'b_second' }),
  ]);
  threw = null;
  try { await approveBroadcast({ id: 'b_second', now: new Date(MIDDAY.getTime() + 3600 * 1000) }); } catch (e) { threw = e; }
  check('one already sent today (ET) → 422 daily_cap, still draft', threw && threw.code === 'daily_cap' && __rows('broadcasts').find((b) => b.id === 'b_second').status === 'draft');

  __resetBroadcasts();
  seedUsers([U(1)]);
  __seed('broadcasts', [
    draftRow({ id: 'b_lastnight', status: 'sent', sent_at: PREV_ET_DAY }), // 21:00 EDT the 28th
    draftRow({ id: 'b_today' }),
  ]);
  r = await approveBroadcast({ id: 'b_today', now: MIDDAY });
  check('the cap is an ET calendar day: last night 9pm ET does not block today', r.sent === true);

  println('\n── 8. THE 500-RECIPIENT HARD CAP — refuse, never truncate ──');
  __resetBroadcasts();
  const many = [];
  for (let i = 0; i < 501; i++) many.push(U(i));
  seedUsers(many);
  __seed('broadcasts', [draftRow({ id: 'b_big' })]);
  threw = null;
  try { await approveBroadcast({ id: 'b_big', now: MIDDAY }); } catch (e) { threw = e; }
  check('501 recipients → 422 too_many_recipients, zero sends, still draft',
    threw && threw.code === 'too_many_recipients' && __sentSms.length === 0 && __outboundLog.length === 0 && __rows('broadcasts')[0].status === 'draft', JSON.stringify(threw && threw.publicMessage));

  println('\n── 9. KILL SWITCH — SMS refuses while paused; segment scoping; empties ──');
  __resetBroadcasts();
  seedUsers([U(1)]);
  __seed('broadcasts', [draftRow({ id: 'b_paused' })]);
  __budgetGate = { paused: true, reason: 'sms', degraded: false };
  threw = null;
  try { await approveBroadcast({ id: 'b_paused', now: MIDDAY }); } catch (e) { threw = e; }
  check('budget paused → 409 budget_paused, still draft', threw && threw.code === 'budget_paused' && __rows('broadcasts')[0].status === 'draft');

  __resetBroadcasts();
  seedUsers([U(1, { member_status: 'founding' }), U(2, { member_status: null })]);
  __seed('broadcasts', [draftRow({ id: 'b_seg', segment: 'founding' })]);
  r = await approveBroadcast({ id: 'b_seg', now: MIDDAY });
  check('founding segment reaches only founding members', r.recipients === 1 && __outboundLog.length === 1 && __outboundLog[0].userId === 'u1', JSON.stringify(r));

  __resetBroadcasts();
  seedUsers([U(1, { opted_out: true })]);
  __seed('broadcasts', [draftRow({ id: 'b_none' })]);
  threw = null;
  try { await approveBroadcast({ id: 'b_none', now: MIDDAY }); } catch (e) { threw = e; }
  check('segment resolves to zero sendable users → 422 no_recipients', threw && threw.code === 'no_recipients');

  println('\n── 10. STATE MACHINE — only a draft approves; approve is the only mover ──');
  __resetBroadcasts();
  seedUsers([U(1)]);
  __seed('broadcasts', [draftRow({ id: 'b_done', status: 'sent', sent_at: PREV_ET_DAY })]);
  threw = null;
  try { await approveBroadcast({ id: 'b_done', now: MIDDAY }); } catch (e) { threw = e; }
  check('already sent → 409 not_draft', threw && threw.code === 'not_draft');
  threw = null;
  try { await approveBroadcast({ id: 'b_missing_00000000-0000-4000-8000-000000000000', now: MIDDAY }); } catch (e) { threw = e; }
  check('unknown id → 404', threw && threw.status === 404);

  println('');
  const f = done();
  println(f === 0 ? 'ALL BROADCAST TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
