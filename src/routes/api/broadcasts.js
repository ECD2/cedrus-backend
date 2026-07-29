import express, { Router } from 'express';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { createRequireUser } from './auth.js';
import { getActiveWebBroadcasts } from '../../services/broadcasts.js';

// ─────────────────────────────────────────────────────────────────────────
// WEB BROADCASTS FEED (night build 2026-07-28, item 3) — /api/broadcasts.
//
//   GET /api/broadcasts/active → active web-channel broadcasts for the new
//   frontend's feed (Session F consumes this). Read-only; rows appear only
//   after Emil's explicit approve call publishes them. No SMS spend on this
//   channel, so it works fully under BRIEF_DRY_RUN.
//
// Same shape rules as routes/api/insights.js: requireUser (Supabase JWT →
// req.appUser), thin handler, service does the work, errors never leak
// internals. The feed is the same for every signed-in member (segment
// filtering is a send-time concern, not a read-time one, in V1).
// ─────────────────────────────────────────────────────────────────────────

const MSG_INTERNAL = 'Something went wrong on my end. Try that again in a moment.';

export function createBroadcastsRouter(deps = {}) {
  const router = Router();
  router.use(express.json({ limit: '100kb' }));
  router.use(createRequireUser(deps.auth || deps.db ? { auth: deps.auth, db: deps.db } : {}));

  router.get('/active', async (req, res) => {
    const t0 = Date.now();
    await logger.runWithContext(
      { correlation_id: crypto.randomUUID(), request_id: crypto.randomUUID() },
      async () => {
        logger.addContext({ user_ref: 'u_' + req.appUser.id });
        try {
          const broadcasts = await getActiveWebBroadcasts();
          res.json({ broadcasts });
          logger.event('web.broadcasts_active.handled', {
            status_code: 200, outcome: 'accepted', count: broadcasts.length, latency_ms: Date.now() - t0,
          });
        } catch (err) {
          logger.event('web.broadcasts_active.failed', {
            level: 'error', error_category: 'internal', status_code: 500,
            message: err?.message || String(err),
          });
          if (!res.headersSent) res.status(500).json({ error: 'internal', message: MSG_INTERNAL });
        }
      },
    );
  });

  return router;
}

export default createBroadcastsRouter();
