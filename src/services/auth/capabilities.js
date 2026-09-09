// ─────────────────────────────────────────────────────────────────────────────
// The closed capability vocabulary, and the read that projects it per person.
//
// The vocabulary is CLOSED by a CHECK constraint in
// supabase/migrations/20260830120000_multiuser_foundation.sql. This constant
// is a COPY of that list, and a copy is the Lesson 20 shape — one author, two
// places — so Bundle 47 parses the constraint out of the migration file and
// asserts the two agree. Add a capability there first; this list follows.
//
// An absent row and `granted = false` mean the same thing: refused. The read
// below returns every vocabulary entry as an explicit boolean so a consumer
// never has to know the difference, and never sees a capability the
// vocabulary does not contain.
//
// A read that ERRORED is returned as ok:false, never as "all false". supabase-
// js resolves { data, error } rather than throwing (Lesson 11); an unbound
// error here would make "could not check" indistinguishable from "nothing
// granted", which is the boolean-guard disease the doctrine names.
// ─────────────────────────────────────────────────────────────────────────────

export const CAPABILITY_VOCABULARY = Object.freeze([
  'run_agents', 'write_workspace', 'receive_brief', 'receive_sms',
]);

/**
 * @returns {Promise<{ok:true, capabilities:Record<string,boolean>} | {ok:false, error:object}>}
 */
export async function readCapabilities({ userId, db } = {}) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('readCapabilities refused: a user id is required — capabilities are read for one person, never for nobody');
  }
  const { data, error } = await db
    .from('user_capabilities')
    .select('capability, granted')
    .eq('user_id', userId);
  if (error) return { ok: false, error };
  const granted = new Set((data || []).filter((r) => r && r.granted === true).map((r) => r.capability));
  const capabilities = {};
  for (const name of CAPABILITY_VOCABULARY) capabilities[name] = granted.has(name);
  return { ok: true, capabilities };
}
