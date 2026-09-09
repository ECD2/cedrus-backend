// ─────────────────────────────────────────────────────────────────────────────
// Who the caller is in every id space the Engine uses — resolved from the
// VERIFIED SESSION and nothing else.
//
// Three id spaces meet at an /api/interface request:
//   auth.users.id      the sign-in identity (the token's `sub`)
//   app_users.id       the Cedrus account   (req.appUser, linked by auth_user_id)
//   user_settings.cos_user_id
//                      the same person INSIDE the Chief of Staff project — a
//                      DIFFERENT id space; the migration comment says so and
//                      this module never assumes they match.
//
// The CoS id comes from the person's own user_settings row, read with an
// explicit `.eq('user_id', appUser.id)`. There is deliberately NO fallback to
// COS_USER_ID or COS_BRIEF_USAGE_USER_ID: those name ONE person for the whole
// process, and an API that fell back to them would hand that person's
// workspace to whoever else signed in. A person with no row, or a row with no
// cos_user_id, is reported as unlinked — honestly, not silently as empty.
//
// This is the line Bundle 47 mutates to prove /workspace is scoped: drop the
// `.eq('user_id', …)` and user B receives user A's row, and user A's rows.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from '../../config.js';

export const SETTINGS_COLUMNS = Object.freeze([
  'user_id', 'brief_email', 'brief_enabled', 'brief_hour_utc', 'cos_user_id', 'usage_user_id', 'timezone',
]);

/**
 * @returns {Promise<{ok:true, appUserId:string, cosUserId:string|null, settings:object|null, timezone:string}
 *                  | {ok:false, appUserId:string, error:object}>}
 */
export async function resolveCallerScope({ appUser, db } = {}) {
  if (!appUser || typeof appUser.id !== 'string' || appUser.id.trim() === '') {
    throw new Error('resolveCallerScope refused: req.appUser is required — scope comes from the verified session, never from the request');
  }
  const appUserId = appUser.id;
  const { data, error } = await db
    .from('user_settings')
    .select(SETTINGS_COLUMNS.join(', '))
    .eq('user_id', appUserId)
    .maybeSingle();
  if (error) return { ok: false, appUserId, error };
  const settings = data || null;
  const cosUserId = settings && typeof settings.cos_user_id === 'string' && settings.cos_user_id.trim() !== ''
    ? settings.cos_user_id.trim()
    : null;
  const timezone = (settings && settings.timezone) || appUser.timezone || config.defaultTimezone;
  return { ok: true, appUserId, cosUserId, settings, timezone };
}
