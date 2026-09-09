import { supabase } from '../../lib/supabase.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { decodeJwt } from '../../services/auth/jwt.js';
import { createSupabaseTokenVerifier } from '../../services/auth/verifier.js';
import { assessAssurance, authMethods, REQUIRED_AAL } from '../../services/auth/assurance.js';

// ─────────────────────────────────────────────────────────────────────────
// WEB AUTH (N3, hardened for A3.1) — the single choke point for every /api
// route. Supabase-JWT middleware; every /api router mounts it first.
//
// These routes are USER-facing (unlike routes/admin.js, which is founder
// tooling behind x-admin-key). Identity comes from the Supabase session JWT
// the web frontend holds:
//
//   Authorization: Bearer <supabase access_token>
//
// VERIFICATION IS DONE HERE, IN CODE (A3.1, 2026-09-09). The token's
// signature is checked against the project's published signing keys
// (ES256/RS256 via the JWKS endpoint, or HS256 via SUPABASE_JWT_SECRET for a
// legacy project), then expiry, issuer, audience, role and subject — see
// services/auth/jwt.js. Until 2026-09-09 this file delegated to
// auth.getUser(token). That returns the ACCOUNT, not the SESSION, so it
// cannot see whether a second factor was presented, and A3.1's requirement
// is exactly that a first-factor-only session is refused. The assurance
// level is a claim in the token, and a claim is only worth reading after the
// signature has been verified locally.
//
// MFA IS REQUIRED. The verified token's `aal` must be aal2 (a TOTP factor
// presented for THIS session). aal1 is refused with 401 and a reason. The
// policy is one function (services/auth/assurance.js) applied at one line
// below; Bundle 47 mutates that line and the suite goes red. Enabling TOTP
// enrolment in the Supabase dashboard is Emil's step and does NOT enforce
// anything by itself — this line does.
//
// The auth user is then mapped to the Cedrus account via
// app_users.auth_user_id (populated by the DB's
// link_or_create_app_user_from_auth trigger at web signup, or by
// provision_user() for an invited account).
//
// THE RULE THIS FILE EXISTS FOR: user identity is derived from the token,
// NEVER from the request. Handlers read req.appUser; any user_id a client
// puts in a body/path/query/header is ignored by construction. Combined with
// the per-user scoping every service applies (every query .eq('user_id', …),
// every CoS read through forUser()), a forged or foreign id can only ever
// behave as "not found".
//
// ── THE NON-JWT SEAM (test-only, refused in production) ──────────────────
// Suites written before A3.1 (web-api, interests, insights, reminders,
// contracts-goals, import, Bundle 41 §6/§8) fake supabase.auth.getUser and
// send opaque tokens like 'tok-a'. Those tokens are not JWTs. The seam keeps
// them exercising their routers: a bearer that does not even PARSE as a JWT
// is handed to auth.getUser. It is closed three ways, and Bundle 47 proves
// the first two:
//   1. under production it is refused outright (401, reason 'malformed');
//   2. it is announced in the log the first time it runs;
//   3. GoTrue itself parses every bearer as a JWT, so against a real project
//      an opaque token can never authenticate anyone even if NODE_ENV were
//      unset (Lesson 7's incident) — the seam can only ever pass a FAKE.
// It never applies to a real Supabase token: anything that parses as a JWT
// takes the verified path, unconditionally.
//
// Failure modes, fail-closed:
//   • missing/malformed header                                → 401 auth_required
//   • bad signature / expired / wrong issuer / wrong role …   → 401 auth_required + reason
//   • verified, but the session is first-factor only (aal1)   → 401 mfa_required + reason
//   • verified, but no linked app_users row                   → 403 no_linked_account
//   • verified, account_status not 'active'                   → 403 account_suspended
//   • signing keys unreachable / verifier broken              → 500 internal
//     (an outage must read as "try again", never as "bad login")
// No reason string and no log line ever carries the token.
// ─────────────────────────────────────────────────────────────────────────

const MSG_SIGN_IN = 'Sign in to keep going.';
const MSG_MFA = 'Finish the second sign-in step to keep going.';
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

function isoOrNull(sec) {
  return typeof sec === 'number' && Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : null;
}

/**
 * @param {object} deps
 * @param {object}   [deps.auth]       Supabase Auth client — the NON-JWT seam only (see header).
 * @param {object}   [deps.db]         Supabase service client for app_users.
 * @param {object}   [deps.verifier]   { verify(token) } from services/auth/verifier.js. Default: built
 *                                     from env on the first request (JWKS + optional HS256 secret).
 * @param {function} [deps.now]        () ⇒ epoch ms, for expiry.
 * @param {boolean}  [deps.production] Default config.isProduction. Closes the non-JWT seam.
 */
