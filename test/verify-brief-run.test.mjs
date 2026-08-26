// Bundle 40 — scripts/verify-brief-run.mjs, the post-deploy log verifier.
// Run: bun test/verify-brief-run.test.mjs
//
// WHAT RUNS REAL: the real script, both ways. The pure functions are imported
// and driven directly, and the EXIT CODES are taken from actually spawning
// `node scripts/verify-brief-run.mjs <fixture>` — not from calling report() and
// reading its return value. The exit code is the whole contract for anything
// that consumes this from a shell, and a return value from an in-process call
// is not the same fact.
//
// THE FIXTURES ARE REDACTED REAL LINES, from the 2026-08-25 11:00 UTC run in
// ~/Downloads/railway_logs_2026-08-26.txt — correlation ids replaced, the CoS
// project ref replaced with cos.invalid. One line is NOT from a dump and must
// be flagged as such: `cos.compose.ok` ships in dee339d and no production dump
// contains one yet, so it is written from its emit site
// (src/jobs/cosDailyBrief.js:284) in the line shape Railway renders for every
// other event. That is the one place this bundle agrees with itself rather than
// with production (Lesson 20), and it is why the truncation parser is tested
// against BOTH field shapes below.
//
// THE LOAD-BEARING ASSERTIONS:
//   • a complete run          → exit 0
//   • a precheck skip         → exit 0   (a correct outcome, not a failure)
//   • a run missing send.ok   → exit 1, and the output NAMES cos.send.ok
//   • an empty file           → exit 2, printed as "no run in window"
//   • exit 2 is not exit 0    — "found nothing" is not "found it fine"

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCRIPT = join(ROOT, 'scripts', 'verify-brief-run.mjs');
const FIX = join(HERE, 'fixtures', 'verify-brief-run');

const mod = await import('../scripts/verify-brief-run.mjs');
const { parseLine, parseDump, findLatestRun, checkSequence, summarize, truncation, retriedTables, errorLines, report } = mod;

let failures = 0;
const p = (...a) => console.log(...a);
function ok(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}
const section = (n) => { p(''); p('— ' + n + ' —'); };

const fixture = (n) => readFileSync(join(FIX, n), 'utf8');

// Spawn the REAL script and return { code, out }. execFileSync throws on a
// non-zero exit, which is the case we most need to observe, so the status is
// taken off the error object rather than letting it propagate.
function runCli(fixtureName) {
  try {
    const out = execFileSync('node', [SCRIPT, join(FIX, fixtureName)], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: String(err.stdout || '') + String(err.stderr || '') };
  }
}

// Collect report()'s output instead of printing it, so a run's summary can be
// asserted on without 200 lines of noise in the suite output.
function capture(text) {
  const lines = [];
  const code = report(text, (l) => lines.push(String(l)));
  return { code, out: lines.join('\n') };
}

p('Bundle 40 — verify-brief-run: does a log dump prove the brief completed?');

// ═══════════════════════════════════════════════════════════════════════════
section('exit codes — the whole contract, taken from the real process');
{
  const complete = runCli('complete.log');
  ok('a complete run exits 0', complete.code === 0, complete);
  ok('...and says so', /RESULT: complete run/.test(complete.out), complete.out);

  const skipped = runCli('precheck-skipped.log');
  ok('a precheck skip exits 0', skipped.code === 0, skipped);
  ok('...and names it a skip, not a failure',
    /RESULT: complete — precheck skip/.test(skipped.out), skipped.out);

  const broken = runCli('broken-missing-send.log');
  ok('a run missing cos.send.ok exits 1', broken.code === 1, broken);
  ok('...and NAMES the missing step', /missing step: cos\.send\.ok/.test(broken.out), broken.out);

  const empty = runCli('empty.log');
  ok('an empty file exits 2', empty.code === 2, empty);
  ok('...printed as "no run in window (not a pass)"',
    /no run in window \(not a pass\)/.test(empty.out), empty.out);

  // THE CONTROL for every exit-code assertion above. If the script exited 0 on
  // everything, "a complete run exits 0" would pass and mean nothing. These
  // three codes must be mutually distinct or the instrument does not
  // discriminate (II.2).
  ok('CONTROL: the three outcomes produce three DIFFERENT exit codes',
    complete.code === 0 && broken.code === 1 && empty.code === 2
    && new Set([complete.code, broken.code, empty.code]).size === 3,
    { complete: complete.code, broken: broken.code, empty: empty.code });

  // A file with real content but no brief tick is exit 2, same as empty. This
  // separates "no run" from "no bytes" — an empty file could exit 2 for the
  // trivial reason that nothing parsed.
  const noise = runCli('noise-only.log');
  ok('a dump with lines but no cos.mode also exits 2', noise.code === 2, noise);
  // 3 lines in the file, 2 of them log lines — "Starting Container" is a
  // container message, not a logger line, and is correctly not counted.
  ok('...and reports how many LOG lines it parsed, excluding container noise',
    /parsed 2 log line\(s\)/.test(noise.out), noise.out);

  const usage = (() => {
    try { execFileSync('node', [SCRIPT], { encoding: 'utf8' }); return { code: 0 }; }
    catch (err) { return { code: err.status, out: String(err.stderr || '') }; }
  })();
  ok('no argument ⇒ usage, and NOT a success code', usage.code !== 0, usage);
}

