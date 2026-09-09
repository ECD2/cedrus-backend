#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// verify-brief-run.mjs — did the CoS daily brief actually complete?
//
//   node scripts/verify-brief-run.mjs <path-to-railway-log-dump>
//
// Dependency-free. Reads a Railway CLI log dump from disk and answers ONE
// question: did the most recent cos-daily-brief run get all the way through,
// and what did it cost?
//
// WHY THIS EXISTS. The brief runs unattended at 11:00 UTC on Railway. The only
// record of what it did is a log window, and reading that window by eye is how
// a session concluded delivery was unconfigured in production while the logs
// said `delivery LIVE` and five emails had already arrived. A green battery
// says nothing about a cron tick; this is the instrument that does.
//
// ── the sequence it checks ───────────────────────────────────────────────
//
//   cos.mode (outcome="armed")
//     → cos.delivery.mode
//       → zero or more cos.read.retried
//         → optional cos.email.truncated
//           → EITHER cos.brief.skipped_precheck        (a valid, complete answer)
//             OR     cos.compose.ok → cos.send.ok → cos.brief.written
//
// Other events may be interleaved and are not errors. cos.owner.derived sat
// between cos.send.ok and cos.brief.written on every August 2026 run and has
// not fired since COS_USER_ID was set on 2026-08-30 (II.5) — a verifier that
// expected it on every run would be calibrated against a pre-08-30 dump. The
// programs.today.* events (2757813, 2026-09-09) sit between cos.email.truncated
// and cos.compose.ok. The check is on the RELATIVE ORDER of the required
// events, not on adjacency, because pinning adjacency would make the verifier
// fail the moment the job logs one more line.
//
// ── what it reads beyond the sequence (2026-09-09) ───────────────────────
//
// Three facts the job now logs, reported without changing the sequence or the
// exit codes above. Every dump that predates them simply lacks the lines, and
// absence is reported as absence, never as an error.
//
//   cos.brief.aborted     the job's own fail-closed stop. Its structured
//                         fields are error_category, outcome="fail_closed" and
//                         (program_items branch only) error_code — there is NO
//                         `reason` key on this line. The table names are in
//                         the message and nowhere else. When a broken run
//                         carries one, it is the FIRST line of the RESULT.
//   cos.brief.written     "(owner id source: X)" — prose-only; the line's
//                         only structured field is outcome="ok".
//   programs.today.read   count=N reason=<owner source>, both structured;
//   programs.today.skipped                     outcome="no_app_user".
//
// ── exit codes ───────────────────────────────────────────────────────────
//
//   0  a complete run, or a precheck skip (both are correct outcomes)
//   1  a broken sequence — the output names the missing or out-of-order step
//   2  the file holds no run at all, printed as "no run in window (not a pass)"
//
// Exit 2 is deliberately NOT 0. "I looked and found nothing" and "I looked and
// it was fine" are different answers, and a window too short to contain the
// event is one of the traps this project has already paid for (II.2). A
// verifier that exits 0 on an empty file is a verifier that reports success
// for a job that never ran.
//
// ── on finding errors ────────────────────────────────────────────────────
//
// `level=error` NEVER appears in Railway output. The logger emits JSON with a
// `level` field, but Railway renders the level as a bracketed tag at the head
// of the line, so a grep for `level=error` matches nothing however broken the
// service is — a silent false negative on the exact search someone reaches for
// first. The discriminating patterns are `[ERROR]`, `[FATAL]` and `FATAL`.
// Every one in the file is reported, not just those inside the run, because an
// error outside the window is still something the reader needs to see.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

// ── parsing ──────────────────────────────────────────────────────────────
//
// A Railway line looks like:
//
//   <ingest-ts> [LEVEL] <message> key="value" key=bareword …
//
// The dump also carries non-log lines ("Starting Container"), which are not
// errors and are skipped.
//
// Two clocks are present and they are not interchangeable. The leading
// <ingest-ts> is Railway's ingestion time; `timestamp="…"` is the service's own
// clock, written by the logger at the moment of the event. Durations are
// measured on the SERVICE clock — ingestion is batched (whole seconds of skew
// are visible in the dumps between the two) and would make a fast run look
// slow. Verified 2026-08-26: Railway's clock is within ~1 s of NTP, so the
// service clock is the trustworthy one.

const LINE_RE = /^(\S+)\s+\[([A-Z]+)\]\s?(.*)$/;

