// ─────────────────────────────────────────────────────────────────────────────
// IMPORT JOB STORE (NF2-IMPORT) — in-memory, per-user, TTL'd, single-confirm.
//
// Deliberately in-memory (a Map), exactly like the capture proposal store
// (services/capture.js): an unconfirmed import preview must leave no durable
// trace, and single-instance Railway makes process memory a correct v1 home.
// The technical design's `ingested_items.entity_json` hold is the durable
// version of this; no such table exists in the live schema tonight and the
// fleet rules forbid hosted-DB changes, so previews live here and the
// consequences are documented in docs/IMPORT_CONTRACT.md: previews die on
// deploy/restart (the client re-uploads — parsing is free and idempotent),
// and they expire after ttlMs (7 days, per privacy recommendation P-05 that
// unacted previews must not live forever).
//
// Confirm-safety: takeForConfirm() flips status ready→confirming in one
// synchronous step, so two racing confirms can never both proceed. If the
// confirm's durable writes fail, restoreAfterFailedConfirm() puts the
// proposals back (the write path is idempotent per-fact, so a retry cannot
// double-write). finishConfirm() drops the proposal payload — after confirm,
// extracted data lives ONLY in domain tables; the job keeps counts.
// ─────────────────────────────────────────────────────────────────────────────

export const IMPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days to review
export const MAX_JOBS_TOTAL = 200;                    // process-wide memory valve

export function createImportStore({ ttlMs = IMPORT_TTL_MS, maxJobs = MAX_JOBS_TOTAL, now = Date.now } = {}) {
  const byId = new Map();

  const sweep = () => {
    for (const [id, job] of byId) if (job.expiresAt <= now()) byId.delete(id);
  };

  return {
    ttlMs,

    put(job) {
      sweep();
      // Memory valve: evict oldest finished jobs first, then oldest anything.
      if (byId.size >= maxJobs) {
        const all = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
        const done = all.filter((j) => j.status !== 'extracting' && j.status !== 'confirming');
        const victim = done[0] || all[0];
        if (victim) byId.delete(victim.id);
      }
      byId.set(job.id, job);
    },

    // Owner-scoped read: a foreign or unknown id is the same null (existence
    // is never revealed across tenants).
    get(id, userId) {
      sweep();
      const job = byId.get(id);
      return job && job.userId === userId ? job : null;
    },

    // Idempotent re-upload: the same user re-sending the same bytes maps to
    // the live job for that digest instead of a second parse/extraction.
    // Discarded and failed jobs don't count — those may be retried fresh.
    findByDigest(userId, digest) {
      sweep();
      for (const job of byId.values()) {
        if (job.userId === userId && job.digest === digest &&
            job.status !== 'discarded' && job.status !== 'failed') return job;
      }
      return null;
    },

    countInFlight(userId) {
      sweep();
      let n = 0;
      for (const job of byId.values()) {
        if (job.userId === userId && (job.status === 'extracting' || job.status === 'confirming')) n++;
      }
      return n;
    },

    // ready → confirming, atomically (single-threaded JS makes this a real
    // mutex for racing requests). Returns the job or null.
    takeForConfirm(id, userId) {
      sweep();
      const job = byId.get(id);
      if (!job || job.userId !== userId || job.status !== 'ready') return null;
      job.status = 'confirming';
      return job;
    },

    restoreAfterFailedConfirm(job) {
      if (job.status === 'confirming') job.status = 'ready';
    },

    finishConfirm(job, results) {
      job.status = 'confirmed';
      job.results = results;
      job.proposals = null; // post-confirm, data lives only in domain tables
    },

    discard(id, userId) {
      sweep();
      const job = byId.get(id);
      if (!job || job.userId !== userId) return null;
      if (job.status === 'confirming') return null; // a confirm is mid-flight
      job.status = 'discarded';
      job.proposals = null;
      return job;
    },

    size() { sweep(); return byId.size; },
  };
}
