import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────
// RESTORE (N3) — the backend for "you can bring them back anytime".
//
// Archiving a person only ever sets flags (is_archived / archived_at /
// archived_reason); nothing about them is deleted. Restore is therefore a
// pure flag-clear, and the archived list is a read. Both follow the
// people-service ownership guard to the letter: the service-role client
// bypasses RLS, so `.eq('user_id', …)` on every statement is the ONLY
// tenant isolation — a foreign person_id matches zero rows and reads as
// "not found", never as another user's data.
// ─────────────────────────────────────────────────────────────────────────

export const MSG_PERSON_NOT_FOUND = "I couldn't find that person in your circle.";

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code, publicMessage: message });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Un-archive one person the authenticated user owns. Idempotent: restoring
// a person who was never archived still matches their row and returns 200,
// so a double-tap in the UI can't error.
export async function restorePerson({ user, personId }, deps = {}) {
  if (!user || !user.id) throw new Error('restorePerson: user is required (ownership guard)');
  const d = { db: supabase, ...deps };

  // A malformed id can't be anyone's person; answer 404 without letting it
  // reach Postgres as a uuid cast error (which would 500).
  if (typeof personId !== 'string' || !UUID_RE.test(personId.trim())) {
    throw httpError(404, 'not_found', MSG_PERSON_NOT_FOUND);
  }

  const { data, error } = await d.db.from('people')
    .update({ is_archived: false, archived_at: null, archived_reason: null })
    .eq('id', personId.trim()).eq('user_id', user.id)
    .select('id, name, is_archived');
  if (error) throw error;

  const person = data && data[0];
  if (!person) {
    // Unknown id and another user's person are the SAME 404 — existence is
    // never revealed across tenants.
    logger.event('web.restore.rejected', {
      level: 'warn', error_category: 'validation', status_code: 404,
      user_ref: 'u_' + user.id, message: 'person not found for this user',
    });
    throw httpError(404, 'not_found', MSG_PERSON_NOT_FOUND);
  }

  logger.event('web.restore.accepted', {
    user_ref: 'u_' + user.id, outcome: 'accepted', meta: { person_id: person.id },
  });
  return { restored: true, person };
}

// The user's own archived people, most recently archived first — powers the
// restore surface (N4).
export async function listArchivedPeople({ user }, deps = {}) {
  if (!user || !user.id) throw new Error('listArchivedPeople: user is required (ownership guard)');
  const d = { db: supabase, ...deps };

  const { data, error } = await d.db.from('people')
    .select('id, name, archived_at')
    .eq('user_id', user.id).eq('is_archived', true)
    .order('archived_at', { ascending: false });
  if (error) throw error;
  return { people: data || [] };
}