// ═══════════════════════════════════════════════════════════════════════════
section('the sequence check');
{
  const lines = parseDump(fixture('complete.log'));
  const run = findLatestRun(lines);
  ok('the run is found by its cos.mode correlation_id',
    run && run.correlationId === '11111111-2222-3333-4444-555555555555', run && run.correlationId);
  ok('every line of the run is collected', run.lines.length === 8, run.lines.length);

  const seq = checkSequence(run.lines);
  ok('a complete run passes the sequence check', seq.ok === true && seq.branch === 'live', seq);

  // cos.owner.derived sits BETWEEN cos.send.ok and cos.brief.written on every
  // real run in the dumps. If the check required adjacency it would fail here.
  const events = run.lines.map((l) => l.event);
  ok('an interleaved unknown event does not break the sequence',
    events.includes('cos.owner.derived') && seq.ok === true, events);

  const skipSeq = checkSequence(parseDump(fixture('precheck-skipped.log')));
  ok('a precheck skip is a PASSING branch, not a missing compose',
    skipSeq.ok === true && skipSeq.branch === 'precheck_skip', skipSeq);

  const brokenSeq = checkSequence(parseDump(fixture('broken-missing-send.log')));
  ok('a missing cos.send.ok fails', brokenSeq.ok === false, brokenSeq);
  ok('...naming cos.send.ok specifically', brokenSeq.missing === 'cos.send.ok', brokenSeq);

  // Each required step, removed one at a time, must be caught by name. Without
  // this the check could be enforcing only its first step and still pass every
  // fixture above.
  for (const step of ['cos.mode', 'cos.delivery.mode', 'cos.compose.ok', 'cos.send.ok', 'cos.brief.written']) {
    const without = parseDump(fixture('complete.log')).filter((l) => l.event !== step);
    const r = checkSequence(without);
    // Dropping cos.mode removes the run's identity too; the sequence check
    // still reports it as the missing head.
    ok(`removing ${step} is caught`, r.ok === false && r.missing === step, { step, r });
  }

  // ORDER, not merely presence. A send before a compose is a different failure
  // from a missing one, and a check that only counted events would pass it.
  const scrambled = parseDump(fixture('complete.log'));
  const iSend = scrambled.findIndex((l) => l.event === 'cos.send.ok');
  const iCompose = scrambled.findIndex((l) => l.event === 'cos.compose.ok');
  [scrambled[iSend], scrambled[iCompose]] = [scrambled[iCompose], scrambled[iSend]];
  const sc = checkSequence(scrambled);
  ok('send BEFORE compose is rejected, not accepted as "both present"',
    sc.ok === false, sc);
}