// key="quoted value"  |  key=bareword
const PAIR_RE = /([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|([^\s"]+))/g;

export function parseLine(raw) {
  const m = LINE_RE.exec(raw);
  if (!m) return null;
  const [, ingestTs, level, rest] = m;

  const fields = {};
  let firstPairAt = rest.length;
  PAIR_RE.lastIndex = 0;
  let p;
  while ((p = PAIR_RE.exec(rest)) !== null) {
    const key = p[1];
    const val = p[2] !== undefined ? p[2] : p[3];
    // The message can itself contain `key=value` shapes — budget.check writes
    // "mode=armed tokens=0/750000 …" as prose. Those land in `fields` too and
    // are harmless: nothing below reads a key it did not put there. What must
    // NOT be corrupted is the message boundary, so the message is cut at the
    // first pair that is part of the STRUCTURED tail, and the structured tail
    // is anchored on `timestamp="` — buildLogRecord() always writes it first.
    if (key === 'timestamp' && p[2] !== undefined && firstPairAt === rest.length) {
      firstPairAt = p.index;
    }
    if (!(key in fields)) fields[key] = val;
  }

  return {
    raw,
    ingestTs,
    level,
    message: rest.slice(0, firstPairAt).trim(),
    fields,
    event: fields.event || null,
    correlationId: fields.correlation_id || null,
    // The service clock. Missing on a line the logger did not write.
    ts: fields.timestamp ? Date.parse(fields.timestamp) : NaN,
  };
}

export function parseDump(text) {
  return text.split('\n').map(parseLine).filter(Boolean);
}

// ── locating the run ─────────────────────────────────────────────────────
//
// A run is identified by the correlation_id on its `cos.mode` line. The job
// wraps its whole tick in one correlation context, so every line it produced
// carries the same id and nothing else does.
//
// "Newest" is by the SERVICE clock of the cos.mode line, with file order as
// the tie-break. Not file order alone: a dump concatenated from two windows,
// or one where ingestion reordered a batch, would otherwise pick the wrong run
// and report on yesterday.

export function findLatestRun(lines) {
  let best = null;
  lines.forEach((l, i) => {
    if (l.event !== 'cos.mode' || !l.correlationId) return;
    const key = Number.isNaN(l.ts) ? -Infinity : l.ts;
    if (!best || key > best.key || (key === best.key && i > best.index)) {
      best = { key, index: i, correlationId: l.correlationId };
    }
  });
  if (!best) return null;
  return {
    correlationId: best.correlationId,
    lines: lines.filter((l) => l.correlationId === best.correlationId),
  };
}

// ── the sequence check ───────────────────────────────────────────────────

const HEAD = ['cos.mode', 'cos.delivery.mode'];

// Events that may appear between the head and the terminal branch, any number
// of times, in this relative order. Both are optional.
const OPTIONAL_MIDDLE = ['cos.read.retried', 'cos.email.truncated'];

const LIVE_TAIL = ['cos.compose.ok', 'cos.send.ok', 'cos.brief.written'];
const SKIP_TAIL = ['cos.brief.skipped_precheck'];

/**
 * Check that `required` appear in `events` in that relative order.
 * Returns { ok, missing } — `missing` names the FIRST step not found, which is
 * the one a human needs, rather than a list that restates the same failure.
 */
function inOrder(events, required) {
  let from = 0;
  for (const step of required) {
    const at = events.indexOf(step, from);
    if (at === -1) return { ok: false, missing: step };
    from = at + 1;
  }
  return { ok: true, missing: null };
}

export function checkSequence(runLines) {
  const events = runLines.map((l) => l.event).filter(Boolean);

  const head = inOrder(events, HEAD);
  if (!head.ok) {
    return { ok: false, outcome: 'broken', missing: head.missing, branch: null };
  }

  const skipped = events.includes('cos.brief.skipped_precheck');
  const branch = skipped ? 'precheck_skip' : 'live';
  const tail = skipped ? SKIP_TAIL : LIVE_TAIL;

  const full = inOrder(events, [...HEAD, ...tail]);
  if (!full.ok) {
    return { ok: false, outcome: 'broken', missing: full.missing, branch };
  }

  // The optional middle events, where present, must sit between the head and
  // the tail. A cos.email.truncated AFTER cos.send.ok would mean the selection
  // was reported after the mail went out, which is not a run this verifier
  // should call complete.
  const headEnd = events.indexOf(HEAD[HEAD.length - 1]);
  const tailStart = events.indexOf(tail[0]);
  for (const opt of OPTIONAL_MIDDLE) {
    let at = events.indexOf(opt);
    while (at !== -1) {
      if (at < headEnd || at > tailStart) {
        return { ok: false, outcome: 'broken', missing: opt + ' (out of order)', branch };
      }
      at = events.indexOf(opt, at + 1);
    }
  }

  return { ok: true, outcome: branch, missing: null, branch };
}

// ── field extraction ─────────────────────────────────────────────────────

const first = (lines, event) => lines.find((l) => l.event === event) || null;
const all = (lines, event) => lines.filter((l) => l.event === event);

/**
 * The table a bounded read retry recovered. It is only ever in the message —
 * `cos.read.retried` carries retry_count structurally but not the table name.
 */
export function retriedTables(runLines) {
  return all(runLines, 'cos.read.retried').map((l) => {
    const m = /^CoS (\S+) succeeded on attempt (\d+)/.exec(l.message);
    return {
      table: m ? m[1] : '(unparsed)',
      attempt: m ? Number(m[2]) : null,
      retryCount: l.fields.retry_count !== undefined ? Number(l.fields.retry_count) : null,
    };
  });
}

/**
 * Truncation numbers, structured fields FIRST and the message as a fallback.
 *
 * This is not belt-and-braces, it is a version straddle. `considered`,
 * `eligible_total` and `total_is_floor` are passed to logger.event() by the
 * job but were NOT in the logger's STRUCTURAL_FIELDS allowlist, so every
 * cos.email.truncated line in production to date carries the numbers ONLY in
 * its prose. A verifier that read the structured fields alone would report
 * "truncation: unknown" against every real dump that exists today.
 */
export function truncation(runLines) {
  const l = first(runLines, 'cos.email.truncated');
  if (!l) return null;

  const f = l.fields;
  if (f.considered !== undefined && f.eligible_total !== undefined) {
    return {
      considered: Number(f.considered),
      eligibleTotal: Number(f.eligible_total),
      totalIsFloor: f.total_is_floor === 'true' || f.total_is_floor === true,
      source: 'structured fields',
    };
  }

  // "email selection capped: 20 of 53 eligible messages considered"
  // "email selection capped: 20 of at least 200 eligible messages considered"
  const m = /capped:\s*(\d+)\s+of\s+(at least\s+)?(\d+)/.exec(l.message);
  if (!m) return { considered: null, eligibleTotal: null, totalIsFloor: null, source: 'unparsed' };
  return {
    considered: Number(m[1]),
    eligibleTotal: Number(m[3]),
    totalIsFloor: Boolean(m[2]),
    source: 'message text (the structured fields were dropped by the logger allowlist)',
  };
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/**
 * The job's fail-closed stop, if this run took it.
 *
 * `cos.brief.aborted` has three emit sites in src/jobs/cosDailyBrief.js and
 * NONE of them passes a `reason` field. What the line carries structurally is
 * `error_category` ("config" for an unresolved owner, "db_error" for an
 * unreadable table), `outcome="fail_closed"`, and — on the program_items
 * branch only — `error_code`. The table names are in the MESSAGE and nowhere
 * else: a table name is free-form text, which the logger allowlist keeps out
 * of structured fields on purpose. So the reason comes from the fields and
 * the tables from the prose, matched in the three shapes the job writes:
 *
 *   "CoS tables unreadable (a, b) — …"                      → tables a, b
 *   "program_items unreadable (CODE: detail) — …"           → table program_items
 *   "cannot determine whose brief to compose (SOURCE) — …"  → no table; the owner source
 *
 * The program_items parenthetical is an ERROR, not a table list — splitting
 * it on commas would report "42883: function todays_program_items(uuid" as a
 * table — so that branch names the table from the word before "unreadable"
 * and leaves the parenthetical to the error_code field and the errors section.
 * A message in none of these shapes is reported as its first clause, unparsed,
 * rather than silently as "no table": a shape this code does not know is a
 * fact the reader needs, not one to smooth over.
 */
export function abortedRun(runLines) {
  const l = first(runLines, 'cos.brief.aborted');
  if (!l) return null;
  const msg = l.message || '';
  let m;
  let cause;
  let tables = [];
  let ownerSource = null;
  let parsed = true;
  if ((m = /^CoS tables unreadable \(([^)]*)\)/.exec(msg))) {
    cause = 'CoS tables unreadable';
    tables = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  } else if ((m = /^(\S+) unreadable \(/.exec(msg))) {
    cause = 'table unreadable';
    tables = [m[1]];
  } else if ((m = /^cannot determine whose brief to compose \(([^)]*)\)/.exec(msg))) {
    cause = 'no owner id — refused to read CoS unscoped';
    ownerSource = m[1];
  } else {
    cause = msg ? msg.split(' — ')[0] : '(no message)';
    parsed = false;
  }
  return {
    errorCategory: l.fields.error_category || null,
    outcome: l.fields.outcome || null,
    errorCode: l.fields.error_code || null,
    cause,
    tables,
    ownerSource,
    parsed,
    timestamp: l.fields.timestamp || null,
  };
}

/**
 * Whose id the writeback used, as the written line itself declares it.
 *
 * PROSE-ONLY. writer.js emits
 *   "brief written back to CoS today_briefs (owner id source: X)"
 * with outcome="ok" as its only structured field, so the message is all there
 * is to read. Labels seen in real dumps: derived and derived-cached (August
 * 2026, COS_USER_ID unset) and settings (2026-08-30 → 2026-09-04). That last
 * one was FALSE on every line it appeared on — writer.js stamped 'settings' on
 * any caller-supplied id until 9e9a91d (2026-09-04), and nothing reads
 * user_settings until P1.4 (II.5). The verifier repeats the label and says
 * so; it does not decide for the reader which builds to believe.
 */
export function ownerSource(runLines) {
  const l = first(runLines, 'cos.brief.written');
  if (!l) return null;
  const m = /owner id source:\s*([^)\s]+)\)/.exec(l.message || '');
  return { source: m ? m[1] : null, stated: Boolean(m) };
}

/**
 * The today's-program block (2757813, 2026-09-09): did the run read it, and
 * how many items did today hold?
 *
 * Both numbers are STRUCTURED. `count` and `reason` were already in the
 * logger allowlist when the event was written, so — unlike cos.email.truncated
 * — the line carries them as fields and no prose fallback exists here. `count`
 * is the number of program_items rows returned for today; `reason` is the
 * owner-id source the block resolved ('settings' or 'env'), which is a
 * DIFFERENT lookup from the one on cos.brief.written and can disagree with it.
 *
 * Three shapes, the third being absence:
 *   programs.today.read     outcome=items|none  count=N  reason=<source>
 *   programs.today.skipped  outcome=no_app_user   (the brief continues without the block)
 *   (nothing)               every build before 2757813, or a run that stopped earlier
 */
export function programsBlock(runLines) {
  const read = first(runLines, 'programs.today.read');
  if (read) {
    return {
      event: 'programs.today.read',
      outcome: read.fields.outcome || null,
      count: num(read.fields.count),
      ownerSource: read.fields.reason || null,
    };
  }
  const skipped = first(runLines, 'programs.today.skipped');
  if (skipped) {
    return { event: 'programs.today.skipped', outcome: skipped.fields.outcome || null, count: null, ownerSource: null };
  }
  return null;
}

export function summarize(run) {
  const L = run.lines;
  const mode = first(L, 'cos.mode');
  const delivery = first(L, 'cos.delivery.mode');
  const compose = first(L, 'cos.compose.ok');
  const send = first(L, 'cos.send.ok');
  const written = first(L, 'cos.brief.written');
  const skipped = first(L, 'cos.brief.skipped_precheck');
  const abortedLine = first(L, 'cos.brief.aborted');

  const startTs = mode && !Number.isNaN(mode.ts) ? mode.ts : null;
  // An abort is a terminal line like a writeback or a precheck skip: the run
  // ended there, so the wall time runs to it. send/compose remain the
  // fallbacks for a run that broke without saying why.
  const endLine = written || skipped || abortedLine || send || compose;
  const endTs = endLine && !Number.isNaN(endLine.ts) ? endLine.ts : null;

  return {
    correlationId: run.correlationId,
    modeOutcome: mode ? (mode.fields.outcome || null) : null,
    deliveryOutcome: delivery ? (delivery.fields.outcome || null) : null,
    retried: retriedTables(L),
    truncation: truncation(L),
    compose: compose
      ? {
        latencyMs: num(compose.fields.latency_ms),
        tokens: num(compose.fields.tokens),
        model: compose.fields.model || null,
      }
      : null,
    // Presence and latency are SEPARATE facts and must not be collapsed.
    // cos.send.ok gained latency_ms only in dee339d (2026-08-26); every run
    // before that emits the line with no latency at all. Reporting "no
    // cos.send.ok line" for those would be a false statement about the run —
    // the send happened, the measurement did not exist yet.
    sent: Boolean(send),
    sendLatencyMs: send ? num(send.fields.latency_ms) : null,
    precheckOutcome: skipped ? (skipped.fields.outcome || null) : null,
    // The three September facts. Each is null when its line is absent, and
    // absent is the normal state of every dump written before 2026-09-09.
    aborted: abortedRun(L),
    written: ownerSource(L),
    programs: programsBlock(L),
    startedAt: mode ? mode.fields.timestamp || null : null,
    endedAt: endLine ? endLine.fields.timestamp || null : null,
    endedOn: endLine ? endLine.event : null,
    wallMs: startTs !== null && endTs !== null ? endTs - startTs : null,
    lineCount: L.length,
  };
}

/**
 * Every [ERROR] / [FATAL] line in the WHOLE file, not only the run's.
 *
 * `level=error` can never match Railway output — the level is a bracketed tag,
 * not a field — so matching on the tag is the only thing that works. `FATAL`
 * bare is included because a crash can print it outside the logger's format
 * entirely, which is exactly the case where the structured search fails.
 */
export function errorLines(text) {
  return text.split('\n').filter((l) => /\[ERROR\]|\[FATAL\]|FATAL/.test(l));
}

// ── reporting ────────────────────────────────────────────────────────────

function fmtMs(ms) {
  if (ms === null || Number.isNaN(ms)) return 'unknown';
  return ms >= 1000 ? `${ms} ms (${(ms / 1000).toFixed(2)} s)` : `${ms} ms`;
}

export function report(text, out = console.log) {
  const lines = parseDump(text);
  const run = findLatestRun(lines);

  const errs = errorLines(text);

  if (!run) {
    out('no run in window (not a pass)');
    out('');
    out(`  parsed ${lines.length} log line(s); none carried event="cos.mode".`);
    out('  This is NOT a passing result. It means the window does not contain a');
    out('  cos-daily-brief tick — either the job did not run, or the dump does');
    out('  not reach back far enough to include it. Widen the window before');
    out('  concluding anything from the absence (II.2).');
    reportErrors(errs, out);
    return 2;
  }

  const s = summarize(run);
  const seq = checkSequence(run.lines);

  out(`correlation_id  ${s.correlationId}`);
  out(`run window      ${s.startedAt || '?'} → ${s.endedAt || '?'}  (service clock)`);
  out(`lines in run    ${s.lineCount}`);
  out('');
  out(`mode            ${s.modeOutcome || '(none)'}`);
  out(`delivery        ${s.deliveryOutcome || '(none)'}`);

  if (s.retried.length === 0) {
    out('read retries    none');
  } else {
    const t = s.retried.map((r) => `${r.table}${r.attempt ? ` (attempt ${r.attempt})` : ''}`);
    out(`read retries    ${s.retried.length} — ${t.join(', ')}`);
  }

  if (!s.truncation) {
    out('email selection not truncated');
  } else {
    const tr = s.truncation;
    const floor = tr.totalIsFloor ? 'at least ' : '';
    out(`email selection ${tr.considered} of ${floor}${tr.eligibleTotal} eligible considered`);
    out(`                [numbers read from ${tr.source}]`);
  }

  // The programs block sits here in the job's own order: after the gather and
  // its truncation notice, before the model is paid.
  const pb = s.programs;
  if (!pb) {
    out('programs        (no programs.today.* line on this run — expected on any build before 2757813,');
    out('                or a run that stopped earlier; not an error)');
  } else if (pb.event === 'programs.today.skipped') {
    out(`programs        block skipped — ${pb.outcome || '?'}  (programs.today.skipped; the brief continued without it)`);
  } else {
    const n = pb.count === null ? '? (no count on this line)' : pb.count;
    out(pb.count === 0
      ? `programs        no items today  (programs.today.read count=0, owner id source: ${pb.ownerSource || '?'})`
      : `programs        ${n} item(s) today  (programs.today.read, block: ${pb.outcome || '?'}, owner id source: ${pb.ownerSource || '?'})`);
  }

  if (s.precheckOutcome) {
    out(`precheck        SKIPPED — ${s.precheckOutcome}`);
    out('                the day was already dealt with, so nothing was gathered,');
    out('                composed, billed or sent. This is a correct outcome.');
  }

  if (s.compose) {
    out(`compose         ${fmtMs(s.compose.latencyMs)}  ·  ${s.compose.tokens ?? '?'} tokens  ·  ${s.compose.model || '?'}`);
  } else if (!s.precheckOutcome) {
    out('compose         (no cos.compose.ok line)');
  }

  if (s.sent) {
    out(s.sendLatencyMs !== null
      ? `send            ${fmtMs(s.sendLatencyMs)}`
      : 'send            ok — no latency_ms on this line (a build before dee339d)');
  } else if (!s.precheckOutcome) {
    out('send            (no cos.send.ok line)');
  }

  if (s.written) {
    if (!s.written.stated) {
      out('written         ok — owner id source not stated on this line');
    } else {
      out(`written         ok — owner id source: ${s.written.source}`);
      if (s.written.source === 'settings') {
        out('                [the label as the job printed it; until 9e9a91d (2026-09-04) it was stamped');
        out('                on any caller-supplied id, and nothing reads user_settings before P1.4 — II.5]');
      }
    }
  } else if (!s.precheckOutcome) {
    out('written         (no cos.brief.written line)');
  }

  out(`wall time       ${fmtMs(s.wallMs)}${s.endedOn ? `  (cos.mode → ${s.endedOn})` : ''}`);
  out('');

  if (seq.ok) {
    out(seq.outcome === 'precheck_skip'
      ? 'RESULT: complete — precheck skip (nothing was owed today)'
      : 'RESULT: complete run');
  } else if (s.aborted) {
    // The job stopped ITSELF, and said why. That is the first thing the
    // reader needs — the missing step is a consequence of it, not the cause,
    // so it comes second. The exit code is unchanged: the brief did not
    // complete, and 1 is what that has always meant.
    out(`RESULT: BROKEN SEQUENCE — ${fmtAborted(s.aborted)}`);
    out(`        missing step: ${seq.missing} — the job stopped itself at cos.brief.aborted; read that line first`);
    out('');
    out('  events seen, in order:');
    for (const l of run.lines) if (l.event) out(`    ${l.event}`);
  } else {
    out(`RESULT: BROKEN SEQUENCE — missing step: ${seq.missing}`);
    out('');
    out('  events seen, in order:');
    for (const l of run.lines) if (l.event) out(`    ${l.event}`);
  }

  reportErrors(errs, out);
  return seq.ok ? 0 : 1;
}

/**
 * One line: what the abort line carries, in the field names it carries it
 * under, then the table(s) it names. Field names are printed literally
 * (error_category=…, not "reason: …") so nothing here claims a key the line
 * does not have.
 */
function fmtAborted(a) {
  const fields = [
    `error_category=${a.errorCategory || '(none)'}`,
    a.outcome ? `outcome=${a.outcome}` : null,
    a.errorCode ? `error_code=${a.errorCode}` : null,
  ].filter(Boolean).join(' ');
  let what;
  if (a.tables.length) what = `${a.cause}: ${a.tables.join(', ')}`;
  else if (a.ownerSource) what = `${a.cause} (owner source: ${a.ownerSource}); no table named`;
  else what = `${a.cause}; no table named${a.parsed ? '' : ' (message shape not recognised — read the errors section)'}`;
  return `ABORTED (cos.brief.aborted) — ${fields} — ${what}`;
}

function reportErrors(errs, out) {
  out('');
  if (errs.length === 0) {
    out('errors          none  ([ERROR] / [FATAL] across the whole file)');
    out('                note: `level=error` cannot match Railway output — the');
    out('                level is rendered as a [LEVEL] tag, not a field.');
    return;
  }
  out(`errors          ${errs.length} line(s) matching [ERROR] / [FATAL]:`);
  for (const l of errs) out(`  ${l}`);
}

// ── entry point ──────────────────────────────────────────────────────────

function main(argv) {
  const path = argv[2];
  if (!path) {
    console.error('usage: node scripts/verify-brief-run.mjs <path-to-railway-log-dump>');
    return 64; // EX_USAGE
  }
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`cannot read ${path}: ${err.message}`);
    return 66; // EX_NOINPUT
  }
  return report(text);
}

// Only run when invoked directly, so the suite can import the pure functions.
if (process.argv[1] && process.argv[1].endsWith('verify-brief-run.mjs')) {
  process.exit(main(process.argv));
}
