import { supabase } from '../../lib/supabase.js';
import { logger } from '../../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────
// WEB AUTH (N3) — Supabase-JWT middleware for every /api route.
//
// These routes are USER-facing (unlike routes/admin.js, which is founder
// tooling behind x-admin-key). Identity comes from the Supabase session JWT
// the web frontend already holds:
//
//   Authorization: Bearer <supabase access_token>
//
// Verification is delegated to Supabase Auth itself (auth.getUser(token)) —
// GoTrue checks signature, expiry, and revocation server-side, so this
// backend never handles the JWT secret and key rotation can't strand us.
// The auth user is then mapped to the Cedrus account via
// app_users.auth_user_id (populated by the DB's
// link_or_create_app_user_from_auth trigger at web signup).
//
// THE RULE THIS FILE EXISTS FOR: user identity is derived from the token,
// NEVER from the request. Handlers read req.appUser; any user_id a client
// puts in a body/path/query is ignored by construction. Combined with the
// people-service ownership guard (every query .eq('user_id', …)), a forged
// or foreign id can only ever behave as "not found".
//
// Failure modes, fail-closed:
//   • missing/malformed header, invalid/expired/forged token → 401
//   • valid token but no linked app_users row               → 403
//   • Supabase Auth unreachable (network/outage)            → 500
//     (an outage must read as "try again", never as "bad login")
// ─────────────────────────────────────────────────────────────────────────

const MSG_SIGN_IN = 'Sign in to keep going.';
const MSG_NO_ACCOUNT = "This login isn't connected to a Cedrus account yet.";
const MSG_TRY_AGAIN = 'Something went wrong on my end. Try that again in a moment.';
const MSG_SUSPENDED = 'This account is not active right now.';
const MSG_NOT_ALLOWED = "You don't have access to that.";

/**
 * Is this account allowed to act at all?
 *
 * Three states, and the middle one is the reason this is a function rather
 * than `=== 'active'` inline:
 *
 *   • 'active'            → yes
 *   • 'suspended', or any unrecognised value → NO. An unknown status is wrong
 *     data, and wrong data fails closed.
 *   • absent (undefined/null) → yes, deliberately.
 *
 * The absent case is the one that needs justifying. `account_status` arrives in
 * the 2026-08-30 migration. Law 11 says schema ships before the code that
 * depends on it, so on a correct deploy the column is always there. But if this
 * code ever reaches production first, failing closed on an absent column locks
 * every user out of the whole API, while failing open reproduces exactly
 * today's behaviour — a system in which no one is suspended, which is factually
 * what an unapplied migration means.
 *
 * That is not a general licence to fail open. It is scoped to "the column does
 * not exist yet", and a PRESENT-but-unrecognised value is still refused.
 */
export function isAccountActive(appUser) {
  const status = appUser ? appUser.account_status : undefined;
  if (status === undefined || status === null) return true;
  return status === 'active';
}

