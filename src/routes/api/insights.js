import express, { Router } from 'express';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { createRequireUser } from './auth.js';
import * as insights from '../../services/insights.js';

// ─────────────────────────────────────────────────────────────────────────
// INSIGHTS ROUTER (INFRA-10) — /api/insights.
//
// A READ-ONLY, user-scoped surface over the Insight Engine
// (src/services/insights.js), so the ranked "reason to reach out" feed is
// live-queryable. It exposes the two read functions the contract already
// documents (docs/INSIGHTS.md §"Read API") and adds NO ranking, phrasing, or
// entitlement logic of its own:
//
//   GET /api/insights             → getInsightsForUser  — the ranked FEED:
//                                    top `perPerson` insight(s) per person,
//                                    ranked, optionally capped to `limit`.
//   GET /api/insights/person/:id  → getInsightsForPerson — every ranked
//                                    insight for ONE person (a person page).
//
// ENTITLEMENT IS PASSED THROUGH, NOT ENFORCED. Each insight keeps the
// engine's own `entitlement` ('free' for Core 5, 'pro' for everyone else)
// and `gated` tags, and the feed carries `viewerTier` (free/trial/pro).
// Billing enforcement is deliberately the SURFACE's job
// (docs/INSIGHTS.md §"Entitlement"): this endpoint computes + returns for
// ALL of the user's people and only TAGS, exactly like the engine. A free
// viewer still receives gated (Pro) insights, tagged so the surface can act.
//
// Mounting into src/index.js + the battery add: docs/FLAGS_FROM_INSIGHTS.md
// (this stream does not edit index.js or the shared test runner, so the
// router self-carries the /api shape rules).
//
// Same shape rules as routes/api/interests.js, restated because this file
// cannot edit that shared router (NEW FILES ONLY):
//   • every route sits behind requireUser (Supabase JWT → req.appUser);
//     identity is token-derived, NEVER body/path/query-derived (see
//     ./auth.js). A client-supplied personId can only ever behave as
//     "not found": getInsightsForPerson returns [] for a person the token
//     user does not own, because the engine's gather is user-scoped.
//   • handlers are thin: parse + validate the query, call the service, JSON
//     out. All ranking/phrasing lives in services/insights.js.
//   • typed errors carry {status, code, publicMessage}; the wrapper turns
//     those into the contract's {error, message} shape. Any other throw is a
//     500 with generic copy — internals never leak.
//   • one correlation id per request via the WS-A logger context.
// ─────────────────────────────────────────────────────────────────────────

const MSG_INTERNAL = 'Something went wrong on my end. Try that again in a moment.';
const MSG_BAD_LIMIT = 'limit must be a whole number from 1 to 100.';
const MSG_BAD_PER_PERSON = 'perPerson must be a whole number from 1 to 10.';

// Query bounds. `limit` caps the whole feed; `perPerson` is how many ranked
// insights each person contributes (default 1 = one reason per person). The
// clock is server-owned — `now` is deliberately NOT accepted from the client,
// so the feed cannot be time-shifted from the outside.
const LIMIT_MAX = 100;
const PER_PERSON_MAX = 10;

// A typed 422 the `handle` wrapper renders as { error, message } (like the
// service-layer errors interests.js throws).
function invalidRequest(message) {
  return { status: 422, code: 'invalid_request', publicMessage: message };
}

// Strict optional positive-int parse: absent → undefined (use the service
// default); present must be a bare integer within [min, max]. Repeated params
// (arrays) and any non-integer are rejected, so nothing odd smuggles into the
// engine.
function boundedIntParam(raw, min, max, badMessage) {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) throw invalidRequest(badMessage); // no ?p=1&p=2 array smuggling
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) throw invalidRequest(badMessage);
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) throw invalidRequest(badMessage);
  return n;
}

export function createInsightsRouter(deps = {}) {
  const router = Router();

  // Self-contained JSON parsing (same 100kb cap as index.js's app-wide
  // parser; harmless double-mount) so the router also works mounted
  // standalone in tests. These are GET reads with no body, but the parser
  // keeps this sub-router identical to its /api siblings.
  router.use(express.json({ limit: '100kb' }));
  router.use(createRequireUser(deps.auth || deps.db ? { auth: deps.auth, db: deps.db } : {}));

  // Wrap a handler with correlation context + the contract's error shape.
  // Same wrapper as routes/api/interests.js `handle` (not exported there;
  // keep the two in step if either changes).
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
          // set). A library error that happens to carry .status/.code must NOT
          // have its message forwarded to the client.
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

  // The ranked feed for the authed user (docs/INSIGHTS.md §"Read API").
  // `deps.insights` is the engine's injectable gather (getAgentContext /
  // getBirthdays / getOpenGoals / getOpenReminders / getOpenPrompts); unset in
  // production → the service wires the real Supabase-backed reads. `now` is
  // never taken from the request: the engine owns the clock.
  router.get('/', handle('insights.feed', (req) => {
    const opts = {};
    const limit = boundedIntParam(req.query.limit, 1, LIMIT_MAX, MSG_BAD_LIMIT);
    const perPerson = boundedIntParam(req.query.perPerson, 1, PER_PERSON_MAX, MSG_BAD_PER_PERSON);
    if (limit !== undefined) opts.limit = limit;
    if (perPerson !== undefined) opts.perPerson = perPerson;
    return insights.getInsightsForUser(req.appUser, opts, deps.insights);
  }));

  // Every ranked insight for ONE person. Ownership is enforced by the engine:
  // a person the token user does not own (or self / unknown / archived) yields
  // an empty list, so a forged or foreign id leaks nothing.
  router.get('/person/:id', handle('insights.person', (req) =>
    insights.getInsightsForPerson(req.appUser, req.params.id, {}, deps.insights)));

  return router;
}

// Production router: real Supabase auth + db + engine gather, per the mount
// instructions in docs/FLAGS_FROM_INSIGHTS.md.
export default createInsightsRouter();
