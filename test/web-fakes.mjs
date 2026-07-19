// In-memory doubles for the N3 web-API suite (test/web-api.test.mjs).
//
// Unlike the concat-rig stubs (test/stubs.js), these are ESM modules wired
// in via bun's mock.module, so the REAL production code — auth middleware,
// capture/prioritySwap/restore services, and the shared pipeline stages
// (understand / resolveEntities / persist / people / memory /
// relationships / messages / usage) — runs unmodified on top of them. Only
// two seams are faked: the Supabase client (this file) and the OpenAI
// client (canned extractions, house DI via understand({client})).

import crypto from 'node:crypto';

// ── Fake Supabase client ────────────────────────────────────────────────────
// db shape: { tableName: [row, …] }. Views (v_message_quota) are plain
// tables here — seed them with the rows the view would produce.
export function makeFakeSupabase({ db, tokens }) {
  // Per-table insert defaults, mirroring the Postgres column defaults the
  // real code relies on.
  const DEFAULTS = {
    facts: () => ({ is_current: true }),
    people: () => ({
      is_self: false, is_archived: false, archived_at: null, archived_reason: null,
      is_core_five: false, core_five_source: null, aliases: [], relationship: null,
    }),
  };

  function table(name) {
    if (!db[name]) db[name] = [];
    const state = {
      op: 'select', payload: null, filters: [], order: null, limit: null,
      single: false, maybe: false, head: false, count: null, returning: false,
      upsertOpts: null,
    };
    const api = {
      select(_cols, opts = {}) {
        if (state.op === 'select') { state.count = opts.count || null; state.head = !!opts.head; }
        else state.returning = true;
        return api;
      },
      insert(rows) { state.op = 'insert'; state.payload = rows; return api; },
      update(patch) { state.op = 'update'; state.payload = patch; return api; },
      upsert(rows, opts) { state.op = 'upsert'; state.payload = rows; state.upsertOpts = opts || {}; return api; },
      delete() { state.op = 'delete'; return api; },
      eq(f, v) { state.filters.push((r) => r[f] === v); return api; },
      neq(f, v) { state.filters.push((r) => r[f] !== v); return api; },
      in(f, arr) { state.filters.push((r) => arr.includes(r[f])); return api; },
      is(f, v) { state.filters.push((r) => r[f] === v); return api; },
      not(f, op, v) { if (op === 'is') state.filters.push((r) => r[f] !== v); return api; },
      gt(f, v) { state.filters.push((r) => r[f] > v); return api; },
      gte(f, v) { state.filters.push((r) => r[f] >= v); return api; },
      lt(f, v) { state.filters.push((r) => r[f] < v); return api; },
      lte(f, v) { state.filters.push((r) => r[f] <= v); return api; },
      order(f, opts = {}) { state.order = { f, asc: opts.ascending !== false }; return api; },
      limit(n) { state.limit = n; return api; },
      single() { state.single = true; return api; },
      maybeSingle() { state.maybe = true; return api; },
      then(resolve, reject) {
        try { resolve(run()); } catch (e) { if (reject) reject(e); else throw e; }
      },
    };

    function finish(rows) {
      let out = rows;
      if (state.order) {
        const { f, asc } = state.order;
        out = [...out].sort((a, b) => {
          const av = a[f], bv = b[f];
          if (av === bv) return 0;
          if (av == null) return 1;             // nulls last, either direction
          if (bv == null) return -1;
          return (av < bv ? -1 : 1) * (asc ? 1 : -1);
        });
      }
      if (state.limit != null) out = out.slice(0, state.limit);
      if (state.single) {
        if (out.length !== 1) return { data: null, error: { message: `single(): expected 1 row, got ${out.length}` } };
        return { data: out[0], error: null };
      }
      if (state.maybe) return { data: out[0] || null, error: null };
      return { data: out, error: null };
    }

    function run() {
      const rows = db[name];
      const matched = () => rows.filter((r) => state.filters.every((fn) => fn(r)));

      if (state.op === 'select') {
        const found = matched();
        if (state.count) return { data: state.head ? null : found, count: found.length, error: null };
        return finish(found);
      }
      if (state.op === 'insert' || state.op === 'upsert') {
        const list = Array.isArray(state.payload) ? state.payload : [state.payload];
        const inserted = [];
        for (const raw of list) {
          if (state.op === 'upsert' && state.upsertOpts.onConflict) {
            const keys = state.upsertOpts.onConflict.split(',').map((s) => s.trim());
            const dup = rows.find((r) => keys.every((k) => r[k] === raw[k]));
            if (dup) {
              if (!state.upsertOpts.ignoreDuplicates) Object.assign(dup, raw);
              continue;
            }
          }
          const row = {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            ...(DEFAULTS[name] ? DEFAULTS[name]() : {}),
            ...raw,
          };
          rows.push(row);
          inserted.push(row);
        }
        return state.returning || state.single || state.maybe
          ? finish(inserted) : { data: null, error: null };
      }
      if (state.op === 'update') {
        const found = matched();
        for (const r of found) Object.assign(r, state.payload);
        return state.returning || state.single || state.maybe
          ? finish(found) : { data: null, error: null };
      }
      if (state.op === 'delete') {
        const found = matched();
        db[name] = rows.filter((r) => !found.includes(r));
        return { data: null, error: null };
      }
      throw new Error(`fake supabase: unsupported op ${state.op}`);
    }

    return api;
  }

  // Faithful JS mirror of the set_priority_people RPC (migration
  // 20260713120000): full-set semantics, ownership/self/archived
  // validation, caller-supplied limit. Error messages reuse the migration's
  // wording because prioritySwap.js branches on the distinctive fragments
  // ('not selectable', 'limit is').
  async function rpc(fn, params) {
    if (fn !== 'set_priority_people') {
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    }
    const { target_user_id, priority_person_ids, max_priority, selection_source } = params;
    if (!['manual', 'pinned'].includes(selection_source)) {
      return { data: null, error: { message: 'set_priority_people: selection_source must be manual or pinned' } };
    }
    const wanted = [...new Set(priority_person_ids || [])];
    if (wanted.length > max_priority) {
      return { data: null, error: { message: `set_priority_people: ${wanted.length} people requested but limit is ${max_priority}` } };
    }
    if (!(db.app_users || []).some((u) => u.id === target_user_id)) {
      return { data: null, error: { message: `set_priority_people: unknown user ${target_user_id}` } };
    }
    const peopleRows = db.people || [];
    const valid = peopleRows.filter((p) =>
      wanted.includes(p.id) && p.user_id === target_user_id && p.is_self === false && p.is_archived === false);
    if (valid.length !== wanted.length) {
      return { data: null, error: { message: `set_priority_people: ${wanted.length - valid.length} of ${wanted.length} requested people are not selectable (wrong owner, self, or archived)` } };
    }
    let removed = 0, added = 0;
    for (const p of peopleRows) {
      if (p.user_id !== target_user_id) continue;
      if (p.is_core_five === true && !wanted.includes(p.id)) { p.is_core_five = false; removed++; }
    }
    for (const p of peopleRows) {
      if (p.user_id !== target_user_id || !wanted.includes(p.id)) continue;
      if (p.is_core_five !== true) { p.is_core_five = true; added++; }
      p.core_five_source = selection_source;
    }
    return {
      data: { user_id: target_user_id, priority_count: wanted.length, added, removed, source: selection_source },
      error: null,
    };
  }

  // Supabase Auth double: tokens is { '<bearer token>': '<auth user id>' }.
  // Anything not in the map — including forged/expired tokens — is rejected
  // exactly like GoTrue rejects an invalid JWT (error return, not a throw).
  const auth = {
    async getUser(token) {
      const authUserId = tokens[token];
      if (!authUserId) return { data: { user: null }, error: { message: 'invalid JWT', status: 401 } };
      return { data: { user: { id: authUserId } }, error: null };
    },
  };

  return { from: table, rpc, auth };
}

// ── Fake OpenAI client ──────────────────────────────────────────────────────
// understand() calls chat.completions.create and reads choices/usage/model.
// Tests queue extraction objects; running dry is a test bug, so it throws.
export function makeFakeOpenai() {
  const queue = [];
  return {
    queue,
    chat: {
      completions: {
        async create() {
          if (!queue.length) throw new Error('fakeOpenai: response queue is empty (test bug)');
          const parsed = queue.shift();
          return {
            choices: [{ message: { content: JSON.stringify(parsed) } }],
            usage: { prompt_tokens: 111, completion_tokens: 22 },
            model: 'gpt-fake',
          };
        },
      },
    },
  };
}

// A well-formed extraction payload in the shape prompts/extraction.system.txt
// demands; tests override the pieces each case needs.
export function extraction(overrides = {}) {
  return {
    intent: 'capture',
    people: [], facts: [], saved_items: [], reminders: [], goals: [],
    prompt_answer: null,
    reply: 'Got it, saved.',
    valence: { band: 'routine', triggers: [] },
    ...overrides,
  };
}
