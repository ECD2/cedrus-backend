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
// Other events may be interleaved and are not errors — cos.owner.derived sits
// between cos.send.ok and cos.brief.written on every real run in the dumps.
// The check is on the RELATIVE ORDER of the required events, not on adjacency,
// because pinning adjacency would make the verifier fail the moment the job
// logs one more line.
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

export function summarize(run) {
  const L = run.lines;
  const mode = first(L, 'cos.mode');
  const delivery = first(L, 'cos.delivery.mode');
  const compose = first(L, 'cos.compose.ok');
  const send = first(L, 'cos.send.ok');
  const written = first(L, 'cos.brief.written');
  const skipped = first(L, 'cos.brief.skipped_precheck');

  const startTs = mode && !Number.isNaN(mode.ts) ? mode.ts : null;
  const endLine = written || skipped || send || compose;
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

  out(`wall time       ${fmtMs(s.wallMs)}${s.endedOn ? `  (cos.mode → ${s.endedOn})` : ''}`);
  out('');

  if (seq.ok) {
    out(seq.outcome === 'precheck_skip'
      ? 'RESULT: complete — precheck skip (nothing was owed today)'
      : 'RESULT: complete run');
  } else {
    out(`RESULT: BROKEN SEQUENCE — missing step: ${seq.missing}`);
    out('');
    out('  events seen, in order:');
    for (const l of run.lines) if (l.event) out(`    ${l.event}`);
  }

  reportErrors(errs, out);
  return seq.ok ? 0 : 1;
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
