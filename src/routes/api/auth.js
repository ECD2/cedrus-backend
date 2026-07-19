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

    req.appUser = appUser;      // identity for every downstream handler
    req.authUserId = authUser.id;
    next();
  };
}
