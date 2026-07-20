import { supabase } from '../lib/supabase.js';

// ─────────────────────────────────────────────────────────────────────────
// INTERESTS (NF2-SOURCES) — CRUD on the N5 `interests` table.
//
// The user tells Cedrus what they like — teams, shows, hobbies — and those
// rows feed the dashboard sections and (later wiring) the weekly brief.
// Contract: docs/INTERESTS_CONTRACT.md. Mounting: docs/MOUNT_SOURCES.md.
//
// The three load-bearing rules, in order:
//
//   1. CONFIRMED-ONLY (migration 20260719120002): a row exists only after a
//      confirming user action. An explicit add through this API *is* the
//      confirmation, so it writes provenance='user_stated' directly — the
//      propose-then-confirm loop does not apply. Inferred interests may
//      ONLY arrive via the existing capture confirm flow; this API refuses
//      any client attempt to set provenance (or any other server-owned
//      column) rather than silently ignoring it.
//
//   2. OPT-OUT HONORED EVERYWHERE: surfacing_state='off' means the user
//      silenced the interest (off ≠ delete — the row survives so they can
//      flip it back). list() therefore returns ACTIVE ROWS ONLY unless the
//      caller explicitly asks for more, so a consumer that forgets the
//      parameter honors the opt-out by construction. 'resting' is reserved
//      for the future retirement sweep: readable, never writable here.
//
//   3. OWNERSHIP (people-service discipline): the service-role client
//      bypasses RLS, so `.eq('user_id', …)` on every statement is the ONLY
//      tenant isolation. A foreign, unknown, or malformed interest id all
//      answer the same 404 — existence is never revealed across tenants.
//
// Column note: `confidence` is an internal ranking signal (MODEL/DYN-01
// forbid surfacing it; the N5 grant even hides it from authenticated
// SELECT). It never appears in a response — toPublic() is the single
// serialization point and omits it by construction.
//
// Re-adds: the table is unique on (user_id, category, lower(label)), and a
// re-stated interest re-affirms instead of duplicating. addInterest treats
// the duplicate as that re-affirmation: bump last_affirmed_at, adopt the
// user's latest casing, flip surfacing_state back to 'active' (they just
// told us they like it — leaving it silenced would read as a lost add),
// and upgrade provenance to 'user_stated' at full confidence.
// ─────────────────────────────────────────────────────────────────────────

// Closed vocabulary — must mirror the CHECK constraint in migration
// 20260719120002_interests_foundation.sql exactly. Widen only when a
// migration widens the CHECK.
export const INTEREST_CATEGORIES = [
  'sports_team', 'hobby', 'media_show', 'media_music',
  'food', 'place', 'other_freeform',
];

// States a client may write. 'resting' exists in the schema but is
// reserved for the future quiet-retirement sweep — no API writes it.
export const WRITABLE_STATES = ['active', 'off'];
export const LIST_STATES = ['active', 'resting', 'off', 'all'];

export const MAX_LABEL_CHARS = 200; // mirrors interests_label_length

// Voice spec: warm, brief, no em dashes, no exclamation marks.
export const MSG_NOT_FOUND = "I couldn't find that one in your interests.";
export const MSG_NEED_CATEGORY_AND_LABEL = 'Send a category and a label and I can save it.';
export const MSG_BAD_CATEGORY = "That's not a category I know yet.";
export const MSG_EMPTY_LABEL = 'Give it a name and I can save it.';
export const MSG_LABEL_TOO_LONG = `Keep the name under ${MAX_LABEL_CHARS} characters and I'll get it saved.`;
export const MSG_SERVER_FIELDS = "That part's mine to set. Send just category and label.";
export const MSG_BAD_PATCH = 'Tell me what to change. I can update label or surfacing_state.';
export const MSG_RESTING_RESERVED = 'Resting is something I set on my own. You can set active or off.';
export const MSG_DUPLICATE = "You've already got that one saved.";
export const MSG_BAD_LIST_FILTER = "I don't recognize that filter.";

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code, publicMessage: message });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columns a client may see. Everything else — confidence, user_id — stays
// server-side. Kept in sync with the contract's Interest type.
const PUBLIC_COLUMNS =
  'id, category, label, provenance, surfacing_state, last_affirmed_at, created_at, updated_at';

