// Bundle 31 — card-rail failure honesty (supabase never throws; Lesson 11).
//
// The invariants under proof:
//   • a card-rail READ failure falls through to the ordinary pipeline
//     (handled:false) — a broken rail must never block a real message,
//   • a failed NOT THEM / NEVER suppression WRITE never gets a confident ack
//     (Lesson 1): honest error copy, card left awaiting so a retry can land,
//   • a failed people-counter write after met-confirm is announced, and the
//     card row (the source of truth) still records the confirmation.

(async () => {
  const { check, done } = makeChecker();
  const NOW = new Date('2026-07-29T18:00:00.000Z');
  const user = { id: 'u1' };
  const sentCard = {
    id: 'c1', user_id: 'u1', person_id: 'p1', kind: 'coffee',
    status: 'sent', sent_at: '2026-07-29T15:00:00.000Z',
    invite_text: 'Hey, coffee Tuesday?',
  };
  const fuCard = { ...sentCard, id: 'c2', status: 'followup_sent', followup_sent_at: '2026-07-29T15:00:00.000Z' };
  const HONEST = 'Something went wrong on my end. Try that again in a moment.';

  println('\n── 1. awaiting-card read fails → fall through, announced ──');
  __resetFail();
  __setOutcome('opportunity_cards', { data: null, error: { code: '42P01', message: 'relation missing' } });
  let r = await handleCardReply({ user, body: 'YES', now: NOW });
  check('handled:false (the pipeline gets the message)', r.handled === false);
  check('cards.read.failed announced with fail_open', __eventsNamed('cards.read.failed').length === 1 && __eventsNamed('cards.read.failed')[0].fields.outcome === 'fail_open');

  println('\n── 2. NEVER suppression write fails → honest error, no false ack ──');
  __resetFail();
  __setOutcome('opportunity_cards', { data: [sentCard], error: null });
  __setOutcome('suppressed_pairings:insert', { data: null, error: { code: '23503', message: 'insert refused' } });
  r = await handleCardReply({ user, body: 'NEVER', now: NOW });
  check('handled:true (the model must NOT answer "NEVER")', r.handled === true);
  check('reply is the honest failure copy, not a confident ack', r.reply === HONEST, JSON.stringify(r.reply));
  check('the card was NOT transitioned (stays awaiting for the retry)', __updates.filter((u) => u.table === 'opportunity_cards').length === 0, JSON.stringify(__updates));
  check('cards.write.failed announced (invariant_at_risk)', __eventsNamed('cards.write.failed').length === 1 && __eventsNamed('cards.write.failed')[0].fields.outcome === 'invariant_at_risk');

  println('\n── 3. NOT THEM write fails the same way ──');
  __resetFail();
  __setOutcome('opportunity_cards', { data: [sentCard], error: null });
  __setOutcome('suppressed_pairings:insert', { data: null, error: { message: 'nope' } });
  r = await handleCardReply({ user, body: 'not them', now: NOW });
  check('honest copy + no transition + announced', r.reply === HONEST && __updates.length === 0 && __eventsNamed('cards.write.failed').length === 1);

  println('\n── 4. met-confirm: people write fails → announced, card still confirms ──');
  __resetFail();
  __setOutcome('opportunity_cards', { data: [fuCard], error: null });
  __setOutcome('opportunity_cards:update', { data: [{ id: 'c2' }], error: null });
  __setOutcome('people', { data: { met_confirmed_count: 2 }, error: null });
  __setOutcome('people:update', { data: null, error: { code: '57014', message: 'timeout' } });
  r = await handleCardReply({ user, body: 'YES', sourceMessageId: 'm3', now: NOW });
  check('reply still confirms (card row is the source of truth)', r.handled === true && r.reply.indexOf('glad it happened') >= 0, JSON.stringify(r.reply));
  check('the failed counter write was announced', __eventsNamed('cards.write.failed').length === 1);
  check('no contact event on a failed counter write (no phantom Last touch)', __contactLogs.length === 0);

  println('\n── 5. met-confirm: people write succeeds → contact event flows ──');
  __resetFail();
  __setOutcome('opportunity_cards', { data: [fuCard], error: null });
  __setOutcome('opportunity_cards:update', { data: [{ id: 'c2' }], error: null });
  __setOutcome('people', { data: { met_confirmed_count: 0 }, error: null });
  __setOutcome('people:update', { data: [{}], error: null });
  r = await handleCardReply({ user, body: 'YES', sourceMessageId: 'm4', now: NOW });
  check('confirmed + contact event with source confirmed', r.handled === true && __contactLogs.length === 1 && __contactLogs[0].source === 'confirmed');
  check('the people update carried count+1 and the timestamp', (() => {
    const up = __updates.find((u) => u.table === 'people');
    return up && up.patch.met_confirmed_count === 1 && !!up.patch.last_met_confirmed_at;
  })(), JSON.stringify(__updates));

  println('\n── 6. queue insert failure surfaces as a typed 500 ──');
  __resetFail();
  __setOutcome('app_users', { data: { id: 'u1', opted_out: false }, error: null });
  __setOutcome('people', { data: { id: 'p1', user_id: 'u1', name: 'Luca' }, error: null });
  __setOutcome('suppressed_pairings', { data: [], error: null });
  __setOutcome('opportunity_cards:insert', { data: null, error: { code: '23502', message: 'not null violation' } });
  let threw = null;
  try { await queueCard({ userId: 'u1', personId: 'p1', kind: 'coffee', body: 'B', inviteText: 'I' }); } catch (e) { threw = e; }
  check('typed 500 with announced write failure', threw && threw.status === 500 && __eventsNamed('cards.write.failed').length === 1);

  println('\n── 7. suppression read failure fails OPEN and announces ──');
  __resetFail();
  __setOutcome('suppressed_pairings', { data: null, error: { message: 'boom' } });
  const active = await hasActiveSuppression({ userId: 'u1', personId: 'p1', kind: 'coffee' });
  check('read error → treated as not suppressed (send-time gets another look)', active === false);
  check('cards.read.failed announced', __eventsNamed('cards.read.failed').length === 1);

  println('');
  const f = done();
  println(f === 0 ? 'ALL CARD-FAILURE TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
