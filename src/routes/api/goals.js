import express, { Router } from 'express';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { createRequireUser } from './auth.js';
import * as goals from '../../services/goals.js';

// ─────────────────────────────────────────────────────────────────────────
// GOALS ROUTER (INFRA-15) — /api/goals.
//
// The user's standing, self-authored goals (store/read, unlimited) plus the
// deterministic "vital few" focus view. Business rules and the isolation from
// the pipeline's weekly intentions live in services/goals.js; this file is
// only wiring. Contract: docs/GOALS.md. Mounting: docs/FLAGS_FROM_STATION5_GOALS.md
// (this stream does not edit src/index.js, so the router lives in its own file
// and self-carries the /api shape rules).
//
// Same shape rules as routes/api/index.js + routes/api/interests.js, restated
// because this file cannot edit those (NEW FILES ONLY):
//   • every route sits behind requireUser (Supabase JWT → req.appUser);
//     identity is token-derived, never body-derived (see ./auth.js).
//   • handlers are thin: parse inputs, call the service, JSON out.
//   • services throw errors carrying {status, code, publicMessage}; the wrapper
//     turns those into the {error, message} shape. Any other throw is a 500
//     with generic copy — internals never leak.
//   • one correlation id per request via the WS-A logger context.
// ─────────────────────────────────────────────────────────────────────────

const MSG_INTERNAL = 'Something went wrong on my end. Try that again in a moment.';

export function createGoalsRouter(deps = {}) {
  const router = Router();

  // Self-contained JSON parsing (same 100kb cap as the app-wide parser in
  // index.js; harmless double-mount — body-parser skips an already-read body),
  // so the router also works mounted standalone in tests.
  router.use(express.json({ limit: '100kb' }));
  router.use(createRequireUser(deps.auth || deps.db ? { auth: deps.auth, db: deps.db } : {}));

  // Wrap a handler with correlation context + the contract's error shape. Same
  // wrapper as routes/api/interests.js `handle` — keep them in step.
  const handle = (name, fn) => async (req, res) => {
    const t0 = Date.now();
    // Hoisted out of runWithContext so a handler can put the same id in a
    // response body, not just in the log line. The contract 422 carries it, so
    // a rejected payload and its log record can be joined (Lesson 17: an error
    // a human cannot trace back costs hours).
    const requestId = crypto.randomUUID();
    req.cedrusRequestId = requestId;
    await logger.runWithContext(
      { correlation_id: crypto.randomUUID(), request_id: requestId },
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
          // set). A library error that happens to carry .status/.code must NOT
          // have its message forwarded to the client.
          const known = err && err.status && err.code && err.publicMessage;
          const status = known ? err.status : 500;
          // A contract rejection answers in the contract package's own error
          // shape (`cedrus.api_error`), so the caller gets the contract name and
          // the exact issue paths instead of one flattened sentence. Everything
          // else keeps the {error, message} shape this router has always used.
          if (known && err.apiError) {
            res.status(status).json(err.apiError);
          } else {
            res.status(status).json({
              error: known ? err.code : 'internal',
              message: known ? err.publicMessage : MSG_INTERNAL,
            });
          }
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

  // The vital few: the 3–5 that matter, deterministically selected. Registered
  // before any '/:id' route so the literal path always wins.
  router.get('/vital-few', handle('goals.vitalFew', (req) =>
    goals.getVitalFew({ user: req.appUser }, deps.goals)));

  // List: default active-only; ?status=completed or ?status=all widen it.
  router.get('/', handle('goals.list', (req) =>
    goals.listGoals({ user: req.appUser, status: req.query.status }, deps.goals)));

  // Add (unlimited — the add IS the user stating the goal).
  router.post('/', handle('goals.add', (req) =>
    goals.addGoal({ user: req.appUser, body: req.body },
      { ...deps.goals, requestId: req.cedrusRequestId })));

  // Update: edit text, re-rank priority, change due date, mark done / reactivate.
  router.patch('/:id', handle('goals.update', (req) =>
    goals.updateGoal({ user: req.appUser, goalId: req.params.id, patch: req.body }, deps.goals)));

  // Remove (a real delete).
  router.delete('/:id', handle('goals.remove', (req) =>
    goals.removeGoal({ user: req.appUser, goalId: req.params.id }, deps.goals)));

  return router;
}

// Production router: real Supabase auth + db, per docs/FLAGS_FROM_STATION5_GOALS.md.
export default createGoalsRouter();
