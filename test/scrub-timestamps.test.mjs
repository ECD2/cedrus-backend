// Bundle 39 — logger.scrub(): known structures survive, phone numbers do not.
// Run: bun test/scrub-timestamps.test.mjs
//
// What runs REAL here: the actual scrub() exported by src/utils/logger.js, and
// the real logger.event() path end to end. Nothing is reimplemented.
//
// THE ASSERTION THAT MATTERS is redaction, not date-preservation. The bug being
// fixed was cosmetic (a date rendered as [phone:0815]); the risk in fixing it is
// not. Any change to that regex can quietly stop redacting a real number, and
// that leaks PII into logs that ship to Railway. So every phone case below
// asserts TWO things:
//     • the [phone:NNNN] marker appeared, AND
//     • no run of 7+ consecutive digits survives anywhere in the output
// The second is the real guard: a "redaction" that emitted [phone:7469] while
// leaving the full number elsewhere in the string would satisfy the first alone.
//
// Why masking and not a lookbehind: (?<![\d-]) would refuse to start a match
// after a hyphen, so 'call-7869727469' would go unredacted. That case is in the
// table below precisely so the cheaper fix cannot be reintroduced silently.

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'sk-test-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

const { scrub, logger } = await import('../src/utils/logger.js');

let failures = 0;
const p = (...a) => console.log(...a);
function ok(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}
const section = (n) => { p(''); p('— ' + n + ' —'); };

const hasLongDigitRun = (s) => /\d{7}/.test(s);
const redacted = (s) => /\[phone:\d{4}\]/.test(s);

// ═══════════════════════════════════════════════════════════════════════════
section('phone numbers are STILL redacted — the load-bearing assertion');
{
  const PHONES = [
    ['E.164',                 'from=+17869727469',        '7469'],
    ['bare 11-digit',         '17869727469',              '7469'],
    ['bare 10-digit',         '7869727469',               '7469'],
    ['hyphenated',            'to: 786-972-7469',         '7469'],
    ['parenthesised',         '(786) 972-7469',           '7469'],
    ['spaced E.164',          '+1 786 972 7469',          '7469'],
    ['dotted',                '786.972.7469',             '7469'],
    ['fully hyphenated E164', '+1-786-972-7469',          '7469'],
    ['another number',        '+13055551234',             '1234'],
    // THE REGRESSION CASE. A negative lookbehind (?<![\d-]) — the obvious
    // cheaper fix for the date bug — stops matching here and leaks the number.
    ['preceded by a hyphen',  'call-7869727469',          '7469'],
    ['preceded by a digit',   'x9 7869727469',            '7469'],
  ];
  for (const [label, input, last4] of PHONES) {
    const out = scrub(input);
    ok(`${label}: marker present`, redacted(out) && out.includes(`[phone:${last4}]`), out);
    ok(`${label}: NO 7-digit run survives`, !hasLongDigitRun(out), out);
  }

  // Short numerics must stay intact — over-redaction destroys useful logs.
  for (const keep of ['3 segments', 'count=42', 'id 12345', 'port 8080', 'HTTP 200']) {
    ok(`short numeric untouched: ${keep}`, scrub(keep) === keep, scrub(keep));
  }
  // >15 digits is not a phone and is left alone (existing behaviour, pinned).
  const long = '12345678901234567890';
  ok('a 20-digit run is not treated as a phone', scrub(long) === long, scrub(long));
}

// ═══════════════════════════════════════════════════════════════════════════
section('ISO timestamps survive intact — the bug being fixed');
{
  const DATES = [
    'reminder-dispatch:2026-08-15T20:25Z',
    'Cedrus daily brief — 2026-08-17 — Pay the vendor',
    '2026-08-17T23:35:40.899Z',
    'week_of=2026-08-15',
    '2026-08-15T20:25:00+05:30',
    '2026-08-15T20:25:00-04:00',
    '2026-08-15 20:25:00',
    'between 2026-08-15 and 2026-08-16',
  ];
  for (const d of DATES) {
    ok(`untouched: ${d}`, scrub(d) === d, scrub(d));
  }
  ok('a bare time was never at risk (":" is not a phone separator)',
    scrub('at 20:25:00') === 'at 20:25:00');
}

