// Doubles for Bundle 23 (relationships write-path logging).
// Concatenated BEFORE the import/export-stripped src/services/relationships.js.
//
// Table-aware and THENABLE: relationships.js awaits the builder directly
// (`await supabase.from(t).insert({...})`) rather than calling a .maybeSingle()
// terminal, so the fake has to resolve as a promise itself.
//
// Not reliability-core.js: its fake always resolves { error: null } and can
// never fail, and the failure branch is the whole subject here.

const println = typeof print === 'function' ? print : console.log; // jsc: print(); node/bun: console.log

// ── Programmable, table-aware Supabase seam ─────────────────────────────────
let __outcomes = {};      // table -> { error } | undefined  (undefined = success)
let __writes = [];        // { table, op, payload } — proves the happy path really wrote

function __setTable(table, outcome) { __outcomes[table] = outcome; }

const supabase = {
  from(table) {
    const st = { table: table, op: null, payload: null };
    const settle = () => {
      const o = __outcomes[table];
      if (o && o.error) return { data: null, error: o.error };
      __writes.push({ table: st.table, op: st.op, payload: st.payload });
      return { data: [st.payload], error: null };
    };
    const api = {
      insert(p) { st.op = 'insert'; st.payload = p; return api; },
      upsert(p) { st.op = 'upsert'; st.payload = p; return api; },
      update(p) { st.op = 'update'; st.payload = p; return api; },
      select() { return api; },
      eq() { return api; },
      then(res, rej) { return Promise.resolve(settle()).then(res, rej); },
    };
    return api;
  },
};

// ── Recording logger (structured lane) ──────────────────────────────────────
let __events = [];
const logger = {
  event: (name, fields) => { __events.push({ name: name, fields: fields || {} }); return name; },
  info: () => {}, warn: () => {}, error: () => {},
};

function __reset() {
  __events = []; __outcomes = {}; __writes = [];
  // Bundle 25 declares __optOutCalls before this file's consumers run.
  if (typeof __optOutCalls !== 'undefined') __optOutCalls.length = 0;
}
function __eventText(i) {
  const e = __events[i];
  return e ? e.name + ' ' + JSON.stringify(e.fields) : '';
}

// ── Assertion harness (same shape as test/reliability-core.js) ──────────────
function makeChecker() {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) println('  PASS  ' + name);
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  return { check, done: () => failures };
}
