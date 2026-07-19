import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────
// PRIORITY SWAP (N3) — the web write path for "your five".
//
// All writes go through the set_priority_people() RPC (migration
// 20260713120000_priority_people_enforcement.sql), which is the ONLY
// supported write path for the priority columns: it is service_role-execute
// only, atomic per user (FOR UPDATE on the app_users row), full-set
// semantics, and it re-validates ownership / non-self / non-archived under
// the lock. This service never touches is_core_five directly — that rule is
// stated in the migration itself and enforced in code review.
//
// This route's job on top of the RPC:
//   • target_user_id is ALWAYS the authenticated user (req.appUser.id via
//     routes/api/auth.js) — a client cannot aim the RPC at anyone else.
//   • the friendly cap: more than five ids is answered with the product's
//     warm copy BEFORE the RPC is called (and the RPC's own limit check
//     remains as the race-proof backstop behind it).
//
// The cap is five for everyone on this route today (the product's "your
// five"). When the entitlements module lands (Pro = unlimited), the limit
// becomes plan-derived here — the migration deliberately keeps plan logic
// out of SQL, so that change is one line in this file.
// ─────────────────────────────────────────────────────────────────────────

export const PRIORITY_MAX = 5;

// Voice spec applies to error copy: warm, no em dashes, no exclamation
// marks, and the standing promise that nobody gets lost ("everyone else
// stays remembered" — the same language the dashboard uses).
export const MSG_PRIORITY_LIMIT =
  'I can only keep five people in close focus. Pick your five, and everyone else stays remembered. You can swap anytime.';
export const MSG_NOT_SELECTABLE =
  "Some of those people aren't available to pin right now. If someone is archived, bring them back first.";
export const MSG_BAD_IDS = "I didn't recognize part of that list. Refresh and try again.";

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code, publicMessage: message });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Full-set semantics, mirroring the RPC: `personIds` is the user's COMPLETE
// desired priority set (add/remove/swap/clear are all this one shape).
export async function swapPriorityPeople({ user, personIds }, deps = {}) {
  if (!user || !user.id) throw new Error('swapPriorityPeople: user is required (ownership guard)');
  const d = { db: supabase, ...deps };

  if (!Array.isArray(personIds)) {
    throw httpError(422, 'invalid_request', MSG_BAD_IDS);
  }
  const cleaned = personIds.map((s) => (typeof s === 'string' ? s.trim() : ''));
  if (cleaned.some((s) => !UUID_RE.test(s))) {
    // A malformed id would otherwise surface as a Postgres uuid[] cast
    // error (a 500); reject it here as a client mistake instead.
    throw httpError(422, 'invalid_request', MSG_BAD_IDS);
  }
  const wanted = [...new Set(cleaned.map((s) => s.toLowerCase()))];

  // The sixth person, answered warmly. The RPC's own limit check stays live
  // behind this as the concurrency-proof backstop.
  if (wanted.length > PRIORITY_MAX) {
    throw httpError(422, 'priority_limit_reached', MSG_PRIORITY_LIMIT);
  }

  const { data, error } = await d.db.rpc('set_priority_people', {
    target_user_id: user.id,           // token-derived, never client-supplied
    priority_person_ids: wanted,
    max_priority: PRIORITY_MAX,
    selection_source: 'manual',
  });
  if (error) {
    const msg = String(error.message || '');
    // RPC raise → friendly copy. "not selectable" = wrong owner, self, or
    // archived (deliberately indistinguishable: foreign ids read as absent).
    if (msg.includes('not selectable')) {
      logger.event('web.priority.rejected', {
        level: 'warn', error_category: 'validation', status_code: 422,
        user_ref: 'u_' + user.id, message: 'rpc: requested people not selectable',
      });
      throw httpError(422, 'not_selectable', MSG_NOT_SELECTABLE);
    }
    if (msg.includes('limit is')) {
      throw httpError(422, 'priority_limit_reached', MSG_PRIORITY_LIMIT);
    }
    throw error; // anything else is a real 500
  }

  // Echo the resulting five so the client can render without a second call.
  const { data: five } = await d.db.from('people')
    .select('id, name')
    .eq('user_id', user.id).eq('is_core_five', true).eq('is_archived', false)
    .order('name', { ascending: true });

  logger.event('web.priority.swapped', {
    user_ref: 'u_' + user.id, outcome: 'accepted',
    meta: {
      priority_count: (data && data.priority_count) ?? wanted.length,
      added: (data && data.added) ?? null, removed: (data && data.removed) ?? null,
    },
  });

  return {
    priority_count: (data && data.priority_count) ?? wanted.length,
    added: (data && data.added) ?? null,
    removed: (data && data.removed) ?? null,
    priority_people: five || [],
  };
}
