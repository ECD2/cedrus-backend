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
//
// ADDED 2026-09-09 — the three facts the job now logs, read WITHOUT changing
// the sequence or the exit codes:
//   • cos.brief.aborted       → still exit 1, and the abort is the FIRST line
//                               of the RESULT, with its fields and its table(s)
//   • cos.brief.written       → the owner id source, repeated as printed
//   • programs.today.read     → the item count and the block's owner source
//   • every dump from before 2026-09-09 lacks all three, and absence is
//     reported as absence: same verdicts, same exit codes as before.
//
// THE SEPTEMBER LINES ARE NOT FROM A DUMP EITHER. No railway_logs_* under
// ~/Downloads carries cos.brief.aborted or programs.today.* (0 hits across all
// of them, 2026-09-09), so each is written from its emit site — cosDailyBrief.js
// for the three abort messages and the two programs events, writer.js for the
// written line — in the line shape Railway rendered for the [ERROR] already in
// with-errors.log (Lesson 20, flagged here as cos.compose.ok was above). They
// are inline rather than files under test/fixtures/ so the line and the
// assertion that reads it sit together and that flag cannot drift apart.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCRIPT = join(ROOT, 'scripts', 'verify-brief-run.mjs');
const FIX = join(HERE, 'fixtures', 'verify-brief-run');

const mod = await import('../scripts/verify-brief-run.mjs');
const {
  parseLine, parseDump, findLatestRun, checkSequence, summarize, truncation, retriedTables, errorLines, report,
  abortedRun, ownerSource, programsBlock,
} = mod;

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
function runCliAt(absPath) {
  try {
    const out = execFileSync('node', [SCRIPT, absPath], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: String(err.stdout || '') + String(err.stderr || '') };
  }
}
function runCli(fixtureName) { return runCliAt(join(FIX, fixtureName)); }

