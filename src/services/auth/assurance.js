// ─────────────────────────────────────────────────────────────────────────────
// The second-factor policy (A3.1): MFA IS REQUIRED.
//
// Supabase stamps every access token with an authenticator assurance level:
//   aal1  the first factor only (password, magic link, OTP)
//   aal2  a second factor was presented for THIS session (TOTP)
//
// This module says whether a verified token's assurance level is enough. It
// is a pure function over the claims so the policy is one line long, lives in
// one place, and can be mutation-tested: delete the check in the choke point
// and Bundle 47 goes red.
//
// ENFORCED IN CODE, NOT IN THE DASHBOARD. The Supabase dashboard has a toggle
// that lets people ENROL a TOTP factor; it does not make a factor REQUIRED.
// Requiring it is this file plus the choke point. Enabling enrolment is
// Emil's dashboard step and is listed in the session report.
//
// FAILS CLOSED. A token with no `aal` claim at all — which no Supabase token
// lacks, but which a future issuer might — is refused with its own reason,
// so "the claim was missing" is never mistaken for "the claim said aal1".
// ─────────────────────────────────────────────────────────────────────────────

export const REQUIRED_AAL = 'aal2';
export const KNOWN_AALS = Object.freeze(['aal1', 'aal2']);

/**
 * @returns {{ok:true, aal:string} | {ok:false, aal:string|null, reason:'aal2_required'|'aal_missing'|'aal_unknown'}}
 */
export function assessAssurance(claims) {
  const aal = claims && typeof claims.aal === 'string' ? claims.aal : null;
  if (aal === REQUIRED_AAL) return { ok: true, aal };
  if (aal === null) return { ok: false, aal, reason: 'aal_missing' };
  if (KNOWN_AALS.includes(aal)) return { ok: false, aal, reason: 'aal2_required' };
  return { ok: false, aal, reason: 'aal_unknown' };
}

/** The sign-in methods a token records, in order. `amr` is [{method, timestamp}]. */
export function authMethods(claims) {
  const amr = claims && Array.isArray(claims.amr) ? claims.amr : [];
  return amr.map((m) => (m && typeof m.method === 'string' ? m.method : null)).filter(Boolean);
}
