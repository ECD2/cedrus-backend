import { supabase } from '../lib/supabase.js';

// ─────────────────────────────────────────────────────────────────────────
// USER-SET GOALS (INFRA-15) — the standing, user-authored goals surface.
//
// This EXTENDS the existing user_goals table (see memory.addGoal /
// memory.getOpenGoals / memory.getOpenGoalsThisWeek). It does NOT stand up a
// second goals store. Two populations now share user_goals, kept apart by two
// guarantees so neither feature can disturb the other:
//
//   • origin — 'cedrus_inferred' (default; the pipeline's weekly reach-out
//     INTENTIONS, auto-captured from chat in pipeline/07_persist.js) vs
//     'user_set' (what a person deliberately writes here). Every read in THIS
//     file filters origin='user_set', so a user goal is never confused with a
//     weekly intention.
//
//   • status — inferred intentions live at 'open'; user-set goals live at
//     'active'. This is the LOAD-BEARING isolation: memory.getOpenGoals /
//     getOpenGoalsThisWeek and relationships.js' completion transition all
//     filter .eq('status','open'), so a user-set goal is invisible to the
//     weekly brief / insights / discovery reads BY CONSTRUCTION. That matters:
//     jobs/brief/select.js and briefEngine.js take getOpenGoals()[0] for the
//     "did you reach out?" follow-up, and a person-less life goal must never
//     hijack that slot. (If a future product decision DOES want user-set goals
//     in those reads, that is a one-line filter change in the memory.js
//     owner's file — flagged in docs/FLAGS_FROM_STATION5_GOALS.md, never made
//     here.) The isolation is proven directly in test/goals.test.js.
//
// New columns this feature needs (PROPOSED, not run): docs/GOALS.proposed.sql
//   user_goals.origin     text not null default 'cedrus_inferred'
//   user_goals.priority   int  not null default 0
//   user_goals.updated_at timestamptz
//   week_of made nullable + status CHECK widened to allow 'active'
//
// THE VITAL FEW (Pareto's few-that-matter): a user may store UNLIMITED goals,
// but focus is finite. selectVitalFew() is a PURE, deterministic ranking that
// surfaces the 3–5 that matter most — same goals in, same few out, no clock,
// model, or randomness. User-set priority leads; older goals win ties (you
// have carried them longer); the id is the final total-order tiebreak so the
// result is stable to the row.
//
// Ownership discipline (people-service rule): the service-role client bypasses
// RLS, so `.eq('user_id', …)` on every statement is the ONLY tenant isolation.
// A foreign, unknown, or malformed goal id all answer the same 404 — existence
// is never revealed across tenants. person_id links are validated the same
// way: a goal can only point at one of the user's OWN people.
// ─────────────────────────────────────────────────────────────────────────

// The focus band. MIN is advisory (a hint the user has room to add more); MAX
// is the hard ceiling selectVitalFew returns.
export const VITAL_FEW_MIN = 3;
export const VITAL_FEW_MAX = 5;

// Partition key: this service owns exactly the 'user_set' rows of user_goals.
export const GOAL_ORIGIN = 'user_set';

// Lifecycle for user-set goals. 'active' (deliberately NOT 'open' — see the
// isolation note above) and 'completed'. A remove is a real delete.
export const STATUS_ACTIVE = 'active';
export const STATUS_COMPLETED = 'completed';
export const WRITABLE_STATUSES = [STATUS_ACTIVE, STATUS_COMPLETED];
export const LIST_STATUSES = [STATUS_ACTIVE, STATUS_COMPLETED, 'all'];

export const MAX_GOAL_TEXT_CHARS = 280;
export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 100;

