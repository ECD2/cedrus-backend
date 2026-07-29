// Doubles for Bundle 31 (card rail failure honesty). Concatenated BEFORE the
// stripped src/services/cards.js ONLY. A programmable per-table seam
// (prelude-suppression.js lineage): the point is DB failures — refused
// inserts, failed updates, unreadable selects — which reliability-core's
// always-succeeding fake cannot produce.
//
// Outcome keys: '<table>' (select), '<table>:insert', '<table>:update'.

const println = typeof print === 'function' ? print : console.log;

let __outcomes = {};
let __throws = {};
let __inserts = [];   // { table, row }
let __updates = [];   // { table, patch }
let __events = [];

function __setOutcome(key, outcome) { __outcomes[key] = outcome; }
function __setThrow(table, err) { __throws[table] = err; }
function __resetFail() { __outcomes = {}; __throws = {}; __inserts = []; __updates = []; __events = []; }
const __eventsNamed = (n) => __events.filter((e) => e.name === n);

const supabase = {
  from(table) {
    const api = {
      _op: 'select',
      select() { return api; },
      eq() { return api; },
      in() { return api; },
      not() { return api; },
      insert(row) { api._op = 'insert'; __inserts.push({ table, row }); return api; },
      update(patch) { api._op = 'update'; __updates.push({ table, patch }); return api; },
      async single() { return terminal(); },
      async maybeSingle() { return terminal(); },
      then(resolve, reject) { return Promise.resolve().then(terminal).then(resolve, reject); },
    };
    function terminal() {
      if (__throws[table]) throw __throws[table];
      const key = api._op === 'select' ? table : table + ':' + api._op;
      const o = __outcomes[key] !== undefined ? __outcomes[key] : __outcomes[table];
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

let __contactLogs = [];
const rel = { logContact: async (args) => { __contactLogs.push(args); } };

function makeChecker() {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) println('  PASS  ' + name);
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  return { check, done: () => failures };
}
