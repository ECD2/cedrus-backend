// Phase 1 birthday routing — a stated birthday populates the STRUCTURED
// people.birthday_month/day the insight/discovery engines read (not only a
// reminders row). Concatenated after stubs.js + (import/export-stripped)
// memory.js / people.js / 07_persist.js by run-tests.sh.

(async () => {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) { println('  PASS  ' + name); }
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  const person = (id) => __db.people.find((p) => p.id === id);
  const seedQuin = () => {
    __db.people.length = 0;
    __db.people.push({ id: 'quin', user_id: 'u1', name: 'Quin', is_self: false, is_archived: false, birthday_month: null, birthday_day: null });
  };
  const user = { id: 'u1', timezone: 'America/New_York' };
  const msg = { id: 'm1' };

  // ── pure helpers ──
  println('validBirthday / monthDayFromIsoDate');
  check('valid 11/12', validBirthday(11, 12) === true);
  check('reject month 13', validBirthday(13, 1) === false);
  check('reject day 0', validBirthday(2, 0) === false);
  check('reject non-integer', validBirthday(11.5, 12) === false);
  check('ISO date prefix -> 11/12', JSON.stringify(monthDayFromIsoDate('2026-11-12T13:00:00-05:00')) === JSON.stringify({ month: 11, day: 12 }));
  check('garbage -> null', monthDayFromIsoDate('nope') === null);

  // ── structured birthdays[] path ──
  println('structured birthdays[] populates people.birthday_month/day');
  seedQuin();
  await persist({
    user, message: msg,
    parsed: { people: [{ mention_text: 'Quin' }], birthdays: [{ person_ref: 'Quin', month: 11, day: 12 }], reminders: [] },
    resolved: { personByMention: { Quin: 'quin' } },
  });
  check('birthday_month = 11', person('quin').birthday_month === 11, String(person('quin').birthday_month));
  check('birthday_day = 12', person('quin').birthday_day === 12, String(person('quin').birthday_day));

  // ── reminder-only path (the observed production case) still populates the field ──
  println('a birthday given ONLY as a reminder still backfills people.birthday, and keeps the reminder');
  seedQuin();
  if (__db.reminders) __db.reminders.length = 0;
  await persist({
    user, message: msg,
    parsed: {
      people: [{ mention_text: 'Quin' }],
      reminders: [{ person_ref: 'Quin', title: "Quin's birthday", trigger_at: '2026-11-12T13:00:00-05:00', reminder_type: 'birthday' }],
    },
    resolved: { personByMention: { Quin: 'quin' } },
  });
  check('backfilled birthday_month = 11', person('quin').birthday_month === 11, String(person('quin').birthday_month));
  check('backfilled birthday_day = 12', person('quin').birthday_day === 12, String(person('quin').birthday_day));
  check('the birthday reminder was STILL created (kept)', !!(__db.reminders && __db.reminders.some((r) => r.reminder_type === 'birthday')));

  // ── a bad birthday is ignored, not written ──
  println('an out-of-range birthday is skipped, not written');
  seedQuin();
  await persist({
    user, message: msg,
    parsed: { people: [{ mention_text: 'Quin' }], birthdays: [{ person_ref: 'Quin', month: 13, day: 40 }], reminders: [] },
    resolved: { personByMention: { Quin: 'quin' } },
  });
  check('invalid birthday leaves month null', person('quin').birthday_month == null, String(person('quin').birthday_month));

  println('');
  const f = failures;
  println(f === 0 ? 'ALL TESTS PASSED' : f + ' TEST(S) FAILED');
  if (f > 0 && typeof process !== 'undefined') process.exit(1);
})();
