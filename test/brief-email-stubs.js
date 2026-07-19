// Self-contained doubles for the N2 weekly-note EMAIL job bundle
// (test/run-n2-brief-email.sh). Deliberately NOT layered on
// reliability-core.js: this bundle needs a mock query builder with .is()/.neq()
// and update-returning-select, and redefining `supabase` across two concatenated
// preludes would collide. Same spirit, richer chains.
//
// Provides: println/makeChecker/__db/__seed/__reset, a supabase double, fakes
// for logger/time/briefs service/gather/select/safetyFlags, node:crypto and
// node:fs/node:path substitutes for the stripped brief service files, and call
// recorders (__calls, __consentEvents, __userWrites) for order/consent proofs.

const println = typeof print === 'function' ? print : console.log;

const __db = {};
let __idSeq = 5000;
const __calls = [];
// Never cleared by __reset: every write to app_users across the whole bundle
// lands here, so the never-auto-subscribe proof covers every scenario.
const __userWrites = [];

function __reset() {
  for (const k of Object.keys(__db)) delete __db[k];
  __calls.length = 0;
  for (const k of Object.keys(fs.__files)) delete fs.__files[k];
}
function __seed(table, rows) { __db[table] = rows.map((r) => ({ ...r })); }

function __query(table) {
  if (!__db[table]) __db[table] = [];
  const st = { op: 'select', payload: null, filters: [], single: false, maybe: false, selectAfter: false, upsertOpts: null };
  const match = (r) => st.filters.every((fn) => fn(r));
  const rows = () => __db[table].filter(match);

  function exec() {
    return new Promise((resolve) => {
      if (table === 'app_users' && st.op !== 'select') __userWrites.push(`${st.op}:app_users`);
      if (st.op === 'insert') {
        // Emulate the two live UNIQUE constraints the job code must respect.
        if (table === 'brief_deliveries') {
          const dup = __db[table].find((r) => r.brief_id === st.payload.brief_id && r.channel === st.payload.channel);
          if (dup) return resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "brief_deliveries_brief_channel_uniq"' } });
        }
        if (table === 'brief_action_tokens') {
          const dup = __db[table].find((r) => r.token_hash === st.payload.token_hash);
          if (dup) return resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "brief_action_tokens_hash_uniq"' } });
        }
        const row = Object.assign({ id: 'id_' + (++__idSeq) }, st.payload);
        __db[table].push(row);
        __calls.push(`insert:${table}`);
        return resolve({ data: st.single ? row : [row], error: null });
      }
      if (st.op === 'upsert') {
        const keys = (st.upsertOpts?.onConflict || '').split(',').map((s) => s.trim()).filter(Boolean);
        let existing = null;
        if (keys.length) {
          existing = __db[table].find((r) => keys.every((k) => (r[k] ?? defaultFor(table, k)) === (st.payload[k] ?? defaultFor(table, k))));
        }
        if (existing) { __calls.push(`upsert-hit:${table}`); return resolve({ data: st.single ? existing : [existing], error: null }); }
        const row = Object.assign({ id: 'id_' + (++__idSeq) }, st.payload);
        __db[table].push(row);
        __calls.push(`upsert-new:${table}`);
        return resolve({ data: st.single ? row : [row], error: null });
      }
      if (st.op === 'update') {
        const rs = rows();
        for (const r of rs) Object.assign(r, st.payload);
        __calls.push(`update:${table}${rs.length ? '' : ':miss'}`);
        return resolve({ data: rs, error: null });
      }
      if (st.op === 'delete') {
        __db[table] = __db[table].filter((r) => !match(r));
        return resolve({ data: null, error: null });
      }
      const rs = rows();
      if (st.single || st.maybe) return resolve({ data: rs[0] || null, error: null });
      return resolve({ data: rs, error: null });
    });
  }

  const api = {
    select(_cols) { if (st.op === 'select') return api; st.selectAfter = true; return api; },
    insert(row) { st.op = 'insert'; st.payload = row; return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; },
    upsert(row, opts) { st.op = 'upsert'; st.payload = row; st.upsertOpts = opts || null; return api; },
    delete() { st.op = 'delete'; return api; },
    eq(f, v) { st.filters.push((r) => (r[f] ?? defaultFor(table, f)) === v); return api; },
    neq(f, v) { st.filters.push((r) => r[f] !== v); return api; },
    is(f, v) { st.filters.push((r) => (v === null ? r[f] == null : r[f] === v)); return api; },
    in(f, arr) { st.filters.push((r) => arr.includes(r[f])); return api; },
    order() { return api; },
    limit() { return api; },
    single() { st.single = true; return exec(); },
    maybeSingle() { st.maybe = true; return exec(); },
    then(res, rej) { return exec().then(res, rej); },
  };
  return api;
}

