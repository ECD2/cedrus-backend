import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { panelTokenConfigured, panelTokenMatches, listUsers, userHealth, userBilling, resetUserById, testerAllowlistView, UUID_RE } from '../services/adminOps.js';

// ─────────────────────────────────────────────────────────────────────────
// Admin Panel routes (N1). Contract: docs/ADMIN_API_CONTRACT.md.
// Mounting: docs/MOUNT_N1.md — one line, BEFORE the founder-admin router.
//
// Shape rules this file lives by:
//   • Auth is attached PER ROUTE (no panel.use), so any /admin/* path this
//     router doesn't own falls through untouched to the existing
//     founder-admin router — POST /admin/user and /admin/reset-user keep
//     working whichever order the two routers are mounted in.
//   • Fail closed: no token configured (ADMIN_PANEL_TOKEN, else ADMIN_KEY)
//     ⇒ 404 on every panel route; the panel does not exist. Wrong/missing
//     header ⇒ 403. Compare is constant-time (adminOps).
//   • Nothing mutating is a GET. Every route — reads included — writes one
//     structured audit event.
// ─────────────────────────────────────────────────────────────────────────

const panel = Router();

function requirePanelAuth(req, res, next) {
  // A valid admin session (set by adminSessionAdapter — docs/MOUNT_ADMIN_AUTH.md)
  // is strictly stronger than the shared header token, so accept it directly.
  // This also covers ADMIN_PANEL_TOKEN differing from ADMIN_KEY, which the
  // adapter's injected x-admin-key alone could not satisfy.
  if (req.adminSession) return next();
  if (!panelTokenConfigured()) {
    logger.event('admin_panel.auth.rejected', {
      level: 'warn', error_category: 'auth', status_code: 404,
      reason: 'panel_disabled_no_token', message: req.method + ' ' + req.path,
    });
    return res.status(404).send('Not found');
  }
  if (!panelTokenMatches(req.get('x-admin-key'))) {
    logger.event('admin_panel.auth.rejected', {
      level: 'warn', error_category: 'auth', status_code: 403,
      reason: 'bad_token', message: req.method + ' ' + req.path,
    });
    return res.status(403).send('Forbidden');
  }
  next();
}

// Reject malformed :id before it reaches a Postgres uuid cast (400, not 500).
function requireUserIdShape(req, res, next) {
  if (!UUID_RE.test(String(req.params.id || ''))) {
    logger.event('admin_panel.request.rejected', {
      level: 'warn', error_category: 'validation', status_code: 400,
      reason: 'malformed_user_id', message: req.method + ' ' + req.path,
    });
    return res.status(400).json({ error: 'invalid user id' });
  }
  next();
}

// Express 4 doesn't catch async throws; funnel them to one 500 + audit line.
function guarded(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      logger.event('admin_panel.route.failed', {
        level: 'error', error_category: 'internal', status_code: 500,
        message: (req.method + ' ' + req.path + ': ') + (err?.message || String(err)),
      });
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
    }
  };
}

function intOr(raw, fallback, { min, max }) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

// ── GET /admin/users — paginated tester roster ──────────────────────────
panel.get('/users', requirePanelAuth, guarded(async (req, res) => {
  const limit = intOr(req.query?.limit, 25, { min: 1, max: 100 });
  const offset = intOr(req.query?.offset, 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const out = await listUsers({ limit, offset });
  logger.event('admin_panel.users.listed', { outcome: 'accepted', count: out.users.length });
  res.json(out);
}));

// ── GET /admin/users/:id/health — delivery / reminders / last inbound ───
panel.get('/users/:id/health', requirePanelAuth, requireUserIdShape, guarded(async (req, res) => {
  const days = intOr(req.query?.days, 7, { min: 1, max: 30 });
  const health = await userHealth(req.params.id, { days });
  if (!health) {
    logger.event('admin_panel.user_health.viewed', { outcome: 'denied', reason: 'user_not_found', status_code: 404 });
    return res.status(404).json({ found: false });
  }
  logger.event('admin_panel.user_health.viewed', { outcome: 'accepted', user_ref: health.user.user_ref });
  res.json(health);
}));

// ── GET /admin/users/:id/billing — schema-only fields + Stripe stub ─────
panel.get('/users/:id/billing', requirePanelAuth, requireUserIdShape, guarded(async (req, res) => {
  const billing = await userBilling(req.params.id);
  if (!billing) {
    logger.event('admin_panel.user_billing.viewed', { outcome: 'denied', reason: 'user_not_found', status_code: 404 });
    return res.status(404).json({ found: false });
  }
  logger.event('admin_panel.user_billing.viewed', { outcome: 'accepted', user_ref: billing.user_ref });
  res.json(billing);
}));

// ── POST /admin/users/:id/reset — pass-through to the hardened tool ─────
// Allowlist gate, consent preservation and the inner audit entry all come
// from the one existing implementation (see adminOps.resetUserById).
panel.post('/users/:id/reset', requirePanelAuth, requireUserIdShape, guarded(async (req, res) => {
  const out = await resetUserById(req.params.id);
  logger.event('admin_panel.reset.requested', {
    outcome: out.status === 200 ? 'accepted' : 'denied',
    status_code: out.status,
    user_ref: out.user_ref,
    reason: out.status === 200 ? undefined
      : (out.status === 404 ? 'user_not_found' : (out.status === 503 ? 'reset_backend_disabled' : 'not_on_tester_allowlist')),
  });
  res.status(out.status).json(out.body);
}));

// ── GET /admin/testers — masked view of the env allowlist ───────────────
panel.get('/testers', requirePanelAuth, guarded(async (req, res) => {
  const view = testerAllowlistView();
  logger.event('admin_panel.testers.viewed', { outcome: 'accepted', count: view.count });
  res.json(view);
}));

// ── POST /admin/testers — env-managed, nothing to mutate: 501 + how-to ──
panel.post('/testers', requirePanelAuth, guarded(async (req, res) => {
  logger.event('admin_panel.testers.mutation_refused', {
    outcome: 'denied', status_code: 501, reason: 'allowlist_is_env_managed',
  });
  res.status(501).json({
    error: 'tester allowlist is env-managed; there is nothing to mutate at runtime',
    how_to: 'Edit the TESTER_PHONES env var (comma-separated, any format) in Railway → service → Variables, then redeploy. Parsed at boot by src/config.js.',
    see: 'docs/ADMIN_API_CONTRACT.md §7',
  });
}));

export default panel;
