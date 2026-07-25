// Model-fed timestamp normalization — memory.toTimestamptz + the three writers that
// take a model-supplied timestamptz. The extractor sometimes emits natural language
// ("this morning") for a date; inserted raw that is a SQLSTATE 22007 that used to
// destroy the WHOLE write. Rule under test: parse in ONE place; a nullable garnish
// (saved_items.event_date / user_goals.due_at) drops to null and KEEPS the row;
// reminders.trigger_at is NOT NULL, so an unparseable time skips just that reminder.
// Bundle (run-tests.sh): stubs.js + memory.js + people.js + 07_persist.js + this.

(async () => {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) { println('  PASS  ' + name); }
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  const user = { id: 'u1', timezone: 'America/New_York' };
  const msg = { id: 'm1' };

  // ── toTimestamptz (pure): ISO passes, natural language / garbage → null ──
  println('toTimestamptz: ISO-8601 passes, natural language drops to null');
  check('offset ISO datetime -> same instant in UTC', toTimestamptz('2026-11-12T13:00:00-05:00') === '2026-11-12T18:00:00.000Z', String(toTimestamptz('2026-11-12T13:00:00-05:00')));
  check('Z datetime passes through', toTimestamptz('2026-08-01T20:00:00Z') === '2026-08-01T20:00:00.000Z');
  check('bare date -> anchored to noon UTC (calendar day preserved)', toTimestamptz('2026-08-01') === '2026-08-01T12:00:00.000Z', String(toTimestamptz('2026-08-01')));
  check('"this morning" -> null', toTimestamptz('this morning') === null);
  check('"tonight" -> null', toTimestamptz('tonight') === null);
  check('"tomorrow at 8" -> null', toTimestamptz('tomorrow at 8') === null);
  check('empty / null / undefined -> null', toTimestamptz('') === null && toTimestamptz(null) === null && toTimestamptz(undefined) === null);
  check('impossible date 2026-13-45 -> null', toTimestamptz('2026-13-45') === null, String(toTimestamptz('2026-13-45')));
  check('Date instance -> iso', toTimestamptz(new Date('2026-08-01T20:00:00Z')) === '2026-08-01T20:00:00.000Z');

  // ── addSavedItem: an unparseable event_date drops, the item survives (hard req) ──
  println('addSavedItem: a natural-language event_date drops to null but the item is STILL saved');
  if (__db.saved_items) __db.saved_items.length = 0;
  await addSavedItem({ userId: 'u1', personId: 'p1', itemType: 'event', title: 'Concert', eventDate: 'this morning', timezone: 'America/New_York' });
  check('the saved_item was inserted (memory not lost)', (__db.saved_items || []).length === 1);
  check('its event_date dropped to null (no 22007)', __db.saved_items[0].event_date === null, String(__db.saved_items[0].event_date));
  check('the title survived', __db.saved_items[0].title === 'Concert');
  await addSavedItem({ userId: 'u1', personId: 'p1', itemType: 'event', title: 'Show', eventDate: '2026-08-01T20:00:00-04:00', timezone: 'America/New_York' });
  check('a valid event_date is normalized + kept', __db.saved_items[1].event_date === '2026-08-02T00:00:00.000Z', String(__db.saved_items[1].event_date));

  // ── addReminder: trigger_at is NOT NULL — an unparseable time is refused ──
  println('addReminder: an unparseable trigger_at throws (persist skips just this reminder)');
  if (__db.reminders) __db.reminders.length = 0;
  let threw = false;
  try { await addReminder({ userId: 'u1', personId: 'p1', title: 'call', triggerAt: 'tonight', timezone: 'America/New_York' }); }
  catch { threw = true; }
  check('NL trigger_at throws instead of inserting null', threw === true);
  check('no reminder row written for the bad time', (__db.reminders || []).length === 0);
  await addReminder({ userId: 'u1', personId: 'p1', title: 'call', triggerAt: '2026-11-12T13:00:00-05:00', timezone: 'America/New_York' });
  check('a valid reminder is written + normalized', __db.reminders.length === 1 && __db.reminders[0].trigger_at === '2026-11-12T18:00:00.000Z', String(__db.reminders[0] && __db.reminders[0].trigger_at));

  // ── addGoal: due_at is a nullable garnish — drops, the goal survives ──
  println('addGoal: an unparseable due_at drops to null but the goal is STILL saved');
  if (__db.user_goals) __db.user_goals.length = 0;
  await addGoal({ userId: 'u1', personId: 'p1', goalText: 'reach out to Sam', dueAt: 'sometime next week', timezone: 'America/New_York' });
  check('the goal was inserted', (__db.user_goals || []).length === 1);
  check('its due_at dropped to null', __db.user_goals[0].due_at === null, String(__db.user_goals[0].due_at));
  check('the goal_text survived', __db.user_goals[0].goal_text === 'reach out to Sam');

  // ── persist end-to-end: a saved_item whose model date is natural language is kept ──
  println('persist: a saved_item with a natural-language event_date is stored, not dropped');
  if (__db.saved_items) __db.saved_items.length = 0;
  __db.people.length = 0;
  __db.people.push({ id: 'p1', user_id: 'u1', name: 'Sam', is_self: false, is_archived: false });
  await persist({
    user, message: msg,
    parsed: { people: [{ mention_text: 'Sam' }], saved_items: [{ person_ref: 'Sam', item_type: 'gift_idea', title: 'that book she mentioned', event_date: 'this weekend' }] },
    resolved: { personByMention: { Sam: 'p1' } },
  });
  check('persist stored the item despite the bad date', (__db.saved_items || []).length === 1 && __db.saved_items[0].event_date === null, JSON.stringify(__db.saved_items[0] || null));

  println('');
  const f = failures;
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
