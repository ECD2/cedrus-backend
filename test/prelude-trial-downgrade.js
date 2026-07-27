// Doubles for Bundle 26 (trial-downgrade silent-failure reporting).
// Concatenated BEFORE the import/export-stripped src/jobs/trialDowngrade.js.
//
// Per-OPERATION outcomes, not per-table: the job hits `app_users` twice in one
// run — a select (the expired-trial scan) then an update per user — and the
// whole point is failing one while the other succeeds. Also needs .lt(), which
// the other preludes don't carry.
//
// Records logger.info as well as logger.event, because the summary line is
// itself part of what regressed: it used to count rows FOUND, not rows CHANGED.

const println = typeof print === 'function' ? print : console.log; // jsc: print(); node/bun: console.log

let __outcomes = {};   // "table.op" -> { error } | { rows }   (missing = empty success)
let __updates = [];    // payloads that actually landed

function __setOp(key, outcome) { __outcomes[key] = outcome; }

const supabase = {
  from(table) {
    const st = { table: table, op: 'select', payload: null };
    const settle = () => {
      const o = __outcomes[st.table + '.' + st.op];
      if (o && o.error) return { data: null, error: o.error };
      if (st.op === 'update') __updates.push(st.payload);
      return { data: (o && o.rows) || [], error: null };
    };
    const api = {
      select() { return api; },
      update(p) { st.op = 'update'; st.payload = p; return api; },
      eq() { return api; },
      lt() { return api; },
      then(res, rej) { return Promise.resolve(settle()).then(res, rej); },
    };
    return api;
  },
};

let __events = [];
let __infos = [];
const logger = {
  event: (name, fields) => { __events.push({ name: name, fields: fields || {} }); return name; },
  info: (...a) => { __infos.push(a.map((x) => String(x)).join(' ')); },
  warn: () => {}, error: () => {},
};

function __reset() { __events = []; __infos = []; __outcomes = {}; __updates = []; }
function __eventText(i) {
  const e = __events[i];
  return e ? e.name + ' ' + JSON.stringify(e.fields) : '';
}
const __names = () => __events.map((e) => e.name);

function makeChecker() {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) println('  PASS  ' + name);
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  return { check, done: () => failures };
}