export function createRequireUser({
  auth, db = supabase, verifier = null, now = Date.now, production = config.isProduction,
  env = process.env, fetch = globalThis.fetch,
} = {}) {
  const gotrue = auth || supabase.auth;
  let tokenVerifier = verifier;
  let announcedVerifier = Boolean(verifier);
  let announcedSeam = false;

  // Built lazily so importing a router never touches the network; the JWKS is
  // fetched on the first real request and cached (services/auth/keys.js).
  function getVerifier() {
    if (!tokenVerifier) tokenVerifier = createSupabaseTokenVerifier({ env, fetch, now });
    if (!announcedVerifier) {
      announcedVerifier = true;
      const d = tokenVerifier.describe();
      logger.event('web.auth.verifier', {
        outcome: 'armed',
        message: `JWT verifier ARMED — ES256/RS256 via JWKS${d.jwks_url ? ' at ' + safeHost(d.jwks_url) : ''}: ${d.jwks ? 'on' : 'off'}; ` +
          `HS256 (SUPABASE_JWT_SECRET): ${d.hs256 ? 'on' : 'off'}; issuer ${d.issuer || 'unpinned'}; required assurance ${REQUIRED_AAL}`,
      });
    }
    return tokenVerifier;
  }

  return async function requireUser(req, res, next) {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(/\s+/);
    if (!token || !/^bearer$/i.test(scheme)) {
      logger.event('web.auth.rejected', {
        level: 'warn', error_category: 'auth', status_code: 401,
        message: 'missing or malformed Authorization header',
      });
      return res.status(401).json({ error: 'auth_required', reason: 'no_bearer', message: MSG_SIGN_IN });
    }

    let authUserId;
    let session;

    const decoded = decodeJwt(token);
    if (decoded) {
      // ── THE PRODUCTION PATH: every real Supabase access token is a JWT ──
      let verdict;
      try {
        verdict = await getVerifier().verify(token);
      } catch (err) {
        logger.event('web.auth.error', {
          level: 'error', error_category: 'internal', status_code: 500,
          message: `token verifier threw: ${err && err.message ? err.message : String(err)}`,
        });
        return res.status(500).json({ error: 'internal', message: MSG_TRY_AGAIN });
      }
      if (!verdict.ok) {
        if (verdict.reason === 'key_unavailable') {
          // Transport, not a bad token: the signing keys could not be fetched.
          logger.event('web.auth.error', {
            level: 'error', error_category: 'upstream', status_code: 500,
            message: 'signing keys unavailable (JWKS fetch failed) — refusing with 500, not 401',
          });
          return res.status(500).json({ error: 'internal', message: MSG_TRY_AGAIN });
        }
        logger.event('web.auth.rejected', {
          level: 'warn', error_category: 'auth', status_code: 401,
          message: `token rejected: ${verdict.reason}`, // the reason category, never the token
        });
        return res.status(401).json({ error: 'auth_required', reason: verdict.reason, message: MSG_SIGN_IN });
      }

      // ── MFA REQUIRED. The line Bundle 47 mutates. ─────────────────────
      const assurance = assessAssurance(verdict.claims);
      if (!assurance.ok) {
        logger.event('web.auth.rejected', {
          level: 'warn', error_category: 'auth', status_code: 401,
          message: `session assurance is ${assurance.aal === null ? 'absent' : assurance.aal}; ${REQUIRED_AAL} is required (${assurance.reason})`,
        });
        return res.status(401).json({ error: 'mfa_required', reason: assurance.reason, message: MSG_MFA });
      }

      authUserId = verdict.claims.sub;
      session = {
        aal: assurance.aal,
        methods: authMethods(verdict.claims),
        issued_at: isoOrNull(verdict.claims.iat),
        expires_at: isoOrNull(verdict.claims.exp),
        session_id: typeof verdict.claims.session_id === 'string' ? verdict.claims.session_id : null,
        verified_by: 'jwt',
      };
    } else {
      // ── NOT A JWT: the pre-A3.1 seam (header). Closed in production. ─────
      if (production) {
        logger.event('web.auth.rejected', {
          level: 'warn', error_category: 'auth', status_code: 401,
          message: 'bearer token is not a JWT — refused (the non-JWT seam is closed in production)',
        });
        return res.status(401).json({ error: 'auth_required', reason: 'malformed', message: MSG_SIGN_IN });
      }
      if (!announcedSeam) {
        announcedSeam = true;
        logger.event('web.auth.seam', {
          level: 'warn', outcome: 'gotrue_seam',
          message: 'non-JWT bearer delegated to auth.getUser — the pre-A3.1 test seam (no assurance check). ' +
            'Refused outright in production; announced once per middleware instance.',
        });
      }
      let authUser;
      try {
        const { data, error } = await gotrue.getUser(token);
        if (error || !data || !data.user) {
          logger.event('web.auth.rejected', {
            level: 'warn', error_category: 'auth', status_code: 401,
            message: 'token rejected by Supabase Auth', // never the token itself
          });
          return res.status(401).json({ error: 'auth_required', reason: 'rejected_by_auth', message: MSG_SIGN_IN });
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
      authUserId = authUser.id;
      session = { aal: null, methods: [], issued_at: null, expires_at: null, session_id: null, verified_by: 'gotrue_seam' };
    }

    const { data: appUser, error: lookupErr } = await db
      .from('app_users').select('*').eq('auth_user_id', authUserId).maybeSingle();
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
    // Applied on EVERY route, aal2 or not (proof A6).
    if (!isAccountActive(appUser)) {
      logger.event('web.auth.rejected', {
        level: 'warn', error_category: 'auth', status_code: 403,
        user_ref: 'u_' + appUser.id,
        message: `account_status is '${appUser.account_status}' — refusing every request for this account`,
      });
      return res.status(403).json({ error: 'account_suspended', message: MSG_SUSPENDED });
    }

    req.appUser = appUser;      // identity for every downstream handler
    req.authUserId = authUserId;
    req.authSession = session;  // what the token said about THIS session (aal, methods, expiry)
    next();
  };
}

function safeHost(url) {
  try { return new URL(url).host; } catch { return 'unparseable-url'; }
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
