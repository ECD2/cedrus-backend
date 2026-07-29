import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { panelTokenConfigured, panelTokenMatches, UUID_RE } from '../services/adminOps.js';
import { createDraft, approveBroadcast, listBroadcasts } from '../services/broadcasts.js';

// ─────────────────────────────────────────────────────────────────────────
// Admin broadcasts (night build 2026-07-28, item 3).
//
//   POST /admin/broadcasts              → creates a DRAFT. Only a draft.
//   POST /admin/broadcasts/:id/approve  → the separate, explicit call that
//                                         sends (sms) or publishes (web).
//   GET  /admin/broadcasts              → recent broadcasts, newest first.
//
// Same shape rules as adminPanel.js: per-route auth (unmatched /admin/*
// paths fall through to the founder router), fail closed 404 without a
// token, constant-time compare, structured audit events. All business
// rules (quiet hours, caps, recipient resolution, dry-run, kill switch)
// live in services/broadcasts.js.
// ─────────────────────────────────────────────────────────────────────────

const bAdmin = Router();

function requirePanelAuth(req, res, next) {
  if (req.adminSession) return next();
  if (!panelTokenConfigured()) {
    logger.event('admin_broadcasts.auth.rejected', {
      level: 'warn', error_category: 'auth', status_code: 404,
      reason: 'panel_disabled_no_token', message: req.method + ' ' + req.path,
    });
    return res.status(404).send('Not found');
  }
  if (!panelTokenMatches(req.get('x-admin-key'))) {
    logger.event('admin_broadcasts.auth.rejected', {
      level: 'warn', error_category: 'auth', status_code: 403,
      reason: 'bad_token', message: req.method + ' ' + req.path,
    });
    return res.status(403).send('Forbidden');
  }
  next();
}

function guarded(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const known = err && err.status && err.code && err.publicMessage;
      if (known) {
        logger.event('admin_broadcasts.request.rejected', {
          level: 'warn', error_category: 'validation', status_code: err.status,
          reason: err.code, message: req.method + ' ' + req.path,
        });
        return res.status(err.status).json({ error: err.code, message: err.publicMessage });
      }
      logger.event('admin_broadcasts.route.failed', {
        level: 'error', error_category: 'internal', status_code: 500,
        message: (req.method + ' ' + req.path + ': ') + (err?.message || String(err)),
      });
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
    }
  };
}

// ── POST /admin/broadcasts — DRAFT ONLY ─────────────────────────────────
bAdmin.post('/broadcasts', requirePanelAuth, guarded(async (req, res) => {
  const b = req.body || {};
  const draft = await createDraft({
    segment: b.segment, channel: b.channel, body: b.body,
    createdBy: req.adminSession ? 'admin_session' : 'admin',
  });
  logger.event('admin_broadcasts.drafted', { status_code: 201, outcome: 'draft', message: `broadcast ${draft.id}` });
  res.status(201).json({ broadcast: draft, note: 'draft only — nothing sends until POST /admin/broadcasts/' + draft.id + '/approve' });
}));

// ── POST /admin/broadcasts/:id/approve — the explicit send ──────────────
bAdmin.post('/broadcasts/:id/approve', requirePanelAuth, guarded(async (req, res) => {
  if (!UUID_RE.test(String(req.params.id || ''))) return res.status(400).json({ error: 'invalid broadcast id' });
  const result = await approveBroadcast({
    id: req.params.id,
    approvedBy: req.adminSession ? 'admin_session' : 'admin',
  });
  logger.event('admin_broadcasts.approved', { status_code: 200, outcome: 'sent', message: `broadcast ${req.params.id} ${result.channel}${result.dryRun ? ' (dry-run)' : ''}` });
  res.json(result);
}));

// ── GET /admin/broadcasts ───────────────────────────────────────────────
bAdmin.get('/broadcasts', requirePanelAuth, guarded(async (req, res) => {
  const broadcasts = await listBroadcasts({ limit: req.query.limit });
  logger.event('admin_broadcasts.listed', { status_code: 200, count: broadcasts.length });
  res.json({ broadcasts });
}));

export default bAdmin;
