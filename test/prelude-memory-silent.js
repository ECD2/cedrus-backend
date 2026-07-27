// Doubles for Bundle 24 (memory.js silent-failure reporting).
// Concatenated BEFORE the stripped src/utils/time.js + src/services/memory.js.
//
// Thenable and table-aware: memory.js awaits builders directly. Per-OPERATION
// outcomes (not just per-table) because addFact hits `facts` twice in one call —
// an update (supersession) then an insert — and the whole point of section 1 is
// failing the first while the second succeeds.

const println = typeof print === 'function' ? print : console.log; // jsc: print(); node/bun: console.log

let __outcomes = {};   // "table.op" -> { error } | { rows }   (missing = empty success)
let __ops = [];        // ordered { table, op } trace — proves what actually ran

function __setOp(key, outcome) { __outcomes[key] = outcome; }

const supabase = {
  from(table) {
    const st = { table: table, op: 'select', payload: null };
    const settle = () => {
      __ops.push({ table: st.table, op: st.op });
      const o = __outcomes[st.table + '.' + st.op];
      if (o && o.error) return { data: null, error: o.error };
      return { data: (o && o.rows) || [], error: null };
    };
    const api = {
      select() { return api; },
      insert(p) { st.op = 'insert'; st.payload = p; return api; },
      update(p) { st.op = 'update'; st.payload = p; return api; },
      eq() { return api; },
      in() { return api; },
      order() { return api; },
      limit() { return api; },
      then(res, rej) { return Promise.resolve(settle()).then(res, rej); },
    };
    return api;
  },
};

let __events = [];
const logger = {
  event: (name, fields) => { __events.push({ name: name, fields: fields || {} }); return name; },
  info: () => {}, warn: () => {}, error: () => {},
};

function __reset() { __events = []; __outcomes = {}; __ops = []; }
function __eventText(i) {
  const e = __events[i];
  return e ? e.name + ' ' + JSON.stringify(e.fields) : '';
}
const __ran = (table, op) => __ops.some((x) => x.table === table && x.op === op);

function makeChecker() {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) println('  PASS  ' + name);
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  return { check, done: () => failures };
}