const toPublic = (r) => ({
  id: r.id,
  category: r.category,
  label: r.label,
  provenance: r.provenance,
  surfacing_state: r.surfacing_state,
  last_affirmed_at: r.last_affirmed_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const nowIso = () => new Date().toISOString();

// Postgres unique_violation — the (user_id, category, lower(label)) index
// firing under a write race the pre-checks could not see.
const isUniqueViolation = (err) => !!err && err.code === '23505';

// Validate + normalize a label. Returns the trimmed display string.
function cleanLabel(label) {
  if (typeof label !== 'string' || btrim(label) === '') {
    throw httpError(422, 'invalid_request', MSG_EMPTY_LABEL);
  }
  const trimmed = label.trim();
  if (trimmed.length > MAX_LABEL_CHARS) {
    throw httpError(422, 'invalid_request', MSG_LABEL_TOO_LONG);
  }
  return trimmed;
}
const btrim = (s) => (typeof s === 'string' ? s.trim() : '');

// Case-insensitive duplicate probe within (user, category). The unique
// index lower()s the label; supabase-js can't express that in a filter, so
// fetch the (small) category slice and compare in code. The index itself
// still backs this against races — see isUniqueViolation call sites.
async function findByLoweredLabel(db, { userId, category, label, excludeId = null }) {
  const { data, error } = await db.from('interests')
    .select('*')
    .eq('user_id', userId).eq('category', category);
  if (error) throw error;
  const wanted = label.toLowerCase();
  return (data || []).find(
    (r) => r.label.toLowerCase() === wanted && r.id !== excludeId,
  ) || null;
}

// ── list ─────────────────────────────────────────────────────────────────
// Default is ACTIVE ONLY: consumers that feed content (dashboard modules,
// the brief) honor the per-interest opt-out without doing anything. The
// management surface asks for state=all to show silenced rows too.
export async function listInterests({ user, state, category } = {}, deps = {}) {
  if (!user || !user.id) throw new Error('listInterests: user is required (ownership guard)');
  const d = { db: supabase, ...deps };

  const wantState = state === undefined ? 'active' : state;
  if (typeof wantState !== 'string' || !LIST_STATES.includes(wantState)) {
    throw httpError(422, 'invalid_request', MSG_BAD_LIST_FILTER);
  }
  if (category !== undefined
      && (typeof category !== 'string' || !INTEREST_CATEGORIES.includes(category))) {
    throw httpError(422, 'invalid_request', MSG_BAD_LIST_FILTER);
  }

  let q = d.db.from('interests').select(PUBLIC_COLUMNS).eq('user_id', user.id);
  if (wantState !== 'all') q = q.eq('surfacing_state', wantState);
  if (category !== undefined) q = q.eq('category', category);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) throw error;

  return { interests: (data || []).map(toPublic) };
}

// ── add ──────────────────────────────────────────────────────────────────
// Explicit user-stated add: the act of sending it IS the confirmation.
export async function addInterest({ user, body } = {}, deps = {}) {
  if (!user || !user.id) throw new Error('addInterest: user is required (ownership guard)');
  const d = { db: supabase, ...deps };

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(422, 'invalid_request', MSG_NEED_CATEGORY_AND_LABEL);
  }
  // Server-owned columns are refused loudly, not ignored: a client that
  // tries to set provenance/confidence/surfacing_state is violating the
  // confirmed-only rule and should hear about it in development, not have
  // its intent silently rewritten.
  const extra = Object.keys(body).filter((k) => k !== 'category' && k !== 'label');
  if (extra.length) throw httpError(422, 'invalid_request', MSG_SERVER_FIELDS);

  const { category } = body;
  if (typeof category !== 'string' || !INTEREST_CATEGORIES.includes(category)) {
    throw httpError(422, 'invalid_request', MSG_BAD_CATEGORY);
  }
  const label = cleanLabel(body.label);

  return upsertUserStated(d, { userId: user.id, category, label });
}

