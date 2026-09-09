import { supabase } from '../lib/supabase.js';
import { normalizePhone } from '../utils/phone.js';

// ─────────────────────────────────────────────────────────────────────────
// provisionUser() — a thin, typed caller over ONE Postgres function.
//
// The work happens in supabase/migrations/20260909120000_provision_user.sql:
// the sign-in identity, the app_users row, the user_settings defaults, the
// user_capabilities grants and exactly one admin_audit entry, in one
// transaction. This file does NOT sequence those five writes. It must never
// grow a second call: a JavaScript sequence of PostgREST writes is not atomic,
// and a process that dies between call two and call three leaves a partial
// account that no try/catch can clean up. Bundle 42 pins this module to a
// single rpc() call, and its mutation harness proves that splitting the
// capability grant into a second call makes a partial account survive.
//
// WHAT THIS FILE DECIDES: nothing. Types and shape only.
//   • the actor is required — it is the acting admin, and the caller takes it
//     from the session token (req.appUser.id), never from a request body
//   • the phone is normalised to THE ONE TRUE FORMAT before it leaves
//   • capabilities must be an array of strings
// The vocabulary, the admin check, the uniqueness and the atomicity all live in
// the database, where they cannot be bypassed by a second caller.
// ─────────────────────────────────────────────────────────────────────────

export const PROVISION_RPC = 'provision_user';

/**
 * @param {object} input
 * @param {string} input.actorUserId   app_users.id of the ACTIVE ADMIN doing this (from the token)
 * @param {string} input.phone         any format; normalised to digits with country code
 * @param {string|null} [input.displayName]
 * @param {string[]} [input.capabilities]  names from the closed vocabulary; the DB decides
 * @param {string} [input.timezone]    IANA name; the DB default applies when omitted
 * @param {{ db?: { rpc: Function } }} [deps]  the service-role client (tests inject a fake)
 * @returns {Promise<{ user_id: string, auth_user_id: string, audit_id: string, phone: string, capabilities: string[] }>}
 */
export async function provisionUser(input = {}, { db = supabase } = {}) {
  const { actorUserId, phone, displayName = null, capabilities = [], timezone } = input;

  if (typeof actorUserId !== 'string' || actorUserId.trim() === '') {
    throw new Error(
      'provisionUser refused: actorUserId is required. It is the acting admin, taken from ' +
      'the session token (req.appUser.id) — never from a request body.');
  }
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new Error('provisionUser refused: a phone is required.');
  }
  if (!Array.isArray(capabilities) || capabilities.some((c) => typeof c !== 'string')) {
    throw new Error('provisionUser refused: capabilities must be an array of strings.');
  }
  if (displayName !== null && displayName !== undefined && typeof displayName !== 'string') {
    throw new Error('provisionUser refused: displayName must be a string when given.');
  }

  const args = {
    p_actor_user_id: actorUserId.trim(),
    p_phone: normalizedPhone,
    p_display_name: displayName == null ? null : displayName,
    p_capabilities: capabilities,
  };
  if (typeof timezone === 'string' && timezone.trim() !== '') args.p_timezone = timezone.trim();

  // ONE call. See the header for why there must never be a second.
  const { data, error } = await db.rpc(PROVISION_RPC, args);
  if (error) {
    // Lesson 1: the SQLSTATE and the constraint travel with the error, never
    // String(err). 23514 is the closed vocabulary; 23505 an existing account;
    // 42501 an actor who is not an active admin.
    const err = new Error(`provisionUser failed: ${error.message || 'rpc error'}`);
    err.code = error.code;
    err.details = error.details;
    err.hint = error.hint;
    throw err;
  }
  if (!data || typeof data.user_id !== 'string' || typeof data.auth_user_id !== 'string') {
    throw new Error('provisionUser: the RPC returned no user_id/auth_user_id — treat as not provisioned.');
  }
  return data;
}
