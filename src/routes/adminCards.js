import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { panelTokenConfigured, panelTokenMatches, UUID_RE } from '../services/adminOps.js';
import { queueCard, listCards } from '../services/cards.js';

// ─────────────────────────────────────────────────────────────────────────
// Admin card queue (night build 2026-07-28, item 2).
//
// Emil is the card generator in V1: POST queues a card, the sender job does
// the rest. Same shape rules as adminPanel.js (N1): auth attached PER ROUTE
// so unmatched /admin/* paths fall through to the founder router; fail
// closed with 404 when no token is configured; constant-time compare; every
// route writes a structured audit event. Business rules (single-sided
// person check, suppression 409, opted-out 422) live in services/cards.js.
// ─────────────────────────────────────────────────────────────────────────

const cardsAdmin = Router();

function requirePanelAuth(req, res, next) {
  if (req.adminSession) return next();
  if (!panelTokenConfigured()) {
    logger.event('admin_cards.auth.rejected', {
      level: 'warn', error_category: 'auth', status_code: 404,
      reason: 'panel_disabled_no_token', message: req.method + ' ' + req.path,
    });
    return res.status(404).send('Not found');
  }
  if (!panelTokenMatches(req.get('x-admin-key'))) {
    logger.event('admin_cards.auth.rejected', {
      level: 'warn', error_category: 'auth', status_code: 403,
      reason: 'bad_token', message: req.method + ' ' + req.path,
    });
    return res.status(403).send('Forbidden');
  }
  next();
}

// Express 4 doesn't catch async throws; funnel them to one 500 + audit line.
function guarded(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const known = err && err.status && err.code && err.publicMessage;
      if (known) {
        logger.event('admin_cards.request.rejected', {
          level: 'warn', error_category: 'validation', status_code: err.status,
          reason: err.code, message: req.method + ' ' + req.path,
        });
        return res.status(err.status).json({ error: err.code, message: err.publicMessage });
      }
      logger.event('admin_cards.route.failed', {
        level: 'error', error_category: 'internal', status_code: 500,
        message: (req.method + ' ' + req.path + ': ') + (err?.message || String(err)),
      });
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
    }
  };
}

// ── POST /admin/cards — queue one opportunity card ──────────────────────
// Body: { user_id, person_id, kind, body, invite_text, occasion?, send_after? }
cardsAdmin.post('/cards', requirePanelAuth, guarded(async (req, res) => {
  const b = req.body || {};
  for (const f of ['user_id', 'person_id']) {
    if (b[f] != null && !UUID_RE.test(String(b[f]))) {
      logger.event('admin_cards.request.rejected', {
        level: 'warn', error_category: 'validation', status_code: 400,
        reason: 'malformed_' + f, message: 'POST /cards',
      });
      return res.status(400).json({ error: 'invalid ' + f });
    }
  }
  const result = await queueCard({
    userId: b.user_id, personId: b.person_id, kind: b.kind,
    occasion: b.occasion, body: b.body, inviteText: b.invite_text,
    sendAfter: b.send_after || null,
    createdBy: req.adminSession ? 'admin_session' : 'admin',
  });
  logger.event('admin_cards.queued', {
    status_code: 201, outcome: 'queued',
    message: `card ${result.card.id} for u_${b.user_id} (${result.sends_last_7d}/${result.weekly_cap} sends last 7d)`,
  });
  res.status(201).json(result);
}));

// ── GET /admin/cards?user_id=&limit= — recent cards, newest first ───────
cardsAdmin.get('/cards', requirePanelAuth, guarded(async (req, res) => {
  const userId = req.query.user_id ? String(req.query.user_id) : null;
  if (userId && !UUID_RE.test(userId)) return res.status(400).json({ error: 'invalid user_id' });
  const cards = await listCards({ userId, limit: req.query.limit });
  logger.event('admin_cards.listed', { status_code: 200, count: cards.length });
  res.json({ cards });
}));

export default cardsAdmin;
