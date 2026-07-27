// Bundle 25 — the consent audit trail announces its failures.
//
// consent_events is the auditable record of STOP / START / HELP: the evidence
// that an opt-out was honoured. The insert discarded its error entirely, so a
// failed write left no row AND no trace — a carrier/TCPA exposure that nothing
// could have surfaced.
//
// The important structural point, asserted below rather than assumed:
// ENFORCEMENT IS NOT IN THIS WRITE. users.setOptedOut() is what actually stops
// messages, and 03_compliance.js calls it FIRST. So a lost row never keeps
// messaging an opted-out user — it loses the proof that we stopped. This suite
// runs the REAL handleCompliance() to pin that ordering, because if it ever
// flipped, a failed audit write would become a failed opt-out.
//
// Reuses test/prelude-relationships.js: same thenable table-aware seam, same
// recorders. Control flow unchanged — log() still resolves without throwing, so
// a logging failure can never block the compliance reply.

(async () => {
  const { check, done } = makeChecker();

  println('\n── 1. consent write fails → resolves quietly, but LOGS ──');
  __reset();
  __setTable('consent_events', { error: { code: '42P01', message: 'relation "consent_events" does not exist' } });
  let threw = false;
  try { await log({ userId: 'u1', eventType: 'opt_out', rawText: 'STOP' }); }
  catch { threw = true; }
  check('does NOT throw (never blocks the compliance reply)', threw === false);
  check('emitted exactly one event', __events.length === 1, JSON.stringify(__events));
  check('event is consent.write.failed', __events[0].name === 'consent.write.failed', __eventText(0));
  check('carries error_code', __events[0].fields.error_code === '42P01', __eventText(0));
  check('names the event_type that was lost', __eventText(0).indexOf('opt_out') >= 0, __eventText(0));
  check('says the audit row is missing, not that the opt-out failed',
    __events[0].fields.outcome === 'audit_row_lost', __eventText(0));

  println('\n── 2. consent write succeeds → writes, and stays SILENT ──');
  __reset();
  await log({ userId: 'u1', eventType: 'opt_in', rawText: 'START' });
  check('the row actually reached consent_events (fixture is live)',
    __writes.length === 1 && __writes[0].table === 'consent_events', JSON.stringify(__writes));
  check('emitted NOTHING', __events.length === 0, JSON.stringify(__events));

  println('\n── 3. REAL handleCompliance: STOP still opts out when the audit write fails ──');
  // The load-bearing ordering. If enforcement ever moved after the audit write,
  // or came to depend on it, this is the assertion that would go red.
  __reset();
  __setTable('consent_events', { error: { code: '08006', message: 'connection failure' } });
  const res = await handleCompliance({ user: { id: 'u1' }, body: 'STOP' });
  check('compliance still handled the message', res.handled === true, JSON.stringify(res));
  check('STOP still returns a null reply (carrier sends its own)', res.reply === null, JSON.stringify(res));
  check('setOptedOut(true) WAS called — enforcement does not depend on the audit row',
    __optOutCalls.length === 1 && __optOutCalls[0].value === true, JSON.stringify(__optOutCalls));
  check('and the lost audit row was announced', __events.length === 1 &&
    __events[0].name === 'consent.write.failed', JSON.stringify(__events));

  println('\n── 4. REAL handleCompliance: the healthy STOP path is silent ──');
  __reset();
  const ok = await handleCompliance({ user: { id: 'u1' }, body: 'STOP' });
  check('handled', ok.handled === true);
  check('opt-out enforced', __optOutCalls.length === 1 && __optOutCalls[0].value === true);
  check('audit row written', __writes.some((w) => w.table === 'consent_events'), JSON.stringify(__writes));
  check('silent', __events.length === 0, JSON.stringify(__events));

  println('\n── 5. THE DISCRIMINATOR — the bug itself, encoded ──');
  __reset();
  const okReturn = await log({ userId: 'u1', eventType: 'help' });
  const okEvents = __events.length;

  __reset();
  __setTable('consent_events', { error: { code: '42501', message: 'permission denied' } });
  const failReturn = await log({ userId: 'u1', eventType: 'help' });
  const failEvents = __events.length;

  check('both still return the same thing (no contract change)',
    okReturn === failReturn && okReturn === undefined);
  check('but they are now DISTINGUISHABLE: success=0 events, failure=1 event',
    okEvents === 0 && failEvents === 1, `ok=${okEvents} fail=${failEvents}`);

  println('');
  const f = done();
  println(f === 0 ? 'ALL CONSENT-WRITE TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