// The inline September fixtures are written to a temp dir so the CLI can be
// SPAWNED on them too — the exit code is the contract, and an in-process
// report() return is not the same fact (see the header).
const TMP = mkdtempSync(join(tmpdir(), 'verify-brief-run-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });
function tmpFixture(name, text) { const path = join(TMP, name); writeFileSync(path, text); return path; }

// One September run, line by line, in the exact shape the 2026-09-04 dump
// renders (ingest ts, [LEVEL], message, then timestamp="…" first in the
// structured tail as buildLogRecord() writes it). Project ref → cos.invalid,
// correlation id replaced. Field ORDER on each tail is the order the emit site
// passes them, which is the order buildLogRecord() copies them.
const SEP_CID = 'abababab-1111-1111-1111-abababababab';
const sep = (ingest, level, message, ts, event, tail) =>
  `${ingest} [${level}] ${message} timestamp="${ts}" event="${event}" service="cedrus-backend" environment="production" correlation_id="${SEP_CID}" trace_stage="dispatch" ${tail}`;
const L = {
  mode: sep('2026-09-10T11:00:04.103162294Z', 'INFO', 'CoS reader ARMED against cos.invalid', '2026-09-10T11:00:01.012Z', 'cos.mode', 'outcome="armed"'),
  delivery: sep('2026-09-10T11:00:04.103171552Z', 'INFO', 'delivery LIVE — a composed brief will be emailed and written back to CoS', '2026-09-10T11:00:01.012Z', 'cos.delivery.mode', 'outcome="live"'),
  retried: sep('2026-09-10T11:00:05.772775953Z', 'INFO', 'CoS decisions succeeded on attempt 2 after a transient failure', '2026-09-10T11:00:02.980Z', 'cos.read.retried', 'outcome="recovered" retry_count=1'),
  truncated: sep('2026-09-10T11:00:05.772783258Z', 'WARN', 'email selection capped: 20 of 53 eligible messages considered', '2026-09-10T11:00:02.982Z', 'cos.email.truncated', 'outcome="truncated" considered=20 eligible_total=53 total_is_floor=false'),
  // src/jobs/cosDailyBrief.js — the programs block, three shapes.
  programsRead: sep('2026-09-10T11:00:05.900000000Z', 'INFO', "today's program: 3 item(s) across the owner's active programs (owner id source: settings)", '2026-09-10T11:00:03.100Z', 'programs.today.read', 'outcome="items" count=3 reason="settings"'),
  programsNone: sep('2026-09-10T11:00:05.900000000Z', 'INFO', "today's program: no items scheduled today for this owner (owner id source: env) — no block", '2026-09-10T11:00:03.100Z', 'programs.today.read', 'outcome="none" count=0 reason="env"'),
  programsSkipped: sep('2026-09-10T11:00:05.900000000Z', 'INFO', "no Cedrus app_users id could be resolved for this brief (user_settings.cos_user_id unset for this CoS owner and COS_BRIEF_USAGE_USER_ID unset) — the today's-program block is skipped. The rest of the brief continues.", '2026-09-10T11:00:03.100Z', 'programs.today.skipped', 'outcome="no_app_user"'),
  compose: sep('2026-09-10T11:00:11.184027636Z', 'INFO', '', '2026-09-10T11:00:10.747Z', 'cos.compose.ok', 'outcome="composed" latency_ms=7609 tokens=6145 model="gpt-4.1-mini-2025-04-14"'),
  send: sep('2026-09-10T11:00:13.431085037Z', 'INFO', 'daily brief sent via resend', '2026-09-10T11:00:11.570Z', 'cos.send.ok', 'outcome="sent" latency_ms=292'),
  // src/services/cos/writer.js — the source is in the message and nowhere else.
  writtenEnv: sep('2026-09-10T11:00:13.431092214Z', 'INFO', 'brief written back to CoS today_briefs (owner id source: env)', '2026-09-10T11:00:11.934Z', 'cos.brief.written', 'outcome="ok"'),
  writtenSettings: sep('2026-09-10T11:00:13.431092214Z', 'INFO', 'brief written back to CoS today_briefs (owner id source: settings)', '2026-09-10T11:00:11.934Z', 'cos.brief.written', 'outcome="ok"'),
  writtenUnstated: sep('2026-09-10T11:00:13.431092214Z', 'INFO', 'brief written back to CoS today_briefs', '2026-09-10T11:00:11.934Z', 'cos.brief.written', 'outcome="ok"'),
  // src/jobs/cosDailyBrief.js — the three cos.brief.aborted emit sites. None
  // passes `reason`; the tail is exactly what each site hands the logger.
  abortedTables: sep('2026-09-10T11:00:05.900000000Z', 'ERROR', 'CoS tables unreadable (email_ai_analyses, decisions) — refusing to compose a brief from partial data', '2026-09-10T11:00:03.401Z', 'cos.brief.aborted', 'error_category="db_error" outcome="fail_closed"'),
  abortedProgramItems: sep('2026-09-10T11:00:05.900000000Z', 'ERROR', 'program_items unreadable (42883: function public.todays_program_items(uuid, timestamp with time zone) does not exist) — refusing to compose a brief from partial data. If this is 42883/PGRST202, the programs migration is not applied (Law 11).', '2026-09-10T11:00:03.401Z', 'cos.brief.aborted', 'error_category="db_error" outcome="fail_closed" error_code="42883"'),
  abortedNoOwner: sep('2026-09-10T11:00:04.200000000Z', 'ERROR', 'cannot determine whose brief to compose (unresolved) — refusing to read CoS unscoped. Set COS_USER_ID, or user_settings.cos_user_id for this person. Nothing gathered, nothing composed, nothing billed.', '2026-09-10T11:00:01.100Z', 'cos.brief.aborted', 'error_category="config" outcome="fail_closed"'),
};
const dump = (...lines) => lines.join('\n') + '\n';
const resultLine = (out) => out.split('\n').find((l) => l.startsWith('RESULT:')) || '';

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

// ═══════════════════════════════════════════════════════════════════════════
section('an aborted run — the abort is the FIRST line of the result (2026-09-09)');
{
  const dumpT = dump(L.mode, L.delivery, L.retried, L.abortedTables);
  const r = runCliAt(tmpFixture('aborted-tables.log', dumpT));
  ok('an aborted run exits 1 — the code a broken sequence has always had, not a new one', r.code === 1, r);
  const result = resultLine(r.out);
  ok('the RESULT line names cos.brief.aborted',
    /^RESULT: BROKEN SEQUENCE — ABORTED \(cos\.brief\.aborted\)/.test(result), result);
  ok('...with the fields the line actually carries, under their own names',
    /error_category=db_error outcome=fail_closed/.test(result), result);
  ok('...and BOTH tables it names', /CoS tables unreadable: email_ai_analyses, decisions/.test(result), result);
  const iAbort = r.out.indexOf('ABORTED');
  const iMissing = r.out.indexOf('missing step: cos.compose.ok');
  ok('the missing step is still named, and it comes AFTER the abort line',
    iAbort !== -1 && iMissing > iAbort, { iAbort, iMissing });
  // 11:00:01.012Z → 11:00:03.401Z on the service clock. Exact, for the same
  // reason the complete run's 10776 ms is exact: the wrong pair of lines also
  // yields a plausible number.
  ok('the abort ends the run: wall time is cos.mode → cos.brief.aborted, 2389 ms on the service clock',
    /wall time\s+2389 ms \(2\.39 s\)\s+\(cos\.mode → cos\.brief\.aborted\)/.test(r.out), r.out);

  // CONTROL. The identical dump minus the abort line is an ordinary broken
  // sequence: same exit code, the plain RESULT line, no ABORTED anywhere. If
  // this did not differ, the assertions above would be reading the missing-
  // step path and calling it abort handling.
  const c = runCliAt(tmpFixture('aborted-tables-control.log', dump(L.mode, L.delivery, L.retried)));
  ok('CONTROL: without the abort line — exit 1, plain "missing step" RESULT, no ABORTED',
    c.code === 1 && !/ABORTED/.test(c.out) && /RESULT: BROKEN SEQUENCE — missing step: cos\.compose\.ok/.test(c.out), c.out);
  ok('CONTROL: an abort is not exit 0 and not exit 2 — no new code was invented', r.code !== 0 && r.code !== 2, r.code);
  // An abort line that belongs to ANOTHER correlation id (with-errors.log) is
  // an error in the file, not this run's abort: the run stays complete.
  const other = runCli('with-errors.log');
  ok('CONTROL: an abort line outside the run is listed under errors and does NOT become this run\'s abort',
    other.code === 0 && !/ABORTED/.test(other.out) && /1 line\(s\) matching/.test(other.out), other.out);

  // The two other emit sites, each with its own message shape.
  const pi = runCliAt(tmpFixture('aborted-program-items.log', dump(L.mode, L.delivery, L.retried, L.truncated, L.abortedProgramItems)));
  const piResult = resultLine(pi.out);
  ok('the program_items abort names program_items and carries error_code=42883 (the Law 11 tripwire)',
    pi.code === 1 && /table unreadable: program_items/.test(piResult) && /error_code=42883/.test(piResult), piResult);
  ok('...and does NOT read the error detail in the parenthetical as a table list',
    !/42883: function/.test(piResult) && !/uuid/.test(piResult), piResult);

  const own = runCliAt(tmpFixture('aborted-no-owner.log', dump(L.mode, L.delivery, L.abortedNoOwner)));
  const ownResult = resultLine(own.out);
  ok('the no-owner abort reports error_category=config, the owner source, and that no table is named',
    own.code === 1 && /error_category=config/.test(ownResult) && /owner source: unresolved/.test(ownResult)
    && /no table named/.test(ownResult), ownResult);

  // The pure function, driven directly.
  const a = abortedRun(parseDump(dumpT));
  ok('abortedRun() reads the fields structurally and the tables from the prose',
    a.errorCategory === 'db_error' && a.outcome === 'fail_closed' && a.errorCode === null
    && a.tables.length === 2 && a.tables[0] === 'email_ai_analyses' && a.tables[1] === 'decisions' && a.parsed === true, a);
  const b = abortedRun(parseDump(L.abortedProgramItems));
  ok('...program_items: one table, error_code 42883',
    b.tables.length === 1 && b.tables[0] === 'program_items' && b.errorCode === '42883', b);
  const o = abortedRun(parseDump(L.abortedNoOwner));
  ok('...no owner: zero tables, ownerSource unresolved, error_category config',
    o.tables.length === 0 && o.ownerSource === 'unresolved' && o.errorCategory === 'config', o);
  ok('no abort line ⇒ null, not an empty record', abortedRun(parseDump(fixture('complete.log'))) === null);
  // Asserted so nobody "fixes" the parser to read a key that is not there.
  const abortedFields = parseLine(L.abortedTables).fields;
  ok('CONTROL: the aborted line carries NO reason field — error_category and outcome are what it has',
    abortedFields.reason === undefined && abortedFields.error_category === 'db_error' && abortedFields.outcome === 'fail_closed',
    abortedFields);
  // A shape this parser does not know is surfaced, not smoothed into "no table".
  const odd = abortedRun(parseDump(sep('2026-09-10T11:00:05.900000000Z', 'ERROR', 'something new happened — details follow',
    '2026-09-10T11:00:03.401Z', 'cos.brief.aborted', 'error_category="internal" outcome="fail_closed"')));
  ok('an unrecognised abort message is reported as its first clause and marked unparsed',
    odd.parsed === false && odd.cause === 'something new happened' && odd.tables.length === 0, odd);
}

// ═══════════════════════════════════════════════════════════════════════════
section('the owner id source on cos.brief.written — prose-only, repeated as printed (2026-09-09)');
{
  const d = ownerSource(findLatestRun(parseDump(fixture('complete.log'))).lines);
  ok("the August shape says 'derived'", d !== null && d.stated === true && d.source === 'derived', d);
  const aug = capture(fixture('complete.log'));
  ok('...and the report prints it', /written\s+ok — owner id source: derived/.test(aug.out), aug.out);
  ok("...without the 'settings' caveat", !/until 9e9a91d/.test(aug.out), aug.out);

  const st = capture(dump(L.mode, L.delivery, L.compose, L.send, L.writtenSettings));
  ok("a 'settings' label is repeated as printed", /written\s+ok — owner id source: settings/.test(st.out), st.out);
  ok('...WITH the caveat naming the build that stamped it on any id (II.5)', /until 9e9a91d \(2026-09-04\)/.test(st.out), st.out);
  ok('...and the run is still complete, exit 0 — the label is reported, not judged', st.code === 0, st.code);

  const en = capture(dump(L.mode, L.delivery, L.compose, L.send, L.writtenEnv));
  ok("an 'env' label is printed plain, no caveat",
    /written\s+ok — owner id source: env/.test(en.out) && !/until 9e9a91d/.test(en.out), en.out);

  const un = capture(dump(L.mode, L.delivery, L.compose, L.send, L.writtenUnstated));
  ok('a written line with no source phrase says so rather than inventing one',
    /written\s+ok — owner id source not stated on this line/.test(un.out), un.out);
  const unParsed = ownerSource(parseDump(L.writtenUnstated));
  ok('...and ownerSource() returns stated:false, source:null', unParsed.stated === false && unParsed.source === null, unParsed);

  ok('no written line ⇒ null', ownerSource(parseDump(fixture('precheck-skipped.log'))) === null);
  const skip = capture(fixture('precheck-skipped.log'));
  ok('a precheck skip prints no written line — it claims no writeback that never happened', !/^written/m.test(skip.out), skip.out);
  const noWrite = capture(fixture('complete.log').split('\n').filter((l) => !l.includes('cos.brief.written')).join('\n'));
  ok('a live run missing the written line says so, and is broken (exit 1) as before',
    /written\s+\(no cos\.brief\.written line\)/.test(noWrite.out) && noWrite.code === 1, noWrite);
}

// ═══════════════════════════════════════════════════════════════════════════
section("the today's-program block — count and owner source, both structured (2026-09-09)");
{
  const withProg = dump(L.mode, L.delivery, L.retried, L.truncated, L.programsRead, L.compose, L.send, L.writtenEnv);
  const r = runCliAt(tmpFixture('complete-with-programs.log', withProg));
  ok('a complete run WITH programs.today.read still exits 0 — an interleaved event is not a broken sequence', r.code === 0, r);
  ok('...and reports the item count', /programs\s+3 item\(s\) today/.test(r.out), r.out);
  ok('...and the owner id source the BLOCK resolved (settings)',
    /programs\s+3 item\(s\) today.*owner id source: settings/.test(r.out), r.out);
  ok("...separately from the WRITEBACK's source (env) — two lookups, and they can disagree",
    /written\s+ok — owner id source: env/.test(r.out), r.out);

  const pb = programsBlock(findLatestRun(parseDump(withProg)).lines);
  ok('programsBlock() reads count and reason from the STRUCTURED fields',
    pb.event === 'programs.today.read' && pb.outcome === 'items' && pb.count === 3 && pb.ownerSource === 'settings', pb);
  ok('count is a NUMBER, not the string "3"', typeof pb.count === 'number', typeof pb.count);
  // CONTROL: the count comes from count=, not from "3 item(s)" in the prose.
  // Change the field, keep the prose; a prose reader would still say 3.
  const pb7 = programsBlock(parseDump(L.programsRead.replace('count=3', 'count=7')));
  ok('CONTROL: the count is read from count=, not from the prose', pb7.count === 7, pb7);

  const none = capture(dump(L.mode, L.delivery, L.programsNone, L.compose, L.send, L.writtenEnv));
  ok('count=0 / outcome=none is "no items today", with 0 kept as 0 (not read as missing)',
    /programs\s+no items today\s+\(programs\.today\.read count=0, owner id source: env\)/.test(none.out) && none.code === 0, none.out);
  ok('...programsBlock() gives count 0, not null', programsBlock(parseDump(L.programsNone)).count === 0);

  const sk = capture(dump(L.mode, L.delivery, L.programsSkipped, L.compose, L.send, L.writtenEnv));
  ok('programs.today.skipped is reported as a skipped block, and the run is still complete',
    /programs\s+block skipped — no_app_user/.test(sk.out) && sk.code === 0, sk.out);

  // Absence. Every dump written before 2026-09-09 has no programs line at all,
  // and that is reported as the normal state of an older build — not an
  // error, and not a change of verdict.
  const old = capture(fixture('complete.log'));
  ok('a dump with no programs line reports its absence in so many words',
    /programs\s+\(no programs\.today\.\* line on this run/.test(old.out), old.out);
  ok('...and says "not an error"', /not an error\)/.test(old.out), old.out);
  ok('...and is still a complete run, exit 0', old.code === 0 && /RESULT: complete run/.test(old.out), old.code);
  ok('programsBlock() ⇒ null on it', programsBlock(findLatestRun(parseDump(fixture('complete.log'))).lines) === null);
}

// ═══════════════════════════════════════════════════════════════════════════
section('the real dumps on this machine — verdicts unchanged by the new reporting');
{
  // The four dumps this work was asked to keep passing. Two of them were exit
  // 1 BEFORE it touched anything: the full 08-26 dump and its filtered copy
  // both hold the 08-25 11:00 run as their newest, and that run predates
  // cos.compose.ok (dee339d, 2026-08-26). So the assertion is the honest one —
  // the verdict inherited is the verdict left — not "exit 0" for all four,
  // which was never true.
  //
  // This section can only run on the machine that holds ~/Downloads. A silent
  // skip would be indistinguishable from a pass (Lesson 7), so each absent
  // file is printed and counted, and the count is printed at the end.
  const REAL = [
    ['railway_logs_2026-08-26.txt', 1, 'derived-cached', 'its newest run is 08-25, before cos.compose.ok shipped'],
    ['railway_logs_2026-08-26_1100run.txt', 0, 'derived', 'the first run with cos.compose.ok'],
    ['railway_logs_2026-08-26_filtered.txt', 1, 'derived-cached', 'the same 08-25 run, filtered'],
    ['railway_logs_2026-09-04.txt', 0, 'settings', 'the label writer.js stamped before 9e9a91d'],
  ];
  let ran = 0;
  let absent = 0;
  for (const [name, code, label, why] of REAL) {
    const path = join(homedir(), 'Downloads', name);
    if (!existsSync(path)) {
      p(`  SKIP  ${name} — not under ~/Downloads on this machine (announced; not a pass)`);
      absent++;
      continue;
    }
    ran++;
    const r = runCliAt(path);
    ok(`${name}: exit ${code}, as before this work (${why})`, r.code === code, { code: r.code });
    ok(`...owner id source read from its written line as '${label}'`,
      new RegExp(`written\\s+ok — owner id source: ${label}`).test(r.out), r.out.split('\n').filter((l) => /^written/.test(l)));
    ok('...no programs line, reported as absence; no ABORTED',
      /no programs\.today\.\* line/.test(r.out) && !/ABORTED/.test(r.out), r.out);
  }
  p(`  real dumps: ${ran} run, ${absent} absent (announced above)`);
}

p('');
if (failures === 0) p('ALL VERIFY-BRIEF-RUN TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
