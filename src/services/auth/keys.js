// ─────────────────────────────────────────────────────────────────────────────
// Where the verification keys come from.
//
// Supabase publishes the project's signing keys at
//   <SUPABASE_URL>/auth/v1/.well-known/jwks.json
// with no credential required. The Cedrus project served exactly one ES256
// (P-256) key there on 2026-09-09. The document is fetched lazily on the
// first request, cached, refreshed after `ttlMs`, and refreshed ONCE early
// when a token names a `kid` the cache does not hold — that is what makes a
// key rotation land without a redeploy. The early refresh is rate-limited by
// `refreshCooldownMs` so a stream of tokens with random kids cannot turn this
// server into a JWKS-fetching loop.
//
// A fetch failure THROWS from resolve(). The verifier maps that to
// `key_unavailable`, and the choke point answers 500, not 401: an outage
// must read as "try again", never as "bad login" — the same rule the
// pre-A3.1 middleware stated for a GoTrue outage.
//
// `fetch` and `now` are injectable so the suite can drive every path without
// the network. No process.env in this file.
// ─────────────────────────────────────────────────────────────────────────────

export const JWKS_PATH = '/auth/v1/.well-known/jwks.json';
export const JWKS_TTL_MS = 10 * 60_000;
export const JWKS_REFRESH_COOLDOWN_MS = 60_000;

/** The JWKS URL for a Supabase project URL. Trailing slash tolerated. */
export function jwksUrlFor(supabaseUrl) {
  const base = String(supabaseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('jwksUrlFor: SUPABASE_URL is required to know which project signs the tokens');
  return base + JWKS_PATH;
}

/** The `iss` claim Supabase Auth stamps for a project. */
export function issuerFor(supabaseUrl) {
  const base = String(supabaseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('issuerFor: SUPABASE_URL is required to know which issuer to accept');
  return base + '/auth/v1';
}

/**
 * Pick the key a token names. `kid` may be null (some issuers omit it); then
 * the match is by algorithm alone and must be UNIQUE — two candidate keys and
 * no kid is ambiguous, and ambiguity is refused rather than guessed.
 */
export function selectJwk(keys, kid, alg) {
  const candidates = (Array.isArray(keys) ? keys : []).filter((k) =>
    k && typeof k === 'object' &&
    (k.use === undefined || k.use === 'sig') &&
    (k.alg === undefined || k.alg === alg) &&
    (kid === null || kid === undefined ? true : k.kid === kid));
  if (kid !== null && kid !== undefined) return candidates[0] || null;
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * A caching JWKS resolver. Returns { resolve(kid, alg), state() }.
 */
export function createJwksSource({
  url, fetch = globalThis.fetch, ttlMs = JWKS_TTL_MS, refreshCooldownMs = JWKS_REFRESH_COOLDOWN_MS, now = Date.now,
} = {}) {
  if (typeof url !== 'string' || url.trim() === '') throw new Error('createJwksSource: url is required');
  if (typeof fetch !== 'function') throw new Error('createJwksSource: a fetch implementation is required');

  let keys = null;
  let fetchedAt = -Infinity;
  let lastEarlyRefreshAt = -Infinity;
  let inflight = null;
  let fetches = 0;

  async function load() {
    if (inflight) return inflight;
    inflight = (async () => {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res || !res.ok) throw new Error(`JWKS fetch failed: HTTP ${res ? res.status : 'no response'}`);
      const doc = await res.json();
      if (!doc || !Array.isArray(doc.keys)) throw new Error('JWKS document carries no `keys` array');
      keys = doc.keys;
      fetchedAt = now();
      fetches += 1;
    })();
    try { await inflight; } finally { inflight = null; }
  }

  async function resolve(kid, alg) {
    if (keys === null || now() - fetchedAt > ttlMs) await load();
    let jwk = selectJwk(keys, kid, alg);
    if (!jwk && now() - lastEarlyRefreshAt > refreshCooldownMs) {
      lastEarlyRefreshAt = now();
      await load();
      jwk = selectJwk(keys, kid, alg);
    }
    return jwk || null;
  }

  return {
    resolve,
    url,
    /** Introspection for the suite and the boot announcement. Never the keys' private parts (there are none). */
    state() { return { loaded: keys !== null, keyCount: keys ? keys.length : 0, fetchedAt, fetches }; },
  };
}