// The live schema's defaults that the code relies on without writing them.
function defaultFor(table, field) {
  if (table === 'briefs' && field === 'brief_type') return 'weekly';
  return undefined;
}

const supabase = { from: __query };

const logger = {
  info() {}, warn() {}, error() {},
  event(name) { __calls.push(`log:${name}`); return name; },
  addContext() {},
  runWithContext(_s, fn) { return fn(); },
};

// ── time (fixed: Sunday 2026-07-19, 08:xx in America/New_York) ──────────────
function localParts() { return { weekday: 'sunday', hour: 8 }; }
function localWeekOf() { return '2026-07-13'; }

// ── existing services the job composes with ────────────────────────────────
const briefsSvc = {
  async createBrief({ userId, weekOf }) {
    const { data } = await __query('briefs')
      .upsert({ user_id: userId, week_of: weekOf, brief_type: 'weekly', status: 'generated' }, { onConflict: 'user_id,week_of,brief_type' })
      .select('id').single();
    return data;
  },
  async clearBriefItems(briefId) {
    await __query('brief_items').delete().eq('brief_id', briefId);
  },
  async addBriefItem({ briefId, userId, personId = null, itemType, body, isProLocked = false, priority = 50 }) {
    await __query('brief_items').insert({
      brief_id: briefId, user_id: userId, person_id: personId,
      item_type: itemType, body, is_pro_locked: isProLocked, priority,
      source_data: {},
    });
  },
};

let __plan = { items: [], teaser: null, goalFollowup: null, planTier: 'free', quiet: true, closingQuestion: 'Who?' };
function gatherCandidates() { return {}; }
function selectBriefItems() { return __plan; }

let __suppressed = false;
async function isInSuppressionWindow() { return __suppressed; }

// ── node:crypto substitutes (deterministic; real crypto is proven in the
// direct-import .mjs suites — the bundle only needs stable shapes) ──────────
let __randCounter = 0;
function randomBytes(n) {
  __randCounter++;
  const b = Buffer.alloc(n);
  b.writeUInt32BE(__randCounter, 0);
  return b;
}
function fakeDigestHex(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = ((h1 ^ s.charCodeAt(i)) * 0x01000193) >>> 0;
    h2 = ((h2 + s.charCodeAt(i)) * 31 + 7) >>> 0;
  }
  const base = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
  return base.repeat(4).slice(0, 64);
}
function createHash() {
  let acc = '';
  return { update(s) { acc += String(s); return this; }, digest(enc) { const hex = fakeDigestHex('sha:' + acc); return enc === 'hex' ? hex : Buffer.from(hex.slice(0, 32), 'utf8'); } };
}
function createHmac(_alg, key) {
  let acc = '';
  return { update(s) { acc += String(s); return this; }, digest(enc) { const hex = fakeDigestHex('hmac:' + key + ':' + acc); return enc === 'hex' ? hex : Buffer.from(hex.slice(0, 32), 'utf8'); } };
}
function timingSafeEqual(a, b) { return a.length === b.length && Buffer.compare(a, b) === 0; }

// ── node:fs / node:path substitutes (mock transport writes in-memory) ───────
const fs = {
  __files: {},
  mkdirSync() {},
  writeFileSync(p, content) { this.__files[p] = content; __calls.push('fs.write'); },
};
const path = { join: (...parts) => parts.join('/') };

// ── checker ─────────────────────────────────────────────────────────────────
function makeChecker() {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) println('  PASS  ' + name);
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  return { check, done: () => failures };
}