// insert-or-reaffirm against the (user, category, lower(label)) identity.
// retried=true marks the one retry after a raced unique violation.
async function upsertUserStated(d, { userId, category, label }, retried = false) {
  const existing = await findByLoweredLabel(d.db, { userId, category, label });

  if (existing) {
    // Re-affirmation: freshness clock now, latest casing wins, silenced
    // rows come back, provenance upgrades to the strongest signal we have.
    const { data, error } = await d.db.from('interests')
      .update({
        label,
        provenance: 'user_stated',
        confidence: 1.0,
        surfacing_state: 'active',
        last_affirmed_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq('id', existing.id).eq('user_id', userId)
      .select('*');
    if (error) throw error;
    const row = data && data[0];
    if (!row) throw httpError(404, 'not_found', MSG_NOT_FOUND); // deleted mid-flight
    return { created: false, reaffirmed: true, interest: toPublic(row) };
  }

  // Insert every column explicitly (values identical to the DB defaults):
  // the write site then documents the whole row, and the columns exist even
  // on backends that do not run the defaults (the test double).
  const { data, error } = await d.db.from('interests')
    .insert({
      user_id: userId,
      category,
      label,
      provenance: 'user_stated',
      confidence: 1.0,
      surfacing_state: 'active',
      last_affirmed_at: nowIso(),
      updated_at: nowIso(),
    })
    .select('*').single();
  if (error) {
    // Two racing adds of the same interest: the index caught what the
    // pre-check missed. Re-run once — the loser lands on the update path.
    if (isUniqueViolation(error) && !retried) {
      return upsertUserStated(d, { userId, category, label }, true);
    }
    throw error;
  }
  return { created: true, reaffirmed: false, interest: toPublic(data) };
}

// ── update ───────────────────────────────────────────────────────────────
// v1 updatable surface: label (rename) and surfacing_state (the per-
// interest opt-out toggle, 'active' | 'off').
export async function updateInterest({ user, interestId, patch } = {}, deps = {}) {
  if (!user || !user.id) throw new Error('updateInterest: user is required (ownership guard)');
  const d = { db: supabase, ...deps };

  // A malformed id can't be anyone's interest; answer 404 without letting
  // it reach Postgres as a uuid cast error (which would 500).
  if (typeof interestId !== 'string' || !UUID_RE.test(interestId.trim())) {
    throw httpError(404, 'not_found', MSG_NOT_FOUND);
  }
  const id = interestId.trim();

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw httpError(422, 'invalid_request', MSG_BAD_PATCH);
  }
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((k) => k !== 'label' && k !== 'surfacing_state')) {
    throw httpError(422, 'invalid_request', MSG_BAD_PATCH);
  }

  const wantsState = 'surfacing_state' in patch;
  if (wantsState && !WRITABLE_STATES.includes(patch.surfacing_state)) {
    // 'resting' lands here on purpose: schema-legal, sweep-reserved.
    throw httpError(422, 'invalid_request', MSG_RESTING_RESERVED);
  }
  const wantsLabel = 'label' in patch;
  const label = wantsLabel ? cleanLabel(patch.label) : null;

  // Foreign and unknown ids are the same 404 — see the ownership rule.
  const { data: current, error: readErr } = await d.db.from('interests')
    .select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (readErr) throw readErr;
  if (!current) throw httpError(404, 'not_found', MSG_NOT_FOUND);

  // Renames must not collide with another interest in the same category
  // (case-insensitively; a case-only rename of itself is always fine).
  if (wantsLabel && label.toLowerCase() !== current.label.toLowerCase()) {
    const clash = await findByLoweredLabel(d.db, {
      userId: user.id, category: current.category, label, excludeId: current.id,
    });
    if (clash) throw httpError(409, 'duplicate_interest', MSG_DUPLICATE);
  }

  const payload = { updated_at: nowIso() };
  if (wantsLabel) payload.label = label;
  if (wantsState) {
    payload.surfacing_state = patch.surfacing_state;
    // Turning a silenced interest back on is the user saying "yes, still
    // this" — that is an affirmation, so the freshness clock resets. A
    // plain rename is not.
    if (patch.surfacing_state === 'active' && current.surfacing_state !== 'active') {
      payload.last_affirmed_at = nowIso();
    }
  }

  let updated;
  try {
    const { data, error } = await d.db.from('interests')
      .update(payload).eq('id', id).eq('user_id', user.id)
      .select('*');
    if (error) throw error;
    updated = data && data[0];
  } catch (err) {
    if (isUniqueViolation(err)) throw httpError(409, 'duplicate_interest', MSG_DUPLICATE);
    throw err;
  }
  if (!updated) throw httpError(404, 'not_found', MSG_NOT_FOUND); // deleted mid-flight

  return { updated: true, interest: toPublic(updated) };
}

// ── remove ───────────────────────────────────────────────────────────────
// A real delete. Distinct from the opt-out: 'off' keeps the row so the
// user can change their mind; remove forgets it entirely.
export async function removeInterest({ user, interestId } = {}, deps = {}) {
  if (!user || !user.id) throw new Error('removeInterest: user is required (ownership guard)');
  const d = { db: supabase, ...deps };

  if (typeof interestId !== 'string' || !UUID_RE.test(interestId.trim())) {
    throw httpError(404, 'not_found', MSG_NOT_FOUND);
  }
  const id = interestId.trim();

  const { data: existing, error: readErr } = await d.db.from('interests')
    .select('id').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (readErr) throw readErr;
  if (!existing) throw httpError(404, 'not_found', MSG_NOT_FOUND);

  const { error } = await d.db.from('interests')
    .delete().eq('id', id).eq('user_id', user.id);
  if (error) throw error;

  return { removed: true, id };
}
