// Doubles for Bundle 20 (§6 suppression read). Concatenated BEFORE the
// import/export-stripped src/services/safetyFlags.js by run-tests.sh.
//
// Why this file exists instead of reusing test/reliability-core.js: that fake
// Supabase is a working in-memory database — it always resolves { error: null }
// and can never throw. The whole point of this suite is the branches where the
// query FAILS, so the seam has to be programmable rather than functional.
// Bundle 16 sets the precedent for a bundle declaring its own doubles.

const println = typeof print === 'function' ? print : console.log; // jsc: print(); node/bun: console.log

// ── Programmable Supabase seam ──────────────────────────────────────────────
// Covers exactly the chain isInSuppressionWindow uses:
//   supabase.from(t).select(cols).eq(f, v).maybeSingle()
let __outcome = { data: null, error: null };
let __throwErr = null;

function __setOutcome(o) { __outcome = o; __throwErr = null; }
function __setThrow(err) { __throwErr = err; }

const supabase = {
  from() {
    const api = {
      select() { return api; },
      eq() { return api; },
      async maybeSingle() {
        if (__throwErr) throw __throwErr;
        return __outcome;
      },
    };
    return api;
  },
};

// ── Recording logger ────────────────────────────────────────────────────────
// Only .warn is asserted on; the others exist so the module under test can call
// them freely without the doubles becoming the thing that fails.
let __logs = [];
const logger = {
  warn: (...a) => { __logs.push(a.map((x) => String(x)).join(' ')); },
  info: () => {},
  error: () => {},
  event: () => {},
};

function __resetLogs() { __logs = []; }

// Reset both seams between cases so a leaked log can never pass as a fresh one.
function __reset() { __resetLogs(); __outcome = { data: null, error: null }; __throwErr = null; }

// ── Assertion harness (same shape as test/reliability-core.js) ──────────────
function makeChecker() {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) println('  PASS  ' + name);
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  return { check, done: () => failures };
}
