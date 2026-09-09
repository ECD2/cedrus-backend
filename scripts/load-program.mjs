#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────
// load-program — compile a program source and, only with --commit, publish
// it as ONE revision through publish_program_revision().
//
//   bun scripts/load-program.mjs <source-path> --user-id <app_users.id> [options]
//
//   --commit              actually write. WITHOUT IT NOTHING IS WRITTEN and
//                         no database client is even constructed.
//   --start YYYY-MM-DD    a dateless routine's first day (ignored for training)
//   --horizon-days N      how many days to materialise a routine over (28)
//
// DRY RUN BY DEFAULT. The dry run compiles the source, prints the full dated
// table, the per-category counts, and the derived day count next to the row
// count, and says where the dates came from. It needs no environment: the
// service-role client is imported only on the --commit path.
//
// THE DAY COUNT IS DERIVED, NEVER HARDCODED. See compile.js.
//
// IDEMPOTENT BY THE DATABASE. --commit on a source already published for
// this program is refused by the UNIQUE (program_id, source_sha256)
// constraint with 23505; this script reports that and exits 0 with nothing
// written. There is no pre-check here: the constraint is the authority.
//
// Exit codes: 0 compiled (and published, or already published); 1 the source
// did not compile, or --commit failed for any other reason. Nothing is
// half-written in either case — the function is one transaction.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { compileSource, renderReport } from '../src/services/programs/compile.js';

function usage(msg) {
  if (msg) console.error(`load-program: ${msg}\n`);
  console.error('usage: bun scripts/load-program.mjs <source-path> --user-id <uuid> [--start YYYY-MM-DD] [--horizon-days N] [--commit]');
  process.exit(1);
}

export function parseArgs(argv) {
  const out = { path: null, userId: null, start: null, horizonDays: null, commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit') out.commit = true;
    else if (a === '--user-id') out.userId = argv[++i] ?? null;
    else if (a === '--start') out.start = argv[++i] ?? null;
    else if (a === '--horizon-days') out.horizonDays = Number(argv[++i]);
    else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else if (out.path === null) out.path = a;
    else usage(`unexpected argument ${a}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.path) usage('a source PATH is required (no default, no ~/Downloads)');
  const path = resolve(args.path);
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { usage(`cannot read ${path}: ${e.message}`); }

  let compiled;
  try {
    compiled = compileSource(text, { sourceName: basename(path), start: args.start, horizonDays: args.horizonDays });
  } catch (e) {
    console.error(`load-program: the source did not compile — ${e.message}`);
    process.exit(1);
  }

  const mode = args.commit ? 'COMMIT' : 'DRY RUN';
  console.log(`=== load-program — ${mode} ===`);
  console.log(`file      ${path}`);
  console.log(`owner     ${args.userId || '(none given — required for --commit)'}`);
  for (const line of renderReport(compiled)) console.log(line);
  console.log('');

  if (!args.commit) {
    console.log('DRY RUN — nothing written. Re-run with --commit to publish this as one revision.');
    process.exit(0);
  }
  if (!args.userId) usage('--user-id is required with --commit');

  // The client is constructed HERE and only here: config.js requires the
  // service key at import, so a dry run never needs it.
  const { publishProgramRevision } = await import('../src/services/programs/publish.js');
  try {
    const r = await publishProgramRevision(compiled, { userId: args.userId });
    console.log(`PUBLISHED revision ${r.revision_number} of "${compiled.program.title}"`);
    console.log(`  program_id             ${r.program_id}`);
    console.log(`  revision_id            ${r.revision_id}`);
    console.log(`  supersedes_revision_id ${r.supersedes_revision_id || '(none — first revision)'}`);
    console.log(`  source_sha256          ${r.source_sha256}`);
    console.log(`  items                  ${r.items}`);
    process.exit(0);
  } catch (e) {
    if (e.alreadyPublished) {
      console.log(`ALREADY PUBLISHED — ${e.message}`);
      console.log('Nothing written. The UNIQUE (program_id, source_sha256) constraint refused a second copy of this exact source.');
      process.exit(0);
    }
    console.error(`load-program: --commit FAILED (${e.code || 'no SQLSTATE'}): ${e.message}`);
    console.error('Nothing written — publish_program_revision is one transaction.');
    process.exit(1);
  }
}

if (import.meta.main) main();
