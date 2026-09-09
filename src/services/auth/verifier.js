// ─────────────────────────────────────────────────────────────────────────────
// The token verifier the choke point calls: keys + issuer + clock, bound once.
//
// Two constructors:
//
//   createTokenVerifier({ hmacSecret, jwks, issuer, audience, now })
//     The DI form. `jwks` is an ARRAY of JWKs (the suite generates a P-256
//     pair and hands the public half in) or a resolver object from keys.js.
//     `hmacSecret` is the HS256 secret (the suite's throwaway one). Nothing
//     here reads process.env.
//
//   createSupabaseTokenVerifier({ env, fetch, now })
//     The production form: JWKS from <SUPABASE_URL>/auth/v1/.well-known/
//     jwks.json, issuer <SUPABASE_URL>/auth/v1, and — only if
//     SUPABASE_JWT_SECRET is set — HS256 for a project still on the legacy
//     shared secret. The Cedrus project signs ES256 today, so the secret is
//     OPTIONAL and its absence is not a misconfiguration; describe() says
//     which paths are live so the boot line can announce them (Lesson 7).
//
// verify(token) never throws for a bad token. It throws only if the
// underlying verifier itself is broken, which the choke point reports as a
// 500. A key-fetch failure is not a throw either: it is { ok:false,
// reason:'key_unavailable' }, which the choke point maps to 500 as well —
// an outage must never read as a bad login.
// ─────────────────────────────────────────────────────────────────────────────

import { verifyJwt, USER_AUDIENCE } from './jwt.js';
import { createJwksSource, selectJwk, jwksUrlFor, issuerFor } from './keys.js';

export function createTokenVerifier({
  hmacSecret = null, jwks = null, issuer = null, audience = USER_AUDIENCE, now = Date.now,
} = {}) {
  let resolveJwk = null;
  if (Array.isArray(jwks)) {
    const fixed = jwks.slice();
    resolveJwk = async (kid, alg) => selectJwk(fixed, kid, alg);
  } else if (jwks && typeof jwks.resolve === 'function') {
    resolveJwk = (kid, alg) => jwks.resolve(kid, alg);
  }
  const secret = typeof hmacSecret === 'string' && hmacSecret.length > 0 ? hmacSecret : null;
  if (!secret && !resolveJwk) {
    throw new Error('createTokenVerifier: no verification key — supply hmacSecret (HS256) and/or jwks (ES256/RS256)');
  }
  return {
    verify(token) {
      return verifyJwt(token, { hmacSecret: secret, resolveJwk, issuer, audience, now });
    },
    describe() {
      return {
        hs256: Boolean(secret),
        jwks: Boolean(resolveJwk),
        jwks_url: jwks && typeof jwks.url === 'string' ? jwks.url : null,
        issuer,
        audience,
      };
    },
  };
}

export function createSupabaseTokenVerifier({ env = process.env, fetch = globalThis.fetch, now = Date.now } = {}) {
  const url = (env.SUPABASE_URL || '').trim();
  const jwks = createJwksSource({ url: jwksUrlFor(url), fetch, now });
  const hmacSecret = (env.SUPABASE_JWT_SECRET || '').trim() || null;
  return createTokenVerifier({ hmacSecret, jwks, issuer: issuerFor(url), now });
}
