// In-memory doubles for the fact-pipeline tests. Concatenated BEFORE the
// import/export-stripped src files by run-tests.sh. Runs under jsc or node.

const println = typeof print === 'function' ? print : console.log; // jsc has print(), node has console.log

const __db = { facts: [] };
let __idSeq = 100;
const __calls = { setRelationship: [], linkMessagePerson: [], logContact: [] };

// Minimal thenable query-builder covering exactly what memory.js/persist.js use:
// from().update().eq()/.in() chains, and from().insert().
function __from(table) {
  if (!__db[table]) __db[table] = [];
  return {
    update(payload) {
      const filters = [];
      const b = {
        eq(field, val) { filters.push((r) => r[field] === val); return b; },
        in(field, arr) { filters.push((r) => arr.includes(r[field])); return b; },
        then(resolve) {
          const rows = __db[table].filter((r) => filters.every((fn) => fn(r)));
          for (const r of rows) Object.assign(r, payload);
          resolve({ data: rows, error: null });
        },
      };
      return b;
    },
    insert(row) {
      return {
        then(resolve) {
          __db[table].push(Object.assign({ id: __idSeq++, is_current: true }, row));
          resolve({ error: null });
        },
      };
    },
  };
}
const supabase = { from: __from };

// time utils used by memory.js (goals only; not exercised here)
const mondayOf = () => '2026-07-06';
const localWeekOf = () => '2026-07-06';

// services persist.js touches besides memory
const logger = { info: () => {}, warn: (...a) => println('    [warn] ' + a.join(' ')), error: () => {} };
const rel = {
  linkMessagePerson: async (args) => { __calls.linkMessagePerson.push(args); },
  logContact: async (args) => { __calls.logContact.push(args); },
  resolvePendingPrompt: async () => false,
};
const users = { incrementShowingUp: async () => {} };
const peopleService = {
  rename: async () => {},
  setRelationship: async (personId, relationship) => { __calls.setRelationship.push([personId, relationship]); },
};
