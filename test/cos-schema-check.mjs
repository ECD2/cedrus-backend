// CoS reader/schema conformance — every column the reader asks for must exist.
// Run: bun test/cos-schema-check.mjs   (or via test/run-all.sh)
//
// WHY THIS EXISTS
// On 2026-08-20 the reader asked CoS for `agent_runs.report_body`. CoS's column
// is `original_body`. Every read of that table failed with 42703 the first time
// rung 1 ran against production — and the whole battery was green at the time.
//
// It could not have been otherwise. The reader requested report_body, the
// composer read r.report_body, and the FIXTURE supplied report_body. All three
// were written from the same reading of CoS, so all three agreed with each
// other and all three were wrong. That is Lesson 4 — a test encoding a
// falsified belief, which never expires on its own. No test written from the
// same assumption as the code can catch it.
//
// The only thing that can is a comparison against the real schema. That is this
// stage. It reads PostgREST's own OpenAPI document, which the CoS project
// serves at GET /rest/v1/, and checks READER_COLUMNS against it.
//
// SKIPPED IS ANNOUNCED, NEVER SILENT (Lesson 7)
// Without COS_ credentials this cannot run. It says so loudly and exits 0 — a
// skip that printed nothing would be indistinguishable from a pass, which is
// the exact disease this file exists to treat. It also refuses to "pass" on an
// empty or unparseable schema document.

const REPO = new URL('..', import.meta.url).pathname;
const { READER_COLUMNS } = await import(REPO + 'src/services/cos/reader.js');

let failures = 0;
const p = (...a) => console.log(...a);
const ok = (name, cond, detail) => {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
};

p('=== CoS reader/schema conformance ===');

const url = (process.env.COS_SUPABASE_URL || '').trim();
const key = (process.env.COS_SERVICE_ROLE_KEY || '').trim();

if (!url || !key) {
  p('');
  p('  SKIPPED — COS_SUPABASE_URL / COS_SERVICE_ROLE_KEY are not in this environment.');
  p('  This stage did NOT run. It is the ONLY check that can catch a reader/schema');
  p('  mismatch; the rest of the battery passes happily while one exists.');
  p('');
  p('  To run it:  railway run bun test/cos-schema-check.mjs');
  p('');
  p('COS SCHEMA CHECK SKIPPED (not a pass)');
  process.exit(0);
}

// PostgREST serves its own OpenAPI description at the API root.
let doc;
try {
  const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/', {
    headers: { apikey: key, Accept: 'application/openapi+json' },
  });
  if (!res.ok) {
    ok('fetched the OpenAPI schema document', false, 'HTTP ' + res.status);
    p(''); p(failures + ' CHECK(S) FAILED'); process.exit(1);
  }
  doc = await res.json();
} catch (err) {
  ok('fetched the OpenAPI schema document', false, String(err && err.message));
  p(''); p(failures + ' CHECK(S) FAILED'); process.exit(1);
}
ok('fetched the OpenAPI schema document', true);

// A document we cannot read must never read as a pass. If definitions are
// missing or empty, every table below would "have no missing columns" purely
// because there was nothing to compare against.
const defs = (doc && doc.definitions) || {};
const defCount = Object.keys(defs).length;
ok('the schema document describes at least one table', defCount > 0, defCount);
if (defCount === 0) { p(''); p(failures + ' CHECK(S) FAILED'); process.exit(1); }

let checked = 0;
for (const [table, columns] of Object.entries(READER_COLUMNS)) {
  const def = defs[table];
  if (!def || !def.properties) {
    ok(`${table}: present in the schema`, false, 'table not found in the OpenAPI document');
    continue;
  }
  const actual = new Set(Object.keys(def.properties));
  const missing = columns.filter((c) => !actual.has(c));
  checked += columns.length;
  ok(`${table}: all ${columns.length} requested columns exist`, missing.length === 0,
    missing.length ? { missing, table_has: [...actual].slice(0, 14) } : undefined);
}

// The count is itself a control: a run that compared zero columns is a failure,
// not a clean bill of health.
ok('compared a non-zero number of columns', checked > 0, checked);
p('');
p(`  compared ${checked} column names across ${Object.keys(READER_COLUMNS).length} tables`);

if (failures === 0) p('ALL COS SCHEMA CHECKS PASSED');
else { p(failures + ' CHECK(S) FAILED'); process.exit(1); }
