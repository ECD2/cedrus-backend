import { Router } from 'express';
import QRCode from 'qrcode';
import { logger as defaultLogger } from '../utils/logger.js';
import {
  emailMatches, passwordMatches, totpValid, totpStep, TotpReplayGuard,
  generateTotpSecret, totpKeyuri, signSession, verifySession, RateLimiter,
  ipFingerprint,
} from '../services/adminSession.js';

// ─────────────────────────────────────────────────────────────────────────
// Admin auth routes + session adapter (BE-ADMIN-AUTH).
// Design: docs/ADMIN_AUTH_DESIGN.md · Contract: docs/ADMIN_AUTH_CONTRACT.md ·
// Mounting: docs/MOUNT_ADMIN_AUTH.md.
//
//   POST /admin/auth/login   email + password + TOTP → short-lived Bearer token
//   POST /admin/auth/enroll  one-shot TOTP provisioning (404 once enrolled)
//   adapter                  mounted before the existing /admin routers; turns a
//                            valid Bearer into authorization they already honor
//
// createAdminAuth(deps) is fully injectable (no process.env / config / clock
// baked in) so the whole surface is testable with fakes. A default instance is
// built from the environment at the bottom for the production mount.
// ─────────────────────────────────────────────────────────────────────────

export function createAdminAuth(deps = {}) {
  const {
    adminEmail = '',
    adminPasswordHash = '',
    totpSecret = '',                 // ADMIN_TOTP_SECRET; '' ⇒ not enrolled
    sessionSecret = '',
    adminKey = '',                   // legacy key, injected for the founder-admin router
    sessionTtlSeconds = 12 * 3600,
    issuer = 'Cedrus Admin',
    label = adminEmail || 'admin',
    now = Date.now,
    logger = defaultLogger,
    rateLimiter = new RateLimiter({ now }),
    replayGuard = new TotpReplayGuard(),
  } = deps;

  const identityConfigured = Boolean(adminEmail && adminPasswordHash && sessionSecret);
  const enrolled = Boolean(totpSecret);

  // Per-process pending secret so refreshing the enroll page shows the SAME QR
  // instead of a new secret each call (lost on restart — that's fine, the
  // operator hasn't committed it to env yet). See design §Enrollment.
  let pendingSecret = null;

  function clientKey(req) {
    return String((req && req.ip) || (req && req.headers && req.headers['x-forwarded-for']) || 'unknown');
  }
  // Audit helper: structural fields verbatim, plus a salted IP fingerprint and
  // path in meta. Never receives a password / code / secret / token.
  function audit(event, req, fields = {}) {
    const { meta, ...rest } = fields;
    logger.event(event, {
      ...rest,
      meta: { ...(meta || {}), ip_hash: ipFingerprint(clientKey(req), sessionSecret || 'cedrus'), path: (req && req.path) || '' },
    });
  }

  // Express 4 doesn't catch async throws — funnel them to one 500 + audit line.
  function guarded(fn) {
    return async (req, res) => {
      try { await fn(req, res); }
      catch (err) {
        audit('admin_auth.route.failed', req, {
          level: 'error', error_category: 'internal', status_code: 500,
          message: (req.method + ' ' + req.path + ': ') + (err && err.message ? err.message : String(err)),
        });
        if (!res.headersSent) res.status(500).json({ error: 'internal' });
      }
    };
  }

  const router = Router();

  // ── POST /admin/auth/login ──────────────────────────────────────────────
  router.post('/auth/login', guarded(async (req, res) => {
    if (!identityConfigured) {
      audit('admin_auth.login.rejected', req, { level: 'error', error_category: 'config', status_code: 503, outcome: 'denied', reason: 'admin_not_configured' });
      return res.status(503).json({ error: 'admin login is not configured' });
    }
    if (!enrolled) {
      audit('admin_auth.login.rejected', req, { level: 'warn', error_category: 'config', status_code: 403, outcome: 'denied', reason: 'totp_not_enrolled' });
      return res.status(403).json({ error: 'TOTP is not enrolled' });
    }

    const key = clientKey(req);
    const rl = rateLimiter.status(key);
    if (rl.limited) {
      audit('admin_auth.login.rejected', req, { level: 'warn', error_category: 'rate_limit', status_code: 429, outcome: 'denied', reason: 'rate_limited' });
      res.set('Retry-After', String(rl.retryAfterSec));
      return res.status(429).json({ error: 'too many attempts, try again later', retry_after_seconds: rl.retryAfterSec });
    }

    const email = req.body ? req.body.email : undefined;
    const password = req.body ? req.body.password : undefined;
    const code = req.body ? req.body.totp : undefined;

    // Evaluate every factor (password hash ALWAYS runs) so timing doesn't leak
    // which factor was wrong; precedence only decides the audit reason.
    const okEmail = emailMatches(email, adminEmail);
    const okPassword = await passwordMatches(password, adminPasswordHash);
    const okTotp = totpValid(code, totpSecret);
    let reason = !okEmail ? 'bad_email' : !okPassword ? 'bad_password' : !okTotp ? 'bad_totp' : null;
    if (!reason) {
      const step = totpStep(now());
      const replay = replayGuard.reason(code, step);
      if (replay) reason = replay;
      else replayGuard.commit(code, step);
    }

    if (reason) {
      rateLimiter.fail(key);
      audit('admin_auth.login.rejected', req, { level: 'warn', error_category: 'auth', status_code: 401, outcome: 'denied', reason });
      return res.status(401).json({ error: 'invalid email, password, or code' });
    }

    const { token, payload, expiresAt } = signSession({ secret: sessionSecret, ttlSeconds: sessionTtlSeconds, now });
    rateLimiter.reset(key);
    audit('admin_auth.login.succeeded', req, { outcome: 'accepted', status_code: 200, meta: { jti: payload.jti } });
    return res.json({ token, token_type: 'Bearer', expires_at: expiresAt });
  }));

  // ── POST /admin/auth/enroll ─────────────────────────────────────────────
  // One-shot TOTP provisioning. 404 once ADMIN_TOTP_SECRET is set. Password-gated.
  router.post('/auth/enroll', guarded(async (req, res) => {
    if (enrolled) {
      audit('admin_auth.enroll.rejected', req, { level: 'warn', error_category: 'auth', status_code: 404, outcome: 'denied', reason: 'already_enrolled' });
      return res.status(404).send('Not found');
    }
    if (!identityConfigured) {
      audit('admin_auth.enroll.rejected', req, { level: 'error', error_category: 'config', status_code: 503, outcome: 'denied', reason: 'admin_not_configured' });
      return res.status(503).json({ error: 'admin login is not configured' });
    }

    const key = clientKey(req);
    const rl = rateLimiter.status(key);
    if (rl.limited) {
      audit('admin_auth.enroll.rejected', req, { level: 'warn', error_category: 'rate_limit', status_code: 429, outcome: 'denied', reason: 'rate_limited' });
      res.set('Retry-After', String(rl.retryAfterSec));
      return res.status(429).json({ error: 'too many attempts, try again later', retry_after_seconds: rl.retryAfterSec });
    }

    const okEmail = emailMatches(req.body ? req.body.email : undefined, adminEmail);
    const okPassword = await passwordMatches(req.body ? req.body.password : undefined, adminPasswordHash);
    if (!okEmail || !okPassword) {
      rateLimiter.fail(key);
      audit('admin_auth.enroll.rejected', req, { level: 'warn', error_category: 'auth', status_code: 401, outcome: 'denied', reason: !okEmail ? 'bad_email' : 'bad_password' });
      return res.status(401).json({ error: 'invalid email or password' });
    }
    rateLimiter.reset(key);

    if (!pendingSecret) pendingSecret = generateTotpSecret();
    const uri = totpKeyuri(pendingSecret, { issuer, label });
    let qrSvg = null;
    try { qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, width: 240 }); }
    catch { /* QR is a convenience; the otpauth_uri + secret still enroll */ }

    audit('admin_auth.enroll.provisioned', req, { outcome: 'accepted', status_code: 200 });
    return res.json({
      secret: pendingSecret,
      otpauth_uri: uri,
      qr_svg: qrSvg,
      next_steps: [
        'Scan the QR (or type the secret) into your authenticator app.',
        'Set ADMIN_TOTP_SECRET to this secret in the server environment, then redeploy.',
        'After redeploy this endpoint returns 404 and login requires the 6-digit code.',
      ],
    });
  }));

  // ── adapter ─────────────────────────────────────────────────────────────
  // Mounted on /admin BEFORE the existing routers. No Bearer ⇒ untouched legacy
  // path. Valid Bearer ⇒ attach req.adminSession and inject the legacy key so
  // the (unowned) founder-admin router authenticates as always. Invalid Bearer
  // ⇒ 401 (presence of a Bearer means "session auth"; no silent fallback).
  function adapter(req, res, next) {
    const authz = (req.get && req.get('authorization')) || (req.headers && req.headers.authorization) || '';
    const m = /^Bearer\s+(.+)$/i.exec(String(authz));
    if (!m) return next();
    const v = verifySession(m[1].trim(), { secret: sessionSecret, now });
    if (!v.valid) {
      audit('admin_auth.session.rejected', req, { level: 'warn', error_category: 'auth', status_code: 401, outcome: 'denied', reason: v.reason });
      return res.status(401).json({ error: 'invalid or expired session' });
    }
    req.adminSession = { jti: v.payload.jti, exp: v.payload.exp };
    // Downstream founder-admin router checks x-admin-key; inject it now that the
    // session is proven. Requires ADMIN_KEY still set (migration note in the doc).
    if (adminKey && req.headers) req.headers['x-admin-key'] = adminKey;
    return next();
  }

  return { router, adapter, _internals: { rateLimiter, replayGuard } };
}

// ── Production instance (mounted per docs/MOUNT_ADMIN_AUTH.md) ─────────────
// Read straight from the environment (not config.js) so importing this module
// never triggers config's required()-env process.exit in a bare context.
const _env = (typeof process !== 'undefined' && process.env) ? process.env : {};
const _default = createAdminAuth({
  adminEmail: _env.ADMIN_EMAIL || '',
  adminPasswordHash: _env.ADMIN_PASSWORD_HASH || '',
  totpSecret: _env.ADMIN_TOTP_SECRET || '',
  sessionSecret: _env.ADMIN_SESSION_SECRET || '',
  adminKey: _env.ADMIN_KEY || '',
  sessionTtlSeconds: (Number(_env.ADMIN_SESSION_TTL_HOURS) || 12) * 3600,
  issuer: _env.ADMIN_TOTP_ISSUER || 'Cedrus Admin',
  label: _env.ADMIN_TOTP_LABEL || _env.ADMIN_EMAIL || 'admin',
});

export const adminAuthRouter = _default.router;
export const adminSessionAdapter = _default.adapter;
export default _default.router;
