import { supabase } from '../../lib/supabase.js';

// ─────────────────────────────────────────────────────────────────────────
// publishProgramRevision() — a thin, typed caller over ONE Postgres function.
//
// The work happens in supabase/migrations/20260909180000_programs_foundation.sql:
// find-or-create the program, store the source verbatim with its hash, write
// every item at planned, move current_revision_id — in one transaction. This
// file does NOT sequence those writes and must never grow a second call: a
// JavaScript sequence of PostgREST writes is not atomic (the P1.2 lesson).
//
// WHAT THIS FILE DECIDES: nothing. Types and shape only.
//   • the owner is required; the caller supplies it (the load script's
//     --user-id, or the backend from the session token), never a request body
//   • the compiled shape from compile.js is passed through as-is; the
//     database checks the category union, the dates and the uniqueness
// ─────────────────────────────────────────────────────────────────────────

export const PUBLISH_RPC = 'publish_program_revision';

/**
 * @param {ReturnType<import('./compile.js').compileSource>} compiled
 * @param {{ userId: string, db?: { rpc: Function } }} opts
 * @returns {Promise<{ program_id, revision_id, revision_number, supersedes_revision_id, source_sha256, items }>}
 */
export async function publishProgramRevision(compiled, { userId, db = supabase } = {}) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('publishProgramRevision refused: userId (the owner\'s app_users.id) is required.');
  }
  if (!compiled || !compiled.program || !Array.isArray(compiled.items) || !compiled.source) {
    throw new Error('publishProgramRevision refused: pass the output of compileSource().');
  }
  const { program, items, source } = compiled;
  const args = {
    p_user_id: userId.trim(),
    p_kind: program.kind,
    p_title: program.title,
    p_description: program.description ?? null,
    p_start_date: program.start_date,
    p_end_date: program.end_date ?? null,
    p_time_zone: program.time_zone,
    p_source_name: source.name,
    p_source_text: source.text,
    // Planned fields only. There is no actual field here to pass, and the
    // function would ignore one anyway.
    p_items: items.map((i) => ({
      item_key: i.item_key,
      scheduled_date: i.scheduled_date,
      category: i.category,
      title: i.title,
      instructions: i.instructions ?? null,
      planned_start_local: i.planned_start_local ?? null,
      planned_duration_minutes: i.planned_duration_minutes ?? null,
      source_locator: i.source_locator ?? null,
    })),
  };

  // ONE call.
  const { data, error } = await db.rpc(PUBLISH_RPC, args);
  if (error) {
    // Lesson 1: the SQLSTATE travels with the error. 23505 is "this exact
    // source is already published" — the constraint's answer, not a pre-check.
    const err = new Error(`publishProgramRevision failed: ${error.message || 'rpc error'}`);
    err.code = error.code;
    err.details = error.details;
    err.hint = error.hint;
    err.alreadyPublished = error.code === '23505';
    throw err;
  }
  if (!data || typeof data.revision_id !== 'string' || typeof data.program_id !== 'string') {
    throw new Error('publishProgramRevision: the RPC returned no revision_id/program_id — treat as not published.');
  }
  return data;
}
