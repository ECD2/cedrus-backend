import express, { Router } from 'express';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { createRequireUser } from './auth.js';
import * as interests from '../../services/interests.js';

// ─────────────────────────────────────────────────────────────────────────
// INTERESTS ROUTER (NF2-SOURCES) — /api/interests.
//
// Contract: docs/INTERESTS_CONTRACT.md (the NF2-DASHBOARD "Your interests"
// section builds against that document). Mounting into src/index.js:
// docs/MOUNT_SOURCES.md (this stream does not edit index.js, so the router
// lives in its own file and self-carries the /api shape rules).
//
// Same shape rules as routes/api/index.js, restated because this file
// cannot edit that one (NEW FILES ONLY):
//   • every route sits behind requireUser (Supabase JWT → req.appUser);
//     identity is token-derived, never body-derived (see ./auth.js).
//   • handlers are thin: parse inputs, call the service, JSON out. All
//     business rules live in services/interests.js.
//   • services throw errors carrying {status, code, publicMessage}; the
//     wrapper turns those into the contract's {error, message} shape. Any
//     other throw is a 500 with generic copy — internals never leak.
//   • one correlation id per request via the WS-A logger context.
// ─────────────────────────────────────────────────────────────────────────

const MSG_INTERNAL = 'Something went wrong on my end. Try that again in a moment.';

export function createInterestsRouter(deps = {}) {
  const router = Router();

  // Self-contained JSON parsing (same 100kb cap as the app-wide parser in
  // index.js; harmless double-mount — body-parser skips an already-read
  // body), so the router also works mounted standalone in tests.
  router.use(express.json({ limit: '100kb' }));
  router.use(createRequireUser(deps.auth || deps.db ? { auth: deps.auth, db: deps.db } : {}));

  // Wrap a handler with correlation context + the contract's error shape.
  // Same wrapper as routes/api/index.js `handle` (not exported there; keep
  // the two in step if either changes).
  const handle = (name, fn) => async (req, res) => {
    const t0 = Date.now();
    await logger.runWithContext(
      { correlation_id: crypto.randomUUID(), request_id: crypto.randomUUID() },
      async () => {
        logger.addContext({ user_ref: 'u_' + req.appUser.id });
        try {
          const result = await fn(req);
          res.json(result);
          logger.event(`web.${name}.handled`, {
            status_code: 200, outcome: 'accepted', latency_ms: Date.now() - t0,
          });
        } catch (err) {
          // "Known" = one of OUR typed errors (status + code + public copy
          // all set). A library error that happens to carry .status/.code
          // must NOT have its message forwarded to the client.
          const known = err && err.status && err.code && err.publicMessage;
          const status = known ? err.status : 500;
          res.status(status).json({
            error: known ? err.code : 'internal',
            message: known ? err.publicMessage : MSG_INTERNAL,
          });
          logger.event(`web.${name}.rejected`, {
            level: status >= 500 ? 'error' : 'warn',
            error_category: status >= 500 ? 'internal' : 'validation',
            status_code: status, latency_ms: Date.now() - t0,
            message: known ? err.code : (err && err.message) || String(err),
          });
        }
      },
    );
  };

  // List: default is active-only (opt-out honored by default); the
  // management surface passes ?state=all. See INTERESTS_CONTRACT.md §3.
  router.get('/', handle('interests.list', (req) =>
    interests.listInterests({
      user: req.appUser, state: req.query.state, category: req.query.category,
    }, deps.interests)));

  // Add (explicit user-stated — the add IS the confirmation, §4).
  router.post('/', handle('interests.add', (req) =>
    interests.addInterest({ user: req.appUser, body: req.body }, deps.interests)));

  // Update: rename and the per-interest opt-out toggle (§5).
  router.patch('/:id', handle('interests.update', (req) =>
    interests.updateInterest({
      user: req.appUser, interestId: req.params.id, patch: req.body,
    }, deps.interests)));

  // Remove (a real delete — distinct from the opt-out, §6).
  router.delete('/:id', handle('interests.remove', (req) =>
    interests.removeInterest({ user: req.appUser, interestId: req.params.id }, deps.interests)));

  return router;
}

// Production router: real Supabase auth + db, per the mount instructions in
// docs/MOUNT_SOURCES.md.
export default createInterestsRouter();