// Voice spec: warm, brief, no em dashes, no exclamation marks.
export const MSG_NOT_FOUND = "I couldn't find that goal.";
export const MSG_NEED_TEXT = 'Tell me the goal and I can save it.';
export const MSG_EMPTY_TEXT = 'Give the goal a few words and I can save it.';
export const MSG_TEXT_TOO_LONG = `Keep the goal under ${MAX_GOAL_TEXT_CHARS} characters and I'll save it.`;
export const MSG_SERVER_FIELDS = 'Some of those are mine to set. Send goal, and optionally priority, due_at, or person_id.';
export const MSG_BAD_PATCH = 'Tell me what to change. I can update the goal, its priority, its due date, or mark it done.';
export const MSG_BAD_PRIORITY = `Priority is a whole number from ${PRIORITY_MIN} to ${PRIORITY_MAX}.`;
export const MSG_BAD_STATUS = 'I can set a goal to active or completed.';
export const MSG_BAD_DUE = "I didn't understand that due date.";
export const MSG_BAD_PERSON = "I couldn't find that person in your circle.";
export const MSG_BAD_LIST_FILTER = "I don't recognize that filter.";

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code, publicMessage: message });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const nowIso = () => new Date().toISOString();

// Columns a client may see. user_id / origin / week_of / source_message_id
// stay server-side.
const PUBLIC_COLUMNS =
  'id, goal_text, priority, status, person_id, due_at, completed_at, created_at, updated_at';

const toPublic = (r) => ({
  id: r.id,
  goal_text: r.goal_text,
  priority: Number.isInteger(r.priority) ? r.priority : 0,
  status: r.status,
  person_id: r.person_id ?? null,
  due_at: r.due_at ?? null,
  completed_at: r.completed_at ?? null,
  created_at: r.created_at ?? null,
  updated_at: r.updated_at ?? null,
});

// ── the vital few (PURE) ───────────────────────────────────────────────────
// Total order for focus: priority DESC (higher first), then created_at ASC
// (older goals first), then id ASC (stable final tiebreak). Deterministic: no
// clock, no randomness, no db. A missing/non-integer priority sorts as 0.
export function compareGoalsForFocus(a, b) {
  const pa = a && Number.isInteger(a.priority) ? a.priority : 0;
  const pb = b && Number.isInteger(b.priority) ? b.priority : 0;
  if (pb !== pa) return pb - pa; // priority desc
  const ta = Date.parse((a && a.created_at) || '') || 0;
  const tb = Date.parse((b && b.created_at) || '') || 0;
  if (ta !== tb) return ta - tb; // created_at asc (older first)
  const ia = String((a && a.id) ?? '');
  const ib = String((b && b.id) ?? '');
  return ia < ib ? -1 : ia > ib ? 1 : 0; // id asc (total-order tiebreak)
}

// From a set of goals, the vital few (up to `max`, default VITAL_FEW_MAX).
// PURE — the same goals always yield the same ordered few, regardless of the
// order they arrive in. Returns a fresh array; never mutates the input. The
// caller passes the population to rank (getVitalFew passes ACTIVE user-set
// goals); this function does not itself read status/origin.
export function selectVitalFew(goals, { max = VITAL_FEW_MAX } = {}) {
  const list = Array.isArray(goals) ? goals.slice() : [];
  list.sort(compareGoalsForFocus);
  return list.slice(0, Math.max(0, max));
}

// ── validators ──────────────────────────────────────────────────────────────
function cleanGoalText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw httpError(422, 'invalid_request', MSG_EMPTY_TEXT);
  }
  const trimmed = text.trim();
  if (trimmed.length > MAX_GOAL_TEXT_CHARS) {
    throw httpError(422, 'invalid_request', MSG_TEXT_TOO_LONG);
  }
  return trimmed;
}

// Missing/null → the default 0 (unranked). Anything present must be a whole
// number in range; a float or out-of-range value is a client mistake.
function cleanPriority(priority) {
  if (priority === undefined || priority === null) return 0;
  if (typeof priority !== 'number' || !Number.isInteger(priority)
      || priority < PRIORITY_MIN || priority > PRIORITY_MAX) {
    throw httpError(422, 'invalid_request', MSG_BAD_PRIORITY);
  }
  return priority;
}

// Optional. Normalized to ISO so the stored value is unambiguous.
function cleanDueAt(dueAt) {
  if (dueAt === undefined || dueAt === null || dueAt === '') return null;
  if (typeof dueAt !== 'string') throw httpError(422, 'invalid_request', MSG_BAD_DUE);
  const t = Date.parse(dueAt);
  if (!Number.isFinite(t)) throw httpError(422, 'invalid_request', MSG_BAD_DUE);
  return new Date(t).toISOString();
}