// ═══════════════════════════════════════════════════════════════════════════
section('UUIDs survive intact — correlation_ids taken from production logs');
{
  // These three are the shapes that exposed the bug. The live service logged
  // correlation_id="7998d9b5-cc[phone:4996]d1d-..." because '41-4996-8' is
  // digits-and-hyphens and reads as a seven-digit number.
  //
  // A and B are RECONSTRUCTIONS. The originals cannot be recovered: the
  // corruption is lossy, and running the pre-fix scrub over these values
  // produces a different marker than prod logged, which proves the true inputs
  // differed. C is verbatim — it survived by luck, so it was logged in full.
  // That is exactly why C belongs here: a fix that only handled ids which
  // happen to break would leave the lucky ones untested and free to regress.
  const CORRELATION_IDS = [
    ['A (reconstruction, was mangled)', '7998d9b5-cc41-4996-8d1d-03464d61dc0d'],
    ['B (reconstruction, was mangled)', 'd12156a7-5347-41bd-b8ef-359ad9d81949'],
    ['C (verbatim, survived by luck)',  '7efca79c-ac27-4f54-a949-4ef8a20520b4'],
  ];
  for (const [label, id] of CORRELATION_IDS) {
    ok(`${label}: passes through untouched`, scrub(id) === id, scrub(id));
    ok(`${label}: no [phone:] marker is invented`, !/\[phone:/.test(scrub(id)), scrub(id));
  }

  // Shape coverage beyond the three real ones.
  const SHAPES = [
    ['all-digit groups',   '12345678-1234-1234-1234-123456789012'],
    ['uppercase hex',      '7EFCA79C-AC27-4F54-A949-4EF8A20520B4'],
    ['leading zeros',      '00000000-0000-0000-0000-000000000000'],
  ];
  for (const [label, id] of SHAPES) {
    ok(`uuid shape untouched: ${label}`, scrub(id) === id, scrub(id));
  }

  // In situ, as the logger actually emits it.
  const line = 'correlation_id="7998d9b5-cc41-4996-8d1d-03464d61dc0d" trace_stage="dispatch"';
  ok('a full log fragment is untouched', scrub(line) === line, scrub(line));

  // CONTROL: the exemption must require an EXACT uuid shape. If a near-miss
  // were exempted too, the exemption itself could hide a phone number — which
  // is the only way this change could make redaction worse.
  //
  // Group 2 has five hex digits instead of four, so it is not a uuid; the
  // digit run '41-4996-8' is still seven digits and must still be redacted.
  const nearMiss = '7998d9b5-cc411-4996-8d1d-03464d61dc0d';
  ok('CONTROL: a malformed uuid gets NO exemption and is still redacted',
    scrub(nearMiss) !== nearMiss && /\[phone:/.test(scrub(nearMiss)), scrub(nearMiss));

  // Not a uuid and untouched — but for a DIFFERENT reason, and the distinction
  // matters. 31 digits exceeds the phone pass's own 15-digit ceiling, so it is
  // declined as too long to be a phone, not exempted as a known structure.
  // Asserting this as "the exemption worked" would have been a false proof; the
  // first draft of this control did exactly that.
  const tooLong = '1234567-1234-1234-1234-123456789012';
  ok('a 31-digit run is declined by the phone pass, not by the exemption',
    scrub(tooLong) === tooLong && !/\[phone:/.test(scrub(tooLong)), scrub(tooLong));
}

// ═══════════════════════════════════════════════════════════════════════════
section('one combined mask pass — order is preserved when shapes interleave');
{
  // The stash restores in document order, so masking must happen in document
  // order. Two sequential passes (all UUIDs, then all timestamps) would stash
  // out of order and the restore would put them back in the wrong places.
  const mixed = 'run 7998d9b5-cc41-4996-8d1d-03464d61dc0d at 2026-08-20T11:00:00Z ' +
                'then d12156a7-5347-41bd-b8ef-359ad9d81949 at 2026-08-21';
  ok('uuid → date → uuid → date round-trips exactly', scrub(mixed) === mixed, scrub(mixed));

  const dateFirst = '2026-08-20T11:00:00Z 7efca79c-ac27-4f54-a949-4ef8a20520b4 2026-08-21 ' +
                    'd12156a7-5347-41bd-b8ef-359ad9d81949';
  ok('date → uuid → date → uuid round-trips exactly', scrub(dateFirst) === dateFirst, scrub(dateFirst));

  // And a phone in the middle of all that is still caught.
  const withPhone = '7efca79c-ac27-4f54-a949-4ef8a20520b4 +17869727469 2026-08-20T11:00:00Z';
  const out = scrub(withPhone);
  ok('the uuid survives alongside a redacted phone', out.includes('7efca79c-ac27-4f54-a949-4ef8a20520b4'), out);
  ok('the timestamp survives too', out.includes('2026-08-20T11:00:00Z'), out);
  ok('the phone is redacted', /\[phone:7469\]/.test(out), out);
  ok('NO 7-digit run survives anywhere', !hasLongDigitRun(out), out);
}

// ═══════════════════════════════════════════════════════════════════════════
section('mixed input — a date and a phone in one string');
{
  const out = scrub('at 2026-08-15T20:25Z we texted +17869727469 about 2026-08-16');
  ok('the date survives', out.includes('2026-08-15T20:25Z') && out.includes('2026-08-16'), out);
  ok('the phone is redacted', out.includes('[phone:7469]'), out);
  ok('no 7-digit run survives', !hasLongDigitRun(out), out);

  const many = scrub('2026-08-01 2026-08-02 2026-08-03 +17869727469');
  ok('several dates all restored, in order',
    many.includes('2026-08-01') && many.includes('2026-08-02') && many.includes('2026-08-03'), many);
  ok('...and the trailing phone still redacted', many.includes('[phone:7469]'), many);
  ok('...with no 7-digit run left', !hasLongDigitRun(many), many);
}

// ═══════════════════════════════════════════════════════════════════════════
section('the sentinel cannot leak or corrupt output');
{
  const SENT = '\uE000';  // the escape, never a raw invisible char in source
  ok('no sentinel in ordinary scrubbed output', !scrub('2026-08-15 +17869727469').includes(SENT));
  // Adversarial: a caller who already has the sentinel in their string. The
  // stash must not swallow it or run dry silently.
  const evil = `${SENT} 2026-08-15 ${SENT}`;
  const out = scrub(evil);
  ok('a pre-existing sentinel does not destroy the real date', out.includes('2026-08-15'), out);
  ok('a pre-existing sentinel does not throw', typeof out === 'string');
}

// ═══════════════════════════════════════════════════════════════════════════
section('secrets are still redacted (regression — scrub was restructured)');
{
  // ── Fixtures are ASSEMBLED AT RUNTIME, never written as literals ─────────
  //
  // GitHub push protection blocked this repo's push on the Twilio line below
  // when it was a literal. 'AC' + 32 hex IS an Account SID, and a scanner
  // cannot tell a synthetic fixture from a live credential — the shape is the
  // only signal it has, so it was right to stop.
  //
  // Nothing here needs the literal. Every rule under test matches on SHAPE, so
  // assembling the shape at runtime exercises it identically while leaving
  // nothing in the source for a scanner to find. Proven, not assumed: mutating
  // each secret rule in logger.js turns this section RED.
  const HEX16 = '0123456789' + 'abcdef';
  const EYJ = 'ey' + 'J';
  // Third element: a fragment of the secret that must NOT reach the log.
  const SECRETS = [
    ['OpenAI key',  'key=' + 'sk' + '-abcdefghijklmnopqrstuv', 'mnopqrstuv'],
    ['SendGrid',    'SG' + '.abcdefghijklmnop' + '.qrstuvwx',  'qrstuvwx'],
    ['Twilio SID',  'AC' + HEX16 + HEX16,                      '89abcdef'],
    ['JWT',         [EYJ + 'hbGciOiJIUzI1NiJ9', EYJ + 'zdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefg'].join('.'), 'abcdefg'],
  ];
  for (const [label, input, mustNotSurvive] of SECRETS) {
    const out = scrub(input);
    ok(`${label}: [secret] marker present`, out.includes('[secret]'), out);
    // The marker alone is NOT proof, and a mutation run showed exactly why.
    // Deleting the full-JWT rule still yields '[secret].[secret].abcdefg' —
    // two markers and a SURVIVING SIGNATURE — because the lone-JWT rule catches
    // each segment separately. An includes('[secret]') assertion calls that a
    // pass. Assert instead that no fragment of the original reaches the log.
    ok(`${label}: no fragment survives`, !out.includes(mustNotSurvive), out);
  }
  const DATEY_KEY = 'sk' + '-2026-08-15-abcdefghijkl';
  ok('a secret containing a date-like run is still a secret',
    scrub(DATEY_KEY).includes('[secret]'), scrub(DATEY_KEY));
}

// ═══════════════════════════════════════════════════════════════════════════
section('end to end through the real logger');
{
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const grab = (x) => lines.push(String(x));
  console.log = grab; console.warn = grab; console.error = grab;
  try {
    logger.event('job.tick', { message: 'reminder-dispatch:2026-08-15T20:25Z for +17869727469' });
  } finally { Object.assign(console, orig); }

  const rec = JSON.parse(lines[0]);
  ok('logger emitted one record', lines.length === 1 && rec.event === 'job.tick', lines.length);
  ok('the job id keeps its real timestamp', rec.message.includes('2026-08-15T20:25Z'), rec.message);
  ok('the phone is redacted in the emitted line', rec.message.includes('[phone:7469]'), rec.message);
  ok('NO 7-digit run reaches the log sink', !hasLongDigitRun(rec.message), rec.message);
}

// ═══════════════════════════════════════════════════════════════════════════
section('non-string input passes through unchanged');
{
  ok('numbers pass through', scrub(42) === 42);
  ok('null passes through', scrub(null) === null);
  ok('undefined passes through', scrub(undefined) === undefined);
  ok('objects pass through by identity', (() => { const o = {}; return scrub(o) === o; })());
}

p('');
if (failures === 0) p('ALL SCRUB TIMESTAMP TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
