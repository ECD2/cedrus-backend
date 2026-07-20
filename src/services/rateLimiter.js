// ─────────────────────────────────────────────────────────────────────────
// In-memory sliding-window rate limiter (web onboarding abuse guard)
//
// The public POST /api/onboard/start endpoint can be hit by anyone, so it is
// rate-limited per source IP and per submitted phone (the brief: "rate-limit
// per IP and per phone"). This is a process-local limiter: a Map of key ->
// recent hit timestamps, pruned to the window on each access.
//
// LIMITATION (flagged in docs/MOUNT_WEBONBOARD.md): process-local means the
// counters reset on deploy/restart and are NOT shared across multiple Railway
// instances. For a single instance (current deploy shape) it is a real guard;
// for horizontal scale it must move to a shared store (a Postgres table keyed
// by (kind, key, window) or Redis). The endpoint's other defenses — only
// texting numbers with no history, never revealing account existence — do not
// depend on this limiter.
//
// The clock is injectable (`now`) so tests are deterministic; production passes
// the default Date.now.
// ─────────────────────────────────────────────────────────────────────────

export function createRateLimiter({ windowMs, max, now = () => Date.now(), maxKeys = 10000 }) {
  if (!(windowMs > 0) || !(max > 0)) {
    throw new Error('createRateLimiter: windowMs and max must be positive');
  }
  const hits = new Map(); // key -> number[] (ascending timestamps within window)

  function prune(key, cutoff) {
    const arr = hits.get(key);
    if (!arr) return null;
    // Timestamps are pushed in order, so drop from the front while stale.
    let i = 0;
    while (i < arr.length && arr[i] <= cutoff) i++;
    if (i > 0) arr.splice(0, i);
    if (arr.length === 0) { hits.delete(key); return null; }
    return arr;
  }

  // Opportunistic sweep so a flood of distinct keys (e.g. random spoofed IPs)
  // can't grow the Map without bound: when we exceed maxKeys, drop every key
  // whose window has fully expired.
  function sweep(cutoff) {
    if (hits.size <= maxKeys) return;
    for (const key of hits.keys()) prune(key, cutoff);
  }

  return {
    // Record an attempt for `key` and report whether it is allowed. Counting
    // the attempt even when denied means a sustained hammer stays blocked
    // rather than getting a free hit each time the window edge passes.
    check(key) {
      const t = now();
      const cutoff = t - windowMs;
      sweep(cutoff);
      const arr = prune(key, cutoff) || [];
      const allowed = arr.length < max;
      arr.push(t);
      if (!hits.has(key)) hits.set(key, arr);
      const retryAfterMs = allowed ? 0 : Math.max(0, arr[0] - cutoff);
      return { allowed, remaining: Math.max(0, max - arr.length), retryAfterMs };
    },
    // Test/introspection helpers.
    _size() { return hits.size; },
    _reset() { hits.clear(); },
  };
}
