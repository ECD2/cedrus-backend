import express, { Router } from 'express';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { createRequireUser } from './auth.js';
import * as capture from '../../services/capture.js';
import * as prioritySwap from '../../services/prioritySwap.js';
import * as restore from '../../services/restore.js';

// ─────────────────────────────────────────────────────────────────────────
// WEB API ROUTER (N3) — the user-facing /api surface.
//
// Contract: docs/WEB_API_CONTRACT.md (N4 builds against that document).
// Mounting into src/index.js: docs/MOUNT_N3.md (index.js is not edited by
// this stream).
//
// Shape rules:
//   • every route sits behind requireUser (Supabase JWT → req.appUser);
//     identity is token-derived, never body-derived (see auth.js).
//   • handlers are thin: parse inputs, call the service, JSON out. All
//     business rules live in services/capture|prioritySwap|restore.
//   • services throw errors carrying {status, code, publicMessage}; the
//     wrapper turns those into the contract's {error, message} shape. Any
//     other throw is a 500 with generic copy — internals never leak.
//   • one correlation id per request via the WS-A logger context, same as
//     routes/sms.js.
// ─────────────────────────────────────────────────────────────────────────

const MSG_INTERNAL = 'Something went wrong on my end. Try that again in a moment.';

export function createApiRouter(deps = {}) {
  const router = Router();

  // Self-contained JSON parsing (same 100kb cap as the app-wide parser in
  // index.js; harmless double-mount — body-parser skips an already-read
  // body), so the router also works mounted standalone in tests.
  router.use(express.json({ limit: '100kb' }));
  router.use(createRequireUser(deps.auth || deps.db ? { auth: deps.auth, db: deps.db } : {}));

  // Wrap a handler with correlation context + the contract's error shape.
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
          // "Known" = one of OUR typed errors (status + code + public copy all
          // set). A library error that happens to carry .status/.code (e.g. an
          // AuthError) must NOT have its message forwarded to the client.
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
            // 4xx public copy is safe to log; a 500's real error goes to the
            // log only — the client got generic copy.
            message: known ? err.code : (err && err.message) || String(err),
          });
        }
      },
    );
  };

  // 1. "Tell Cedrus" — propose, then confirm (docs/WEB_API_CONTRACT.md §3–4).
  router.post('/capture', handle('capture.propose', (req) =>
    capture.proposeCapture({ user: req.appUser, text: req.body && req.body.text }, deps.capture)));
  router.post('/capture/confirm', handle('capture.confirm', (req) =>
    capture.confirmCapture({ user: req.appUser, proposalId: req.body && req.body.proposal_id }, deps.capture)));

  // 2. Priority five, full-set semantics (§5).
  router.post('/priority/swap', handle('priority.swap', (req) =>
    prioritySwap.swapPriorityPeople({ user: req.appUser, personIds: req.body && req.body.person_ids }, deps.swap)));

  // 3–4. Archive restore + the archived list (§6–7).
  router.post('/people/:id/restore', handle('people.restore', (req) =>
    restore.restorePerson({ user: req.appUser, personId: req.params.id }, deps.restore)));
  router.get('/people/archived', handle('people.archived', (req) =>
    restore.listArchivedPeople({ user: req.appUser }, deps.restore)));

  return router;
}

// Production router: real Supabase auth + db + services, per src/index.js
// mount instructions in docs/MOUNT_N3.md.
export default createApiRouter();
