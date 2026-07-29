// Doubles for Bundle 28 (budget guard). Concatenated BEFORE the stripped
// src/services/budget.js + src/jobs/budgetGuard.js.
//
// A PROGRAMMABLE per-table seam (prelude-suppression.js lineage): the suite's
// whole point is failure branches — view unreadable, upsert refused, client
// throw — which reliability-core.js's always-succeeding fake cannot drive.
// Outcomes are keyed by table, with an optional '<table>:upsert' override so a
// test can fail the system_flags WRITE while its READ succeeds.

const println = typeof print === 'function' ? print : console.log;

let __outcomes = {};   // table (or 'table:upsert') -> { data, error } | fn(op)
let __throws = {};     // table -> Error thrown at the terminal
let __upserts = [];    // recorded { table, row, options }
let __events = [];     // recorded logger.event calls { name, fields }

function __setOutcome(table, outcome) { __outcomes[table] = outcome; }
function __setThrow(table, err) { __throws[table] = err; }
function __resetBudget() { __outcomes = {}; __throws = {}; __upserts = []; __events = []; }
const __eventsNamed = (n) => __events.filter((e) => e.name === n);
const __lastUpsert = () => (__upserts.length ? __upserts[__upserts.length - 1] : null);

const supabase = {
  from(table) {
    const api = {
      _op: 'select',
      select() { return api; },
      gte() { return api; },
      eq() { return api; },
      upsert(row, options) { api._op = 'upsert'; __upserts.push({ table, row, options }); return api; },
      async maybeSingle() { return terminal(); },
      then(resolve, reject) { return Promise.resolve().then(terminal).then(resolve, reject); },
    };
    function terminal() {
      if (__throws[table]) throw __throws[table];
      const o = (api._op === 'upsert' && __outcomes[table + ':upsert'] !== undefined)
        ? __outcomes[table + ':upsert']
        : __outcomes[table];
      if (o === undefined) return { data: null, error: null };
      return typeof o === 'function' ? o(api._op) : o;
    }
    return api;
  },
};

const logger = {
  info() {}, warn() {}, error() {},
  event(name, fields) { __events.push({ name, fields: fields || {} }); return name; },
  addContext() {}, runWithContext: (_s, fn) => fn(),
};

// budgetGuard.js reads these at call time; tests mutate between cases.
const config = { dailyTokenBudget: null, dailySmsBudget: null };

// ── Assertion harness (same shape as test/reliability-core.js) ──────────────
function makeChecker() {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) println('  PASS  ' + name);
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  return { check, done: () => failures };
}
