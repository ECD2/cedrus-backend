// Shared in-memory doubles for the WS-A reliability/security proof tests.
// Concatenated BEFORE the import/export-stripped src files by run-tests.sh
// (same technique as stubs.js). Runs under jsc or node/bun.
//
// Provides a mock Supabase query-builder covering exactly the chains the files
// under test use: select/insert/update/upsert/delete with eq/lte/lt/gt/in/not/
// order/limit and single()/maybeSingle()/select()/head-count terminals.

const println = typeof print === 'function' ? print : console.log; // jsc: print(); node/bun: console.log

const __db = {};
let __idSeq = 1000;

function __reset() { for (const k of Object.keys(__db)) delete __db[k]; }
function __seed(table, rows) { __db[table] = rows.map((r) => ({ ...r })); }
function __rows(table) { return __db[table] || []; }

function __query(table) {
  if (!__db[table]) __db[table] = [];
  const st = { table, op: 'select', payload: null, filters: [], selected: false, countHead: false, single: false, maybe: false, upsertOpts: null };
  const match = (r) => st.filters.every((fn) => fn(r));
  const rows = () => __db[table].filter(match);

  function exec() {
    return new Promise((resolve) => {
      if (st.op === 'insert') {
        const row = Object.assign({ id: 'id_' + (++__idSeq) }, st.payload);
        __db[table].push(row);
        return resolve({ data: st.single ? row : [row], error: null });
      }
      if (st.op === 'upsert') {
        const keys = (st.upsertOpts && st.upsertOpts.onConflict ? st.upsertOpts.onConflict.split(',') : []).map((s) => s.trim());
        let existing = null;
        if (keys.length) existing = __db[table].find((r) => keys.every((k) => r[k] === st.payload[k]));
        if (existing) { Object.assign(existing, st.payload); return resolve({ data: st.single ? existing : [existing], error: null }); }
        const row = Object.assign({ id: 'id_' + (++__idSeq) }, st.payload);
        __db[table].push(row);
        return resolve({ data: st.single ? row : [row], error: null });
      }
      if (st.op === 'update') {
        const rs = rows();
        for (const r of rs) Object.assign(r, st.payload);
        return resolve({ data: rs, error: null });
      }
      if (st.op === 'delete') {
        __db[table] = __db[table].filter((r) => !match(r));
        return resolve({ data: null, error: null });
      }
      // select
      if (st.countHead) return resolve({ count: rows().length, error: null });
      const rs = rows();
      if (st.single || st.maybe) return resolve({ data: rs[0] || null, error: null });
      return resolve({ data: rs, error: null });
    });
  }

  const api = {
    select(_cols, opts) { st.selected = true; if (opts && opts.head && opts.count) st.countHead = true; return api; },
    insert(row) { st.op = 'insert'; st.payload = row; return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; },
    upsert(row, opts) { st.op = 'upsert'; st.payload = row; st.upsertOpts = opts || null; return api; },
    delete() { st.op = 'delete'; return api; },
    eq(f, v) { st.filters.push((r) => r[f] === v); return api; },
    lte(f, v) { st.filters.push((r) => r[f] <= v); return api; },
    lt(f, v) { st.filters.push((r) => r[f] < v); return api; },
    gt(f, v) { st.filters.push((r) => r[f] > v); return api; },
    in(f, arr) { st.filters.push((r) => arr.includes(r[f])); return api; },
    not(f, _op, _v) { st.filters.push((r) => r[f] != null); return api; },
    order() { return api; },
    limit(n) { st.limit = n; return api; },
    single() { st.single = true; return exec(); },
    maybeSingle() { st.maybe = true; return exec(); },
    then(res, rej) { return exec().then(res, rej); },
  };
  return api;
}

const supabase = { from: __query };

// A tiny assertion harness shared by every reliability test file.
function makeChecker() {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) println('  PASS  ' + name);
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  return { check, done: () => failures };
}
