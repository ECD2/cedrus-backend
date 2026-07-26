// Doubles for Bundle 21 (quota reads + the fail-open rate limiter).
// Concatenated BEFORE the import/export-stripped src files by run-tests.sh.
//
// Not reliability-core.js, for the same reason Bundle 20 needed its own: that
// fake Supabase always resolves { error: null } and can never fail, and the
// failure branch is the entire subject here. This one is TABLE-AWARE because
// usage.js reads two different views and the suite drives them independently.

const println = typeof print === 'function' ? print : console.log; // jsc: print(); node/bun: console.log

// ── Programmable, table-aware Supabase seam ─────────────────────────────────
// Covers the chain usage.js uses: from(view).select('*').eq('user_id', id).maybeSingle()
let __outcomes = {};

function __setTable(table, outcome) { __outcomes[table] = outcome; }

const supabase = {
  from(table) {
    const api = {
      select() { return api; },
      eq() { return api; },
      insert() { return api; },
      async maybeSingle() {
        const o = __outcomes[table];
        if (!o) return { data: null, error: null };
        return { data: o.data || null, error: o.error || null };
      },
    };
    return api;
  },
};

// ── Recording logger ────────────────────────────────────────────────────────
// usage.js now uses the STRUCTURED lane (logger.event), not the free-text one,
// so the quota failure is greppable and alertable rather than prose in a warn.
let __events = [];
const logger = {
  event: (name, fields) => { __events.push({ name: name, fields: fields || {} }); return name; },
  info: () => {},
  warn: () => {},
  error: () => {},
};

// Reset both seams between cases so a leaked event can never pass as a fresh one.
function __reset() { __events = []; __outcomes = {}; }

// Convenience: the single event's flattened text, for substring assertions.
function __eventText(i) {
  const e = __events[i];
  if (!e) return '';
  return e.name + ' ' + JSON.stringify(e.fields);
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
