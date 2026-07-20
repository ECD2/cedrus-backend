import express, { Router } from 'express';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { createRateLimiter } from '../../services/rateLimiter.js';
import { startOnboarding, defaultLimiters } from '../../services/webOnboarding.js';

// ─────────────────────────────────────────────────────────────────────────
// WEB ONBOARDING ROUTER — POST /api/onboard/start  (PUBLIC, unauthenticated)
//
// Unlike the N3 /api router (every route behind requireUser), THIS surface is
// for a visitor who has NO account and NO session yet: they are on cedrus.life
// and want Cedrus to text them. So there is no JWT here — identity does not
// exist. Its defenses are validation + rate limiting + never leaking account
// existence, all in services/webOnboarding.js.
//
// Contract for the landing-page form: docs/WEB_ONBOARD_CONTRACT.md.
// Mounting into src/index.js (this stream does NOT edit index.js):
// docs/MOUNT_WEBONBOARD.md — and it MUST be mounted BEFORE the `/api` N3 router,
// whose requireUser middleware would otherwise 401 this public route.
//
// Shape rules (mirrors routes/api/index.js): thin handler; one correlation id
// per request; typed service errors ({status, code, publicMessage}) become the
// {error, message} envelope; any other throw is a generic 500 (internals never
// leak). No request field is ever logged (phone/email/ip stay out of logs).
// ─────────────────────────────────────────────────────────────────────────

const MSG_INTERNAL = 'Something went wrong on my end. Try that again in a moment.';

// Best-effort client IP for rate-limiting. Behind Railway's proxy the real
// client is the left-most X-Forwarded-For hop; req.ip is only meaningful with
// `app.set('trust proxy', …)` (see MOUNT doc). Falls back through both.
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

export function createOnboardRouter(deps = {}) {
  const router = Router();

  // Self-contained parser (same 100kb cap as index.js's app-wide parser;
  // double-mount is harmless) so the router also works standalone in tests.
  router.use(express.json({ limit: '100kb' }));

  // Build the abuse limiters once and share them across every request.
  const limiters = {
    ipLimiter: deps.ipLimiter || defaultLimiters(createRateLimiter).ipLimiter,
    phoneLimiter: deps.phoneLimiter || defaultLimiters(createRateLimiter).phoneLimiter,
  };
  const serviceDeps = { ...limiters };
  if (deps.sms) serviceDeps.sms = deps.sms;
  if (deps.dryRun !== undefined) serviceDeps.dryRun = deps.dryRun;

  const handle = (name, fn) => async (req, res) => {
    const t0 = Date.now();
    await logger.runWithContext(
      { correlation_id: crypto.randomUUID(), request_id: crypto.randomUUID() },
      async () => {
        try {
          const result = await fn(req);
          res.json({ ok: true, ...result });
          logger.event(`web.${name}.handled`, {
            status_code: 200, outcome: 'accepted', latency_ms: Date.now() - t0,
          });
        } catch (err) {
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

  // POST /api/onboard/start — { phone: string (E.164), email?: string }.
  router.post('/start', handle('onboard.start', (req) => {
    const body = req.body || {};
    return startOnboarding(
      { phone: body.phone, email: body.email, ip: clientIp(req) },
      serviceDeps,
    );
  }));

  return router;
}

// Production router: real Supabase + Twilio + env-tuned limiters, per
// docs/MOUNT_WEBONBOARD.md.
export default createOnboardRouter();