// ═══════════════════════════════════════════════════════════════════════════
section('a dump with two runs — the NEWEST one is the one reported');
{
  // WHY THIS SECTION EXISTS. Every fixture above holds exactly one run, so
  // "picks the newest" and "picks the only one" are the same behaviour and the
  // mutation making findLatestRun() take the OLDEST stayed green — the guard
  // was live and load-bearing and completely unfalsified (Lesson 19).
  //
  // It matters: the real dumps span days. railway_logs_2026-08-26.txt holds
  // both the 08-24 and the 08-25 run, and reporting on the wrong one means
  // answering "did this morning's brief go out?" with yesterday's result.
  //
  // The older run here is BROKEN and the newer one COMPLETE, so picking wrong
  // is not a different id — it is the opposite verdict.
  const two = parseDump(fixture('two-runs.log'));
  const run = findLatestRun(two);
  ok('the newer run is selected',
    run.correlationId === 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', run.correlationId);
  ok('CONTROL: the older run IS present in the dump and would have been found',
    two.some((l) => l.correlationId === 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'));
  ok('only the newer run\'s lines are collected',
    run.lines.every((l) => l.correlationId === 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb')
    && run.lines.length === 5, run.lines.length);

  const cli = runCli('two-runs.log');
  ok('...so the verdict is the NEWER run\'s: complete, exit 0', cli.code === 0, cli);
  ok('CONTROL: the older run alone would have failed on cos.send.ok',
    checkSequence(two.filter((l) => l.correlationId === 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa')).missing === 'cos.send.ok');

  // "Newest" must mean newest by the SERVICE CLOCK, not last-in-file. Those
  // two rules agree in two-runs.log, so only this fixture separates them.
  const scrambled = parseDump(fixture('two-runs-out-of-order.log'));
  const sRun = findLatestRun(scrambled);
  ok('newest is by timestamp, not by file position',
    sRun.correlationId === 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', sRun.correlationId);
  ok('CONTROL: the OLDER run really is last in that file, so the two rules disagree',
    scrambled[scrambled.length - 1].correlationId === 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    scrambled[scrambled.length - 1].correlationId);
}

// ═══════════════════════════════════════════════════════════════════════════
section('what it reports about the run');
{
  const { code, out } = capture(fixture('complete.log'));
  ok('a complete run reports exit 0', code === 0, code);
  ok('mode is reported', /mode\s+armed/.test(out), out);
  ok('delivery outcome is reported', /delivery\s+live/.test(out), out);
  ok('the retried table is named', /email_ai_analyses \(attempt 2\)/.test(out), out);
  ok('truncation numbers are reported', /20 of 53 eligible considered/.test(out), out);
  ok('compose latency, tokens and model are reported',
    /6487 ms/.test(out) && /8123 tokens/.test(out) && /gpt-4\.1-mini/.test(out), out);
  ok('send latency is reported', /send\s+2135 ms/.test(out), out);

  // Wall time is cos.mode → cos.brief.written on the SERVICE clock:
  // 11:00:01.178Z → 11:00:11.954Z = 10776 ms. Asserting the exact number, not
  // just "a number", because the failure mode here is measuring the wrong pair
  // of lines or the wrong clock, and both produce a plausible-looking figure.
  ok('wall time is cos.mode → cos.brief.written on the service clock',
    /wall time\s+10776 ms/.test(out), out);

  const s = summarize(findLatestRun(parseDump(fixture('complete.log'))));
  ok('wallMs is computed from the service clock, not the ingest clock',
    s.wallMs === 10776, s.wallMs);
  // CONTROL: the ingest timestamps span a different interval (11:00:08.165 →
  // 11:00:11.957 = 3792 ms), so a verifier reading the wrong clock would
  // produce that number instead. They must not be equal, or this assertion
  // cannot tell the two apart.
  ok('CONTROL: the ingest-clock span differs, so the clocks are distinguishable',
    s.wallMs !== 3792, s.wallMs);

  const skip = capture(fixture('precheck-skipped.log'));
  ok('a precheck skip reports its outcome', /precheck\s+SKIPPED — already_sent/.test(skip.out), skip.out);
  ok('...and does not claim a compose that never happened',
    !/compose\s+\d/.test(skip.out), skip.out);
}

// ═══════════════════════════════════════════════════════════════════════════
section('parsing — the two clocks, quoted values, and non-log lines');
{
  const l = parseLine('2026-08-26T11:00:08.165114914Z [INFO] hello there timestamp="2026-08-26T11:00:01.178Z" event="cos.mode" outcome="armed" retry_count=1');
  ok('ingest ts and level are separated', l.ingestTs === '2026-08-26T11:00:08.165114914Z' && l.level === 'INFO', l);
  ok('the message stops at the structured tail', l.message === 'hello there', l.message);
  ok('quoted fields are read', l.event === 'cos.mode' && l.fields.outcome === 'armed', l.fields);
  ok('bare fields are read', l.fields.retry_count === '1', l.fields);
  ok('ts comes from timestamp="…", the service clock', l.ts === Date.parse('2026-08-26T11:00:01.178Z'), l.ts);

  ok('a non-log line is skipped, not thrown on', parseLine('Starting Container') === null);
  ok('an empty dump parses to nothing', parseDump('').length === 0);

  // budget.check writes `mode=armed tokens=0/750000 …` as PROSE, before the
  // structured tail. The message boundary is anchored on timestamp="…" so the
  // prose survives intact rather than being eaten as fields.
  const b = parseLine('2026-08-26T05:10:03.817Z [INFO] mode=armed tokens=0/750000 sms_segments=0/400 persisted=true timestamp="2026-08-26T05:10:01.996Z" event="budget.check" outcome="ok"');
  ok('prose containing key=value keeps its message intact',
    b.message === 'mode=armed tokens=0/750000 sms_segments=0/400 persisted=true', b.message);
  ok('...and the real structured event is still read', b.event === 'budget.check', b.fields);
}

// ═══════════════════════════════════════════════════════════════════════════
section('truncation numbers — structured fields AND the prose fallback');
{
  // The straddle this parser exists for. Every cos.email.truncated line in
  // production to date carries its numbers ONLY in prose, because considered /
  // eligible_total / total_is_floor were not in the logger's allowlist. A
  // verifier that read the structured fields alone would report "unknown"
  // against every real dump that exists.
  const structured = truncation(parseDump(fixture('complete.log')));
  ok('structured fields are preferred when present',
    structured.considered === 20 && structured.eligibleTotal === 53
    && structured.source === 'structured fields', structured);

  const proseOnly = parseDump(
    '2026-08-25T11:00:03.326Z [WARN] email selection capped: 20 of 53 eligible messages considered timestamp="2026-08-25T11:00:03.316Z" event="cos.email.truncated" correlation_id="c" outcome="truncated"');
  const fromProse = truncation(proseOnly);
  ok('the prose fallback reads the same numbers',
    fromProse.considered === 20 && fromProse.eligibleTotal === 53, fromProse);
  ok('...and says where it got them', /message text/.test(fromProse.source), fromProse.source);

  const floored = parseDump(
    '2026-08-25T11:00:03.326Z [WARN] email selection capped: 20 of at least 200 eligible messages considered timestamp="2026-08-25T11:00:03.316Z" event="cos.email.truncated" correlation_id="c" outcome="truncated"');
  const f = truncation(floored);
  ok('"at least" is read as a floor, not as part of the number',
    f.eligibleTotal === 200 && f.totalIsFloor === true, f);

  ok('no truncation event ⇒ null, not a zero',
    truncation(parseDump(fixture('precheck-skipped.log'))) === null);

  const r = retriedTables(parseDump(fixture('complete.log')));
  ok('the retried table name is parsed out of the message',
    r.length === 1 && r[0].table === 'email_ai_analyses' && r[0].attempt === 2, r);
}

// ═══════════════════════════════════════════════════════════════════════════
section('errors — the [LEVEL] tag, because level=error can never match');
{
  const text = fixture('with-errors.log');

  // The fact that makes this necessary, asserted rather than asserted-about:
  // the string `level=error` does not occur in Railway output even when the
  // file contains an error line.
  ok('the fixture DOES contain an error', /\[ERROR\]/.test(text));
  ok('...and `level=error` still matches nothing in it', !/level=error/.test(text));

  const errs = errorLines(text);
  ok('the [ERROR] line is found', errs.length === 1 && /cos\.brief\.aborted/.test(errs[0]), errs);

  const clean = errorLines(fixture('complete.log'));
  ok('CONTROL: a clean dump reports zero error lines', clean.length === 0, clean);

  const { out } = capture(text);
  ok('errors are reported even when the run itself completed', /1 line\(s\) matching/.test(out), out);
  ok('...and the run is still reported complete', /RESULT: complete run/.test(out), out);

  // An error OUTSIDE the run's correlation_id must still surface. The one in
  // this fixture belongs to a different correlation id on purpose.
  ok('an error outside the run window is still reported',
    /99999999-8888-7777-6666-555555555555/.test(out), out);

  ok('a FATAL with no bracket tag is caught too',
    errorLines('some line\nFATAL unhandled rejection\nother').length === 1);
}

p('');
if (failures === 0) p('ALL VERIFY-BRIEF-RUN TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
