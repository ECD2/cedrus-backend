// Bundle 30 — the card rail's full state machine, over the real fake DB.
//
// queued → sending → sent → {accepted, skipped, later, not_them, never}
// accepted → followup_sending → followup_sent → {met_confirmed, met_no}
// plus: the 3/user/rolling-7d hard cap, dry-run suppression (BRIEF_DRY_RUN
// exactly like weeklyBrief.js:77 — NOTHING touches Twilio), send-time
// suppression re-checks, opted-out cancel, §6 hold, daytime window, and the
// met-confirmed write — the only tree-advancing event.

(async () => {
  const { check, done } = makeChecker();

  // 18:00Z on a Wednesday = 14:00 America/New_York — inside the 10–19 window.
  const IN_WINDOW = new Date('2026-07-29T18:00:00.000Z');
  // 02:00Z = 22:00 EDT the previous evening — outside.
  const NIGHT = new Date('2026-07-29T02:00:00.000Z');

  const U1 = 'a4525dde-0000-4000-8000-000000000001';
  const P1 = 'b4525dde-0000-4000-8000-000000000001';
  const P2 = 'b4525dde-0000-4000-8000-000000000002';

  function seedBase({ optedOut = false } = {}) {
    __resetCards();
    __seed('app_users', [{ id: U1, phone: '15550001111', timezone: 'America/New_York', opted_out: optedOut }]);
    __seed('people', [
      { id: P1, user_id: U1, name: 'Luca Rossi', met_confirmed_count: 0, last_met_confirmed_at: null },
      { id: P2, user_id: 'someone-else', name: 'Maya', met_confirmed_count: 0 },
    ]);
    __seed('opportunity_cards', []);
    __seed('suppressed_pairings', []);
  }
  const cardRow = (over = {}) => Object.assign({
    id: 'card_' + Math.floor(Math.random() * 1e9), user_id: U1, person_id: P1,
    kind: 'coffee', occasion: 'Tuesday afternoon window', body: 'Card body about Luca.',
    invite_text: 'Hey Luca, free for a coffee Tuesday afternoon?', status: 'queued',
    created_by: 'admin', send_after: null, queued_at: '2026-07-29T00:00:00.000Z',
    sent_at: null, sent_message_id: null, replied_at: null, reply_token: null,
    followup_due_at: null, followup_sent_at: null, followup_message_id: null,
    met_confirmed_at: null,
  }, over);

  println('\n── 1. QUEUE — validation is the single-sided data rule in code ──');
  seedBase();
  let q = await queueCard({ userId: U1, personId: P1, kind: ' Coffee ', body: 'B', inviteText: 'I' });
  check('queues with normalized kind', q.card.status === 'queued' && q.card.kind === 'coffee', JSON.stringify(q.card.kind));
  check('advisory send count comes back', q.sends_last_7d === 0 && q.weekly_cap === 3);

  let threw = null;
  try { await queueCard({ userId: U1, personId: P2, kind: 'coffee', body: 'B', inviteText: 'I' }); } catch (e) { threw = e; }
  check("someone else's person → 422 not_their_person", threw && threw.status === 422 && threw.code === 'not_their_person');

  seedBase({ optedOut: true });
  threw = null;
  try { await queueCard({ userId: U1, personId: P1, kind: 'coffee', body: 'B', inviteText: 'I' }); } catch (e) { threw = e; }
  check('opted-out user → 422 opted_out', threw && threw.status === 422 && threw.code === 'opted_out');

  seedBase();
  threw = null;
  try { await queueCard({ userId: 'c4525dde-0000-4000-8000-00000000dead', personId: P1, kind: 'coffee', body: 'B', inviteText: 'I' }); } catch (e) { threw = e; }
  check('unknown user → 404', threw && threw.status === 404);

  println('\n── 2. QUEUE vs SUPPRESSION — NOT THEM is kind-scoped, NEVER is total ──');
  seedBase();
  __seed('suppressed_pairings', [{ id: 's1', user_id: U1, person_id: P1, kind: 'coffee', reason: 'not_them', revoked_at: null }]);
  threw = null;
  try { await queueCard({ userId: U1, personId: P1, kind: 'coffee', body: 'B', inviteText: 'I' }); } catch (e) { threw = e; }
  check('NOT THEM (coffee) blocks a coffee card → 409', threw && threw.status === 409 && threw.code === 'suppressed');
  q = await queueCard({ userId: U1, personId: P1, kind: 'walk', body: 'B', inviteText: 'I' });
  check('  ...but a walk card still queues (kind-scoped)', q.card.status === 'queued');

  seedBase();
  __seed('suppressed_pairings', [{ id: 's2', user_id: U1, person_id: P1, kind: null, reason: 'never', revoked_at: null }]);
  threw = null;
  try { await queueCard({ userId: U1, personId: P1, kind: 'walk', body: 'B', inviteText: 'I' }); } catch (e) { threw = e; }
  check('NEVER (kind NULL) blocks every kind → 409', threw && threw.status === 409);

  seedBase();
  __seed('suppressed_pairings', [{ id: 's3', user_id: U1, person_id: P1, kind: null, reason: 'never', revoked_at: '2026-07-01T00:00:00Z' }]);
  q = await queueCard({ userId: U1, personId: P1, kind: 'coffee', body: 'B', inviteText: 'I' });
  check('a REVOKED suppression no longer blocks (user reversed it)', q.card.status === 'queued');

  println('\n── 3. SENDER — dry-run means NOTHING touches Twilio ──');
  seedBase();
  __seed('opportunity_cards', [cardRow({ id: 'c_dry' })]);
  config.briefDryRun = true;
  await runCardSender(IN_WINDOW);
  let c = __rows('opportunity_cards').find((r) => r.id === 'c_dry');
  check('card marked sent under dry-run', c.status === 'sent' && !!c.sent_at, JSON.stringify(c.status));
  check('ZERO Twilio calls under dry-run', __sentSms.length === 0, JSON.stringify(__sentSms));
  check('outbound recorded with provider_status dry_run', __outboundLog.length === 1 && __outboundLog[0].providerStatus === 'dry_run' && __outboundLog[0].messageType === 'card');
  check('linked to the messages row (sent_message_id)', c.sent_message_id === 'msg_1');
  check('card.dry_run event emitted', __eventsNamed('card.dry_run').length === 1);

  println('\n── 4. SENDER — live mode sends and records ──');
  seedBase();
  __seed('opportunity_cards', [cardRow({ id: 'c_live' })]);
  config.briefDryRun = false;
  await runCardSender(IN_WINDOW);
  c = __rows('opportunity_cards').find((r) => r.id === 'c_live');
  check('live: one Twilio call', __sentSms.length === 1 && __sentSms[0].body === 'Card body about Luca.');
  check('live: card sent + linked', c.status === 'sent' && c.sent_message_id === 'msg_1');
  check('card.sent event emitted', __eventsNamed('card.sent').length === 1);

  println('\n── 5. SENDER — a Twilio throw reverts to queued (retryable) ──');
  seedBase();
  __seed('opportunity_cards', [cardRow({ id: 'c_fail' })]);
  config.briefDryRun = false;
  __sendFail = new Error('twilio 500');
  await runCardSender(IN_WINDOW);
  c = __rows('opportunity_cards').find((r) => r.id === 'c_fail');
  check('provably-unsent card back to queued', c.status === 'queued', JSON.stringify(c.status));
  check('card.send.failed announced', __eventsNamed('card.send.failed').length === 1);

  println('\n── 6. SENDER — the 3/rolling-7d hard cap, announced, never silent ──');
  seedBase();
  const d = (daysAgo) => new Date(IN_WINDOW.getTime() - daysAgo * 24 * 3600 * 1000).toISOString();
  __seed('opportunity_cards', [
    cardRow({ id: 'old1', status: 'skipped', sent_at: d(1) }),
    cardRow({ id: 'old2', status: 'accepted', sent_at: d(3) }),
    cardRow({ id: 'old3', status: 'sent', sent_at: d(6) }),
    cardRow({ id: 'c_capped' }),
  ]);
  await runCardSender(IN_WINDOW);
  c = __rows('opportunity_cards').find((r) => r.id === 'c_capped');
  check('3 sends in the window → 4th held as queued', c.status === 'queued');
  check('card.cap.held announced', __eventsNamed('card.cap.held').length === 1, JSON.stringify(__eventsNamed('card.cap.held')));
  check('nothing was sent or logged outbound', __sentSms.length === 0 && __outboundLog.length === 0);

  seedBase();
  __seed('opportunity_cards', [
    cardRow({ id: 'old1', status: 'skipped', sent_at: d(8) }),
    cardRow({ id: 'old2', status: 'met_confirmed', sent_at: d(9) }),
    cardRow({ id: 'old3', status: 'sent', sent_at: d(10) }),
    cardRow({ id: 'c_free' }),
  ]);
  await runCardSender(IN_WINDOW);
  c = __rows('opportunity_cards').find((r) => r.id === 'c_free');
  check('the window ROLLS: 3 sends 8+ days ago do not count', c.status === 'sent');

  // Cap enforced within a single tick too.
  seedBase();
  __seed('opportunity_cards', [
    cardRow({ id: 'old1', status: 'sent', sent_at: d(1) }),
    cardRow({ id: 'old2', status: 'sent', sent_at: d(2) }),
    cardRow({ id: 'c_third', queued_at: '2026-07-29T00:00:00Z' }),
    cardRow({ id: 'c_fourth', queued_at: '2026-07-29T01:00:00Z' }),
  ]);
  await runCardSender(IN_WINDOW);
  const sentNow = __rows('opportunity_cards').filter((r) => ['c_third', 'c_fourth'].includes(r.id) && r.status === 'sent');
  check('2 prior + 2 queued → exactly 1 sends this tick (cap inside the tick)', sentNow.length === 1 && __eventsNamed('card.cap.held').length === 1, JSON.stringify(sentNow.map((r) => r.id)));

  println('\n── 7. SENDER — suppression re-check at send time (the promise) ──');
  seedBase();
  __seed('opportunity_cards', [cardRow({ id: 'c_supp' })]);
  __seed('suppressed_pairings', [{ id: 's9', user_id: U1, person_id: P1, kind: null, reason: 'never', revoked_at: null }]);
  await runCardSender(IN_WINDOW);
  c = __rows('opportunity_cards').find((r) => r.id === 'c_supp');
  check('NEVER landed after queueing → card suppressed, never sent', c.status === 'suppressed' && __outboundLog.length === 0);
  check('card.suppressed announced', __eventsNamed('card.suppressed').length === 1);

  println('\n── 8. SENDER — opted-out, §6 cooldown, daytime window, send_after ──');
  seedBase({ optedOut: true });
  __seed('opportunity_cards', [cardRow({ id: 'c_opt' })]);
  await runCardSender(IN_WINDOW);
  check('opted-out user → cards canceled (mirror reminders)', __rows('opportunity_cards')[0].status === 'canceled' && __eventsNamed('card.canceled').length === 1);

  seedBase();
  __seed('opportunity_cards', [cardRow({ id: 'c_s6' })]);
  __inSuppression = true;
  await runCardSender(IN_WINDOW);
  check('§6 crisis cooldown → held this tick, still queued', __rows('opportunity_cards')[0].status === 'queued' && __eventsNamed('card.held').some((e) => e.fields.reason === 'safety_suppression_window'));

  seedBase();
  __seed('opportunity_cards', [cardRow({ id: 'c_night' })]);
  await runCardSender(NIGHT);
  check('22:00 local → held (no 3am cards in a daytime product)', __rows('opportunity_cards')[0].status === 'queued' && __eventsNamed('card.held').some((e) => e.fields.reason === 'outside_daytime_window'));

  seedBase();
  __seed('opportunity_cards', [cardRow({ id: 'c_later', send_after: '2026-08-15T00:00:00Z' })]);
  await runCardSender(IN_WINDOW);
  check('send_after in the future → not picked up', __rows('opportunity_cards')[0].status === 'queued' && __eventsNamed('card.tick.empty').length === 1);

  println('\n── 9. REPLIES — YES / SKIP / LATER on a sent card ──');
  const sentCard = (over = {}) => cardRow(Object.assign({ id: 'c_r', status: 'sent', sent_at: IN_WINDOW.toISOString() }, over));
  const user = { id: U1 };
  const T0 = new Date(IN_WINDOW.getTime() + 3600 * 1000);

  seedBase();
  __seed('opportunity_cards', [sentCard()]);
  let r = await handleCardReply({ user, body: 'yes', sourceMessageId: 'm1', now: T0 });
  c = __rows('opportunity_cards')[0];
  check('YES → accepted', r.handled === true && c.status === 'accepted');
  check('  reply carries the forwardable invite', r.reply.indexOf(c.invite_text) >= 0, JSON.stringify(r.reply));
  check('  follow-up scheduled exactly 3 days out', c.followup_due_at === new Date(T0.getTime() + 72 * 3600 * 1000).toISOString());
  check('  reply_token recorded', c.reply_token === 'YES' && !!c.replied_at);

  seedBase();
  __seed('opportunity_cards', [sentCard()]);
  r = await handleCardReply({ user, body: 'Skip.', now: T0 });
  check('SKIP (with punctuation) → skipped, no penalty ack', r.handled && __rows('opportunity_cards')[0].status === 'skipped' && r.reply.indexOf('No problem') === 0);

  seedBase();
  __seed('opportunity_cards', [sentCard()]);
  r = await handleCardReply({ user, body: 'LATER', now: T0 });
  check('LATER → later (may resurface once, spec V3)', r.handled && __rows('opportunity_cards')[0].status === 'later');

  println('\n── 10. REPLIES — NOT THEM / NEVER write the promise ──');
  seedBase();
  __seed('opportunity_cards', [sentCard()]);
  r = await handleCardReply({ user, body: 'not  them', now: T0 });
  c = __rows('opportunity_cards')[0];
  let sup = __rows('suppressed_pairings');
  check('NOT THEM (inner whitespace folded) → not_them', r.handled && c.status === 'not_them');
  check('  suppression row: this person, THIS kind', sup.length === 1 && sup[0].kind === 'coffee' && sup[0].reason === 'not_them' && sup[0].person_id === P1);

  seedBase();
  __seed('opportunity_cards', [sentCard()]);
  r = await handleCardReply({ user, body: 'NEVER', now: T0 });
  sup = __rows('suppressed_pairings');
  check('NEVER → never + kind NULL (every kind, durable)', __rows('opportunity_cards')[0].status === 'never' && sup.length === 1 && sup[0].kind === null && sup[0].reason === 'never');

  println('\n── 11. FOLLOW-UP JOB — asks, once, in daylight, dry-run gated ──');
  seedBase();
  __seed('opportunity_cards', [cardRow({ id: 'c_f', status: 'accepted', sent_at: d(4), followup_due_at: d(1) })]);
  config.briefDryRun = true;
  await runCardFollowup(IN_WINDOW);
  c = __rows('opportunity_cards')[0];
  check('due follow-up → followup_sent under dry-run, zero Twilio calls', c.status === 'followup_sent' && __sentSms.length === 0);
  check('  linked + announced', c.followup_message_id === 'msg_1' && __eventsNamed('card.followup.dry_run').length === 1);
  check('  copy asks the question with the first name + YES/NO', __outboundLog[0].body.indexOf('Luca') >= 0 && __outboundLog[0].body.indexOf('YES') >= 0 && __outboundLog[0].body.indexOf('NO') >= 0, JSON.stringify(__outboundLog[0].body));

  seedBase();
  __seed('opportunity_cards', [cardRow({ id: 'c_nd', status: 'accepted', sent_at: d(1), followup_due_at: new Date(IN_WINDOW.getTime() + 24 * 3600 * 1000).toISOString() })]);
  await runCardFollowup(IN_WINDOW);
  check('not due yet → untouched', __rows('opportunity_cards')[0].status === 'accepted' && __eventsNamed('card.followup.tick.empty').length === 1);

  seedBase();
  __seed('opportunity_cards', [cardRow({ id: 'c_ft', status: 'accepted', sent_at: d(4), followup_due_at: d(1) })]);
  config.briefDryRun = false;
  __sendFail = new Error('twilio down');
  await runCardFollowup(IN_WINDOW);
  check('Twilio throw → reverted to accepted (retry next tick)', __rows('opportunity_cards')[0].status === 'accepted' && __eventsNamed('card.followup.send.failed').length === 1);

  println('\n── 12. FOLLOW-UP ANSWERS — the ONLY tree-advancing event ──');
  const fuCard = (over = {}) => cardRow(Object.assign({ id: 'c_fu', status: 'followup_sent', sent_at: d(4), followup_sent_at: d(0.1) }, over));
  seedBase();
  __seed('opportunity_cards', [fuCard()]);
  r = await handleCardReply({ user, body: 'YES', sourceMessageId: 'm9', now: IN_WINDOW });
  c = __rows('opportunity_cards')[0];
  const luca = __rows('people').find((p) => p.id === P1);
  check('follow-up YES → met_confirmed on the card', r.handled && c.status === 'met_confirmed' && !!c.met_confirmed_at);
  check('  people.met_confirmed_count 0 → 1', luca.met_confirmed_count === 1, JSON.stringify(luca.met_confirmed_count));
  check('  people.last_met_confirmed_at stamped', !!luca.last_met_confirmed_at);
  check('  contact event logged with source confirmed (Last touch agrees)', __contactLogs.length === 1 && __contactLogs[0].source === 'confirmed' && __contactLogs[0].personId === P1, JSON.stringify(__contactLogs));
  check('  card.met_confirmed announced', __eventsNamed('card.met_confirmed').length === 1);

  seedBase();
  __seed('opportunity_cards', [fuCard()]);
  r = await handleCardReply({ user, body: 'no', now: IN_WINDOW });
  check('follow-up NO → met_no, nothing advances', r.handled && __rows('opportunity_cards')[0].status === 'met_no' && __rows('people').find((p) => p.id === P1).met_confirmed_count === 0);

  seedBase();
  __seed('opportunity_cards', [fuCard()]);
  r = await handleCardReply({ user, body: 'not yet', now: IN_WINDOW });
  check('follow-up NOT YET → met_no (no tree movement without a yes)', r.handled && __rows('opportunity_cards')[0].status === 'met_no');

  println('\n── 13. MATCHING DISCIPLINE — exact tokens, windows, recency ──');
  seedBase();
  __seed('opportunity_cards', [sentCard()]);
  r = await handleCardReply({ user, body: 'yes please', now: T0 });
  check('"yes please" is NOT a token → falls through to the pipeline', r.handled === false && __rows('opportunity_cards')[0].status === 'sent');

  seedBase();
  r = await handleCardReply({ user, body: 'YES', now: T0 });
  check('no awaiting card → falls through', r.handled === false);

  seedBase();
  __seed('opportunity_cards', [sentCard({ sent_at: d(20) })]);
  r = await handleCardReply({ user, body: 'YES', now: IN_WINDOW });
  check('a 20-day-old sent card has faded → "yes" does not resurrect it', r.handled === false && __rows('opportunity_cards')[0].status === 'sent');

  seedBase();
  __seed('opportunity_cards', [
    cardRow({ id: 'c_old_sent', status: 'sent', sent_at: d(2) }),
    cardRow({ id: 'c_new_fu', status: 'followup_sent', sent_at: d(5), followup_sent_at: d(0.04) }),
  ]);
  r = await handleCardReply({ user, body: 'YES', now: IN_WINDOW });
  check('most recently ASKED question wins: the fresh follow-up, not the older card',
    __rows('opportunity_cards').find((x) => x.id === 'c_new_fu').status === 'met_confirmed' &&
    __rows('opportunity_cards').find((x) => x.id === 'c_old_sent').status === 'sent', JSON.stringify(__rows('opportunity_cards').map((x) => [x.id, x.status])));

  seedBase();
  __seed('opportunity_cards', [sentCard()]);
  r = await handleCardReply({ user, body: 'NO', now: T0 });
  check('"NO" is follow-up vocab, not card vocab → falls through on a sent card', r.handled === false && __rows('opportunity_cards')[0].status === 'sent');

  println('');
  const f = done();
  println(f === 0 ? 'ALL CARD-STATE TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