// person_id is optional; when present it must be one of the user's OWN people
// (tenant isolation on the link). A foreign/unknown id is refused, never
// stored as a dangling cross-tenant reference.
async function cleanPersonId(db, userId, personId) {
  if (personId === undefined || personId === null || personId === '') return null;
  if (typeof personId !== 'string' || !UUID_RE.test(personId.trim())) {
    throw httpError(422, 'invalid_request', MSG_BAD_PERSON);
  }
  const id = personId.trim();
  const { data, error } = await db.from('people')
    .select('id').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(422, 'invalid_request', MSG_BAD_PERSON);
  return id;
}

// ── list ────────────────────────────────────────────────────────────────────
// Default is ACTIVE only; ?status=completed or ?status=all widen it. Returned
// in focus order (most important first), the same order the vital few draws
// from, so the management surface and the focus view agree.
export async function listGoals({ user, status } = {}, deps = {}) {
  if (!user || !user.id) throw new Error('listGoals: user is required (ownership guard)');
  const db = deps.db || supabase;

  const want = status === undefined ? STATUS_ACTIVE : status;
  if (typeof want !== 'string' || !LIST_STATUSES.includes(want)) {
    throw httpError(422, 'invalid_request', MSG_BAD_LIST_FILTER);
  }

  let q = db.from('user_goals').select(PUBLIC_COLUMNS)
    .eq('user_id', user.id).eq('origin', GOAL_ORIGIN);
  if (want !== 'all') q = q.eq('status', want);
  const { data, error } = await q;
  if (error) throw error;

  // Sort in code, not SQL: focus order is a product invariant that must hold
  // identically on every backend (and the test rig's db double ignores ORDER).
  const rows = (data || []).slice().sort(compareGoalsForFocus);
  return { goals: rows.map(toPublic) };
}

// ── the vital few (read layer) ──────────────────────────────────────────────
// The 3–5 that matter, drawn from the user's ACTIVE user-set goals. `total` is
// how many active goals exist; `belowFloor` flags that the user has room to
// name more focus goals (< VITAL_FEW_MIN), a hint, never an error.
export async function getVitalFew({ user } = {}, deps = {}) {
  if (!user || !user.id) throw new Error('getVitalFew: user is required (ownership guard)');
  const db = deps.db || supabase;

  const { data, error } = await db.from('user_goals').select(PUBLIC_COLUMNS)
    .eq('user_id', user.id).eq('origin', GOAL_ORIGIN).eq('status', STATUS_ACTIVE);
  if (error) throw error;

  const active = data || [];
  const few = selectVitalFew(active);
  return {
    vitalFew: few.map(toPublic),
    total: active.length,
    min: VITAL_FEW_MIN,
    max: VITAL_FEW_MAX,
    belowFloor: active.length < VITAL_FEW_MIN,
  };
}

// ── add ─────────────────────────────────────────────────────────────────────
// Store a user-authored goal. UNLIMITED: there is no per-user cap — the vital
// few is the focus mechanism, not a storage limit. The act of sending it IS
// the user stating it, so origin='user_set' is written directly.
export async function addGoal({ user, body } = {}, deps = {}) {
  if (!user || !user.id) throw new Error('addGoal: user is required (ownership guard)');
  const db = deps.db || supabase;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(422, 'invalid_request', MSG_NEED_TEXT);
  }
  // Server-owned columns are refused loudly, not silently rewritten: a client
  // that tries to set origin/status/completed_at is out of contract.
  const allowed = new Set(['goal_text', 'priority', 'due_at', 'person_id']);
  const extra = Object.keys(body).filter((k) => !allowed.has(k));
  if (extra.length) throw httpError(422, 'invalid_request', MSG_SERVER_FIELDS);

  const goalText = cleanGoalText(body.goal_text);
  const priority = cleanPriority(body.priority);
  const dueAt = cleanDueAt(body.due_at);
  const personId = await cleanPersonId(db, user.id, body.person_id);

  // Insert every column explicitly (values match the DB defaults): the write
  // site documents the whole row, and the columns exist even on the test
  // double, which runs no defaults. week_of is null on purpose — a user-set
  // goal is a standing goal, not a weekly intention, and the weekly reads key
  // on week_of + status='open'.
  const { data, error } = await db.from('user_goals').insert({
    user_id: user.id,
    person_id: personId,
    goal_text: goalText,
    origin: GOAL_ORIGIN,
    priority,
    status: STATUS_ACTIVE,
    due_at: dueAt,
    week_of: null,
    completed_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }).select('*').single();
  if (error) throw error;

  return { created: true, goal: toPublic(data) };
}