export function createRequireUser({ auth = supabase.auth, db = supabase } = {}) {
  return async function requireUser(req, res, next) {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(/\s+/);
    if (!token || !/^bearer$/i.test(scheme)) {
      logger.event('web.auth.rejected', {
        level: 'warn', error_category: 'auth', status_code: 401,
        message: 'missing or malformed Authorization header',
      });
      return res.status(401).json({ error: 'auth_required', message: MSG_SIGN_IN });
    }

    let authUser;
    try {
      const { data, error } = await auth.getUser(token);
      if (error || !data || !data.user) {
        logger.event('web.auth.rejected', {
          level: 'warn', error_category: 'auth', status_code: 401,
          message: 'token rejected by Supabase Auth', // never the token itself
        });
        return res.status(401).json({ error: 'auth_required', message: MSG_SIGN_IN });
      }
      authUser = data.user;
    } catch (err) {
      // A thrown error is transport-level (Auth unreachable), not a bad token.
      logger.event('web.auth.error', {
        level: 'error', error_category: 'internal', status_code: 500,
        message: err && err.message ? err.message : String(err),
      });
      return res.status(500).json({ error: 'internal', message: MSG_TRY_AGAIN });
    }

    const { data: appUser, error: lookupErr } = await db
      .from('app_users').select('*').eq('auth_user_id', authUser.id).maybeSingle();
    if (lookupErr) {
      logger.event('web.auth.error', {
        level: 'error', error_category: 'db_error', status_code: 500,
        message: lookupErr.message || 'app_users lookup failed',
      });
      return res.status(500).json({ error: 'internal', message: MSG_TRY_AGAIN });
    }
    if (!appUser) {
      logger.event('web.auth.rejected', {
        level: 'warn', error_category: 'auth', status_code: 403,
        message: 'valid token with no linked app_users row',
      });
      return res.status(403).json({ error: 'no_linked_account', message: MSG_NO_ACCOUNT });
    }

    // A valid token for a suspended account is still a valid token. Revocation
    // has to happen HERE, on the account, or the only way to remove someone's
    // access is to delete their auth user — which destroys the audit trail of
    // who they were. 403, not 401: the login worked, the account is closed.
    if (!isAccountActive(appUser)) {
      logger.event('web.auth.rejected', {
        level: 'warn', error_category: 'auth', status_code: 403,
        user_ref: 'u_' + appUser.id,
        message: `account_status is '${appUser.account_status}' — refusing every request for this account`,
      });
      return res.status(403).json({ error: 'account_suspended', message: MSG_SUSPENDED });
    }

    req.appUser = appUser;      // identity for every downstream handler
    req.authUserId = authUser.id;
    next();
  };
}

/**
 * Gate a route on one capability from the closed vocabulary in
 * `user_capabilities`.
 *
 * FAILS CLOSED IN ALL THREE DIRECTIONS, which is the whole point:
 *
 *   • no row for (user, capability)  → refused. An absent grant and
 *     `granted = false` mean the same thing; a capability nobody ever granted
 *     must never read as permitted.
 *   • granted = false                → refused.
 *   • the read itself errored        → refused, at error level. supabase-js
 *     RESOLVES `{ data, error }` rather than throwing (the single most
 *     load-bearing fact in this codebase), so an unbound `error` here would
 *     surface as `data: null`, which is indistinguishable from "not granted" —
 *     the right answer by accident, and only until someone "helpfully" defaults
 *     a null read to true. It is bound and announced explicitly.
 *
 * Mounted AFTER requireUser, so req.appUser is present and already known to be
 * an active account.
 */
export function requireCapability(capability, { db = supabase } = {}) {
  return async function capabilityGate(req, res, next) {
    const user = req.appUser;
    if (!user) {
      // Programming error: this middleware was mounted before requireUser.
      // Refuse rather than read capabilities for nobody.
      logger.event('web.capability.misconfigured', {
        level: 'error', error_category: 'internal', status_code: 500,
        message: `requireCapability('${capability}') ran with no req.appUser — mount it after requireUser`,
      });
      return res.status(500).json({ error: 'internal', message: MSG_TRY_AGAIN });
    }

    const { data, error } = await db
      .from('user_capabilities')
      .select('granted')
      .eq('user_id', user.id)
      .eq('capability', capability)
      .maybeSingle();

    if (error) {
      logger.event('web.capability.error', {
        level: 'error', error_category: 'db_error', status_code: 403,
        user_ref: 'u_' + user.id,
        message: `could not read capability '${capability}': ${error.message || String(error)} — refusing`,
      });
      return res.status(403).json({ error: 'not_permitted', message: MSG_NOT_ALLOWED });
    }

    if (!data || data.granted !== true) {
      logger.event('web.capability.refused', {
        level: 'warn', error_category: 'auth', status_code: 403,
        user_ref: 'u_' + user.id,
        message: `capability '${capability}' is not granted`,
      });
      return res.status(403).json({ error: 'not_permitted', message: MSG_NOT_ALLOWED });
    }

    next();
  };
}
