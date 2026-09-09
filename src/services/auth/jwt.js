// ─────────────────────────────────────────────────────────────────────────────
// JWT verification, in code (A3.1).
//
// A Supabase access token is a JWS: base64url(header).base64url(payload).
// base64url(signature). This module decodes one and verifies it against a key
// the CALLER supplies — never against anything in the token. It is pure: no
// network, no process.env, no logger, so the suite can drive every branch
// with a synthetic key and a fake clock (Bundle 47).
//
// WHY LOCAL VERIFICATION RATHER THAN auth.getUser(token)
// The choke point used to hand the token to Supabase Auth and trust the
// answer. GoTrue's /user endpoint returns the account, not the session, so it
// cannot say whether the SECOND factor was presented — and A3.1's whole
// requirement is that a first-factor-only session is refused. The assurance
// level lives in the token's `aal` claim, and reading a claim is only honest
// after the signature has been checked here. So: signature, expiry, issuer,
// audience, role and subject are all verified in this file; the assurance
// policy sits one level up (assurance.js) and the choke point applies it.
//
// THE THREE ALGORITHMS, AND WHY THERE IS NO 'none'
//   ES256  what the Cedrus project signs with today (its JWKS carries one
//          P-256 key — read on 2026-09-09 from the public
//          /auth/v1/.well-known/jwks.json, no credential needed).
//   RS256  the other asymmetric option Supabase offers; supported so a key
//          rotation to RSA does not lock everyone out.
//   HS256  the legacy shared-secret scheme, AND the test scheme: the suite
//          signs with a throwaway secret through the DI seam. Verifying HS256
//          requires an explicitly configured secret. A JWK from the key set is
//          NEVER used as an HMAC secret — that is the classic algorithm-
//          confusion attack, and it is unexpressible here because the HMAC
//          path reads only `hmacSecret`, never the resolver.
//   'none' and everything else → unsupported_alg. Refused, never "skipped".
//
// REASONS NEVER CARRY THE TOKEN. Every failure is a short category string; the
// token, its claims and its signature appear in no result and no error. The
// choke point puts the reason in the 401 body, so this is a contract, not a
// courtesy.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

export const SUPPORTED_ALGS = Object.freeze(['ES256', 'RS256', 'HS256']);

/** The audience and role Supabase stamps on a signed-in USER's token. */
export const USER_AUDIENCE = 'authenticated';
export const USER_ROLE = 'authenticated';

const B64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '==='.slice((s.length + 3) % 4), 'base64');
}

/**
 * Split and parse a compact JWS. Returns null for anything that is not one:
 * wrong number of segments, non-base64url characters, or a header/payload
 * that is not a JSON object. NO verification happens here — the caller must
 * treat the payload as untrusted until verifyJwt says otherwise.
 *
 * Null is the answer for an opaque (non-JWT) bearer token, and the choke
 * point uses that to tell a Supabase session apart from the pre-A3.1 test
 * seam. It deliberately does not throw: "not a JWT" is a classification, not
 * an error.
 */
export function decodeJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  if (!parts.every((p) => p.length > 0 && B64URL.test(p))) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(header) || !isObject(payload)) return null;
  return {
    header,
    payload,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: b64urlDecode(parts[2]),
  };
}

function isObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

function timingSafeBufEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Verify signature, then claims.
 *
 * @param {string} token
 * @param {object} opts
 * @param {string|null}   opts.hmacSecret  HS256 secret. Null ⇒ HS256 tokens are refused (no_key_for_alg).
 * @param {function|null} opts.resolveJwk  async (kid, alg) ⇒ JWK | null, for ES256/RS256. Null ⇒ refused (no_key_for_alg).
 *                                         A THROW from the resolver is a transport failure (key_unavailable), not a bad token.
 * @param {string|null}   opts.issuer      Required `iss` when set.
 * @param {string}        opts.audience    Required `aud` (string or member of the array). Default 'authenticated'.
 * @param {function}      opts.now         () ⇒ epoch milliseconds.
 * @returns {Promise<{ok:true, claims:object, header:object} | {ok:false, reason:string}>}
 *
 * reason ∈ malformed | unsupported_alg | no_key_for_alg | unknown_key | key_unavailable
 *        | bad_signature | no_expiry | expired | not_yet_valid | bad_issuer | bad_audience
 *        | bad_role | no_subject
 */
export async function verifyJwt(token, {
  hmacSecret = null, resolveJwk = null, issuer = null, audience = USER_AUDIENCE, now = Date.now,
} = {}) {
  const decoded = decodeJwt(token);
  if (!decoded) return { ok: false, reason: 'malformed' };
  const { header, payload, signingInput, signature } = decoded;

  const alg = typeof header.alg === 'string' ? header.alg : '';
  if (!SUPPORTED_ALGS.includes(alg)) return { ok: false, reason: 'unsupported_alg' };

  // ── signature FIRST. Nothing below reads a claim until this has passed ────
  if (alg === 'HS256') {
    if (typeof hmacSecret !== 'string' || hmacSecret.length === 0) return { ok: false, reason: 'no_key_for_alg' };
    const expected = crypto.createHmac('sha256', hmacSecret).update(signingInput).digest();
    if (!timingSafeBufEqual(signature, expected)) return { ok: false, reason: 'bad_signature' };
  } else {
    if (typeof resolveJwk !== 'function') return { ok: false, reason: 'no_key_for_alg' };
    let jwk;
    try {
      jwk = await resolveJwk(typeof header.kid === 'string' ? header.kid : null, alg);
    } catch {
      return { ok: false, reason: 'key_unavailable' };
    }
    if (!jwk) return { ok: false, reason: 'unknown_key' };
    let verified = false;
    try {
      const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      if (alg === 'ES256') {
        if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') return { ok: false, reason: 'unknown_key' };
        // JWS ES256 signatures are the raw r||s concatenation, not DER.
        verified = crypto.verify('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' }, signature);
      } else {
        if (jwk.kty !== 'RSA') return { ok: false, reason: 'unknown_key' };
        verified = crypto.verify('sha256', Buffer.from(signingInput), key, signature);
      }
    } catch {
      verified = false;
    }
    if (!verified) return { ok: false, reason: 'bad_signature' };
  }

  // ── claims, only now ──────────────────────────────────────────────────────
  const nowSec = Math.floor(now() / 1000);
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return { ok: false, reason: 'no_expiry' };
  if (nowSec >= payload.exp) return { ok: false, reason: 'expired' };
  if (typeof payload.nbf === 'number' && nowSec < payload.nbf) return { ok: false, reason: 'not_yet_valid' };
  if (issuer !== null && payload.iss !== issuer) return { ok: false, reason: 'bad_issuer' };
  const aud = payload.aud;
  const audOk = Array.isArray(aud) ? aud.includes(audience) : aud === audience;
  if (!audOk) return { ok: false, reason: 'bad_audience' };
  // A service_role or anon key is ALSO a JWT signed by the same project. It
  // must never pass as a person: it has no subject and its role is not
  // 'authenticated'. Checked explicitly rather than left to the sub check.
  if (payload.role !== USER_ROLE) return { ok: false, reason: 'bad_role' };
  if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) return { ok: false, reason: 'no_subject' };

  return { ok: true, claims: payload, header };
}