// ── update ──────────────────────────────────────────────────────────────────
// v1 updatable surface: goal_text (edit), priority (re-rank), status
// (active <-> completed), due_at, person_id. Scoped to origin='user_set' so
// this route can never mutate a pipeline-captured intention.
export async function updateGoal({ user, goalId, patch } = {}, deps = {}) {
  if (!user || !user.id) throw new Error('updateGoal: user is required (ownership guard)');
  const db = deps.db || supabase;

  if (typeof goalId !== 'string' || !UUID_RE.test(goalId.trim())) {
    throw httpError(404, 'not_found', MSG_NOT_FOUND);
  }
  const id = goalId.trim();

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw httpError(422, 'invalid_request', MSG_BAD_PATCH);
  }
  const allowed = new Set(['goal_text', 'priority', 'status', 'due_at', 'person_id']);
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((k) => !allowed.has(k))) {
    throw httpError(422, 'invalid_request', MSG_BAD_PATCH);
  }

  // Foreign / unknown ids answer the same 404 (ownership rule).
  const { data: current, error: readErr } = await db.from('user_goals')
    .select('*').eq('id', id).eq('user_id', user.id).eq('origin', GOAL_ORIGIN).maybeSingle();
  if (readErr) throw readErr;
  if (!current) throw httpError(404, 'not_found', MSG_NOT_FOUND);

  const payload = { updated_at: nowIso() };
  if ('goal_text' in patch) payload.goal_text = cleanGoalText(patch.goal_text);
  if ('priority' in patch) payload.priority = cleanPriority(patch.priority);
  if ('due_at' in patch) payload.due_at = cleanDueAt(patch.due_at);
  if ('person_id' in patch) payload.person_id = await cleanPersonId(db, user.id, patch.person_id);
  if ('status' in patch) {
    if (!WRITABLE_STATUSES.includes(patch.status)) {
      throw httpError(422, 'invalid_request', MSG_BAD_STATUS);
    }
    payload.status = patch.status;
    // Completing stamps completed_at; reactivating clears it.
    payload.completed_at = patch.status === STATUS_COMPLETED ? nowIso() : null;
  }

  const { data, error } = await db.from('user_goals')
    .update(payload).eq('id', id).eq('user_id', user.id).eq('origin', GOAL_ORIGIN)
    .select('*');
  if (error) throw error;
  const updated = data && data[0];
  if (!updated) throw httpError(404, 'not_found', MSG_NOT_FOUND); // deleted mid-flight

  return { updated: true, goal: toPublic(updated) };
}

// ── remove ──────────────────────────────────────────────────────────────────
// A real delete. Scoped to origin='user_set': the route cannot delete a
// pipeline-captured intention.
export async function removeGoal({ user, goalId } = {}, deps = {}) {
  if (!user || !user.id) throw new Error('removeGoal: user is required (ownership guard)');
  const db = deps.db || supabase;

  if (typeof goalId !== 'string' || !UUID_RE.test(goalId.trim())) {
    throw httpError(404, 'not_found', MSG_NOT_FOUND);
  }
  const id = goalId.trim();

  const { data: existing, error: readErr } = await db.from('user_goals')
    .select('id').eq('id', id).eq('user_id', user.id).eq('origin', GOAL_ORIGIN).maybeSingle();
  if (readErr) throw readErr;
  if (!existing) throw httpError(404, 'not_found', MSG_NOT_FOUND);

  const { error } = await db.from('user_goals')
    .delete().eq('id', id).eq('user_id', user.id).eq('origin', GOAL_ORIGIN);
  if (error) throw error;

  return { removed: true, id };
}
